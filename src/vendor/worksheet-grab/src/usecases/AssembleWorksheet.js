import { Worksheet, Block, Standard } from '../domain/index.js';
import { prerenderMathInHtml } from './katexPrerender.js';
import { inlineFontFacesSync, collectCodepoints } from './fontInline.js';
import { resolvePaper, paperCss, paperContentPx } from './paper.js';
import { ORGANIZER_GENERATORS, fitSvgToBox } from './OrganizerGen.js';
import { BlockRepository } from './ports.js';
import { MOOD_FRAMES_DEFS } from './moodFrames.js';

// AssembleWorksheet — 매니페스트 + 블록 라이브러리 + 테마 + 성취기준(CSV) → 활동지 HTML.
// 겸 Presenter: 도메인 Worksheet 를 HTML(MODE_TOKEN 포함) 로 직렬화한다.
// 포트(BlockRepository, CurriculumProvider)에만 의존. Chrome 무지.

// vocabulary 를 제공하지 않는 최소 포트/레거시 픽스처용 폴백. 실제 조립에서는
// blocks/vocabulary.json 의 category 를 단일 진실원천으로 우선 사용한다.
const SUBJECT_PACK_TYPES = new Set([
  'passage', 'pro-con', 'variable-table', 'data-table',
  'svg-graph', 'formula', 'hypothesis-box',
  'map', 'timeline', 'vocab', 'dialogue',
]);

// KaTeX head 스니펫. 자료집(WorkbookAssemble)이 단일 head 로 1회 재사용하도록 export 로
// 승격했다 — 이 상수의 사용처(#serialize)와 산출 바이트는 불변.
export const KATEX_HEAD = `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" crossorigin>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js" crossorigin></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js" crossorigin
  onload="renderMathInElement(document.body,{delimiters:[{left:'$',right:'$',display:false},{left:'$$',right:'$$',display:true}]});"></script>`;

export class AssembleWorksheet {
  /** @param {{blockRepository, curriculum}} deps */
  constructor({ blockRepository, curriculum }) {
    if (!blockRepository) throw new TypeError('AssembleWorksheet 는 BlockRepository 가 필요합니다.');
    this.repo = blockRepository;
    this.curriculum = curriculum ?? null;
  }

  /**
   * @param {object} manifest 파싱된 매니페스트
   * @param {{editMode?:boolean}} opts editMode: 에디터(E3) 전용 — 각 블록을 경계 래퍼로
   *   감싸 DOM↔manifest 역동기화를 가능하게 한다. 기본 false = 현행 산출 바이트 불변.
   *   래퍼는 저장 시 clean 재조립으로 자연 소멸하므로 인쇄물/워크스페이스 HTML 에 남지 않는다.
   * @returns {Promise<{html:string, worksheet:Worksheet}>}
   */
  async execute(manifest, { editMode = false } = {}) {
    // 자기완결 자산은 **포트로 물어본다**(직접 import 하면 node:vm 이 브라우저 서빙 그래프에
    // 딸려 들어가 순수성이 깨진다). 지원하지 않는 리포지토리면 종전 CDN 경로 그대로 남는다.
    if (this.selfContained === undefined) {
      this.selfContained = typeof this.repo?.loadSelfContained === 'function'
        ? await this.repo.loadSelfContained().catch(() => null)
        : null;
    }
    const standards = await this.#resolveStandards(manifest);
    const objectives = normalizeObjectives(manifest.objectives);
    const vocabulary = typeof this.repo.readVocabulary === 'function'
      && this.repo.readVocabulary !== BlockRepository.prototype.readVocabulary
      ? await this.repo.readVocabulary()
      : null;

    // 페이지별 블록 로드/생성 → 도메인 Block[][]
    const pages = [];
    for (const pageEntries of manifest.pages) {
      const blocks = [];
      for (const entry of pageEntries) {
        const html = await this.#entryHtml(entry, standards, manifest);
        const type = entry.type || 'content';
        blocks.push(new Block({
          id: entry.file || `gen:${type}`,
          type,
          category: vocabulary?.types?.[type]
            ? (vocabulary.types[type].category === 'pack' ? 'subjectPack' : 'core')
            : (SUBJECT_PACK_TYPES.has(type) ? 'subjectPack' : 'core'),
          subject: manifest.subject,
          content: html,
        }));
      }
      pages.push(blocks);
    }

    const worksheet = new Worksheet({
      subject: manifest.subject,
      themeName: manifest.theme,
      docTitle: manifest.docTitle || '',
      standards,
      objectives,
      pages,
      head: manifest.head || { katex: false },
      runHead: manifest.runHead || '',
      runFoot: manifest.runFoot || { left: '', rightPrefix: '' },
    });

    const html = await this.#serialize(worksheet, manifest, editMode);
    return { html, worksheet };
  }

  async #resolveStandards(manifest) {
    const codes = manifest.standards || [];
    const fallback = manifest.standardsText || {};
    const out = [];
    for (const rawCode of codes) {
      const code = String(rawCode);
      let text = null;
      if (this.curriculum) {
        try {
          const r = await this.curriculum.resolve(code);
          if (r && r.text) text = r.text;
        } catch { /* MCP/CSV 실패 → 폴백 */ }
      }
      if (!text) text = fallback[code] || fallback[code.replace(/^\[|\]$/g, '')] || null;
      if (!text) {
        // 원문을 구할 수 없으면 창작하지 않고 명시적으로 실패시킨다.
        throw new Error(`성취기준 ${code} 의 원문을 CSV/MCP/폴백 어디에서도 찾지 못했습니다(창작 금지).`);
      }
      out.push(new Standard({ code, text, subject: manifest.subject }));
    }
    return out;
  }

  async #entryHtml(entry, standards, manifest) {
    if (entry.gen === 'standard-label' || entry.type === 'standard-label') {
      return this.#renderStandardLabel(standards, manifest);
    }
    let html;
    // 파라메트릭 조직자: entry.params 가 있으면 엔진이 개수대로 SVG 를 생성한다(좌표는 엔진 계산).
    // params 없으면 정적 블록(entry.file)을 쓴다 = 기존 산출 그대로(하위호환).
    if (entry.params && ORGANIZER_GENERATORS[entry.type]) {
      html = ORGANIZER_GENERATORS[entry.type](entry.params, entry.labels);
    }
    else if (typeof entry.html === 'string') html = entry.html; // 인라인 블록(템플릿 슬롯 치환 결과)
    else if (entry.file) html = await this.repo.loadBlockHtml(entry.file);
    else throw new Error(`블록 엔트리에 file/html/gen 이 없습니다: ${JSON.stringify(entry)}`);
    // 자동 맞춤(fit): SVG 조직자를 용지 여백 박스에 꽉 맞게 스케일(잘림 방지). viewBox 없는 표 등은 그대로.
    if (entry.fit) html = fitSvgToBox(html, ...this.#fitBox(entry.fit, manifest));
    return html;
  }

  /** entry.fit 의 박스(px). 객체 {w,h} 면 그대로, true 면 manifest.paper 콘텐츠에서 헤더 여유를 뺀 값. */
  #fitBox(fit, manifest) {
    if (fit && typeof fit === 'object' && fit.w > 0 && fit.h > 0) return [fit.w, fit.h];
    const resolved = resolvePaper(manifest?.paper) || resolvePaper({ size: 'A4', orientation: 'portrait' });
    const c = paperContentPx(resolved);
    const HEADER_RESERVE = 150; // 헤더·제목 여유(px) — 보수적으로 잡아 넘침을 막는다.
    return [Math.round(c.w * 0.96), Math.max(120, c.h - HEADER_RESERVE)];
  }

  /**
   * gen:'standard-label' 블록 → 학습목표 박스(+선택적 근거 성취기준 박스).
   *
   * **학습목표 저작(2026-07-28)**: `manifest.objectives`(문자열 배열)가 있으면 그 문장을 그대로
   * 학습목표로 싣는다 — 개체 트리의 `std-box.objectives` 와 같은 계약이다. 이 경로가 "저작 불가"
   * 였던 것은 엔진이 성취기준 원문만 조립했기 때문이지 원칙 3 때문이 아니다(원칙 3은 **성취기준
   * 원문** 창작만 금지하며 학습목표는 애초에 그 대상 밖이다). 그래서 원문 조회 규칙은 그대로 두고
   * (`#resolveStandards` 는 여전히 창작 없이 CSV/MCP/폴백만 쓴다) 저작 문장을 실을 통로만 연다.
   *   - `manifest.objectivesHeading` — 박스 제목(기본 '학습 목표').
   *   - `manifest.showStandards` — 근거 성취기준 박스를 함께 낼지(기본 false). 개체 트리
   *     `std-box.showStandards` 와 같은 기본값 — 활동지에 얹는 것은 학습목표뿐이라는 현장 관행.
   *     켜도 `.std-ref` 라 학생용에서는 data-mode CSS 로 숨는다(비밀이 아니라 물리 제거 불필요).
   *
   * **하위호환(objectives 미저작)**: 종전 기계 변환 경로를 **바이트 그대로** 유지한다 — 박스 제목은
   * "학습 목표", 목록은 코드를 뗀 성취기준 문장, 그리고 근거 성취기준 박스를 항상 함께 낸다.
   * 저작 문장이 없는 문서에서 근거까지 숨기면 성취기준 정보가 화면에서 완전히 사라지기 때문이다.
   */
  #renderStandardLabel(standards, manifest) {
    const refBox = () => {
      const refLis = standards
        .map((s) => `      <li><b>${s.bracketedCode()}</b> ${escapeHtml(s.text)}</li>`)
        .join('\n');
      return `<div class="std-box std-ref">
    <div class="std-head">▣ 근거 성취기준 (2022 개정 교육과정)</div>
    <ul>
${refLis}
    </ul>
  </div>`;
    };

    const objectives = normalizeObjectives(manifest?.objectives);
    if (objectives.length > 0) {
      const rawHeading = typeof manifest?.objectivesHeading === 'string' ? manifest.objectivesHeading.trim() : '';
      const heading = rawHeading || '학습 목표';
      const goalLis = objectives.map((g) => `      <li>${escapeHtml(g)}</li>`).join('\n');
      const goalBox = `<div class="std-box">
    <div class="std-head">▣ ${escapeHtml(heading)}</div>
    <ul>
${goalLis}
    </ul>
  </div>`;
      // 참조할 성취기준이 없으면 켜져 있어도 빈 박스를 내지 않는다(제목만 있는 빈 테두리가 인쇄된다).
      if (manifest?.showStandards !== true || standards.length === 0) return goalBox;
      return `${goalBox}
  ${refBox()}`;
    }

    const goalLis = standards
      .map((s) => `      <li>${escapeHtml(s.text)}</li>`)
      .join('\n');
    return `<div class="std-box">
    <div class="std-head">▣ 학습 목표</div>
    <ul>
${goalLis}
    </ul>
  </div>
  ${refBox()}`;
  }

  async #serialize(worksheet, manifest, editMode = false) {
    let paper = await this.repo.readAsset('paper.css');
    // manifest.paper(1급 속성) → @page 숫자 리터럴 + --sheet-* 변수를 paper.css 바로 뒤에
    // 인라인해 캐스케이드로 덮어쓴다. 미지정이면 스니펫 없음 = 현행 산출 그대로(하위호환).
    const resolvedPaper = resolvePaper(manifest.paper);
    const paperOverride = paperCss(resolvedPaper);
    if (paperOverride) paper = `${paper}\n${paperOverride}`;
    // columns>1 일 때만 페이지 본문을 .sheet-body 로 감싼다(다단 흐름 소비). columns<=1
    // 은 래퍼 미방출 = 현행 산출 바이트 불변. 크롬(run-head/foot/mode-badge)은 래퍼 밖.
    const columns = resolvedPaper?.columns ?? 1;
    const blocksCss = await this.repo.readAsset('blocks.css');
    const themeCss = await this.repo.loadThemeCss(worksheet.themeName);
    // 무드(P2-a): manifest.mood 가 지정되면 닫힌 카탈로그(themes/moods/*.css) 검증 후 로드해 theme
    // 레이어 뒤에 한 겹 주입한다. 미지정이면 repo 무드 메서드를 호출조차 하지 않아 현행 산출 그대로(무회귀).
    // 미지 무드는 조용히 무시하지 않고 차단한다(fail-closed) — 단일 진실원천은 manifest.mood 뿐이다.
    let moodCss = '';
    let moodName = '';
    let moodFramesCss = '';
    if (manifest.mood != null && manifest.mood !== '') {
      moodName = String(manifest.mood);
      const known = await this.repo.listMoods();
      if (!known.includes(moodName)) {
        throw new Error(`알 수 없는 무드 '${moodName}' 입니다(등록된 무드: ${known.join(', ') || '없음'}). 무드는 닫힌 목록에서만 선택합니다(fail-closed).`);
      }
      moodCss = await this.repo.loadMoodCss(moodName);
      // 테두리 손그림 레이어(있는 무드만). 개체 트리 경로(renderAssets)와 대칭 — 두 로드 지점이
      // 독립이라 한쪽만 고치면 그 경로에서만 레이어가 빠진다.
      moodFramesCss = typeof this.repo.loadMoodFramesCss === 'function'
        ? await this.repo.loadMoodFramesCss(moodName)
        : '';
    }
    const lang = manifest.lang || 'ko';
    const dataSubject = manifest.dataSubject || worksheet.subject;

    const pagesHtml = worksheet.pages.map((blocks, idx) => {
      const pageNo = idx + 1;
      // editMode: 블록 경계 래퍼(display:contents — editor.css) — DOM 순회로 pages[p][b] 복원.
      const body = blocks.map((b, bIdx) => (editMode
        ? `<div class="wg-block" data-bp="${idx}" data-bi="${bIdx}" data-bt="${escapeHtml(b.type)}">${b.toHtml()}</div>`
        : b.toHtml()
      )).join('\n\n  ');
      const bodyOut = wrapSheetBody(body, columns);
      const foot = worksheet.runFoot;
      const rightPrefix = foot.rightPrefix ?? foot.right ?? '';
      return buildSheetSection({
        pageNo, runHead: worksheet.runHead, bodyOut, footLeft: foot.left, footRightPrefix: rightPrefix,
      });
    }).join('\n\n');

    return buildDocumentHtml({
      lang,
      docTitle: worksheet.docTitle,
      katexEnabled: !!worksheet.head.katex,
      paperCss: paper,
      blocksCss,
      themeCss,
      themeName: worksheet.themeName,
      dataSubject,
      pagesHtml,
      moodCss,
      moodFramesCss,
      moodName,
      selfContained: this.selfContained ?? null,
    });
  }
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 학습목표(저작 영역) 정규화 — 문자열 배열에서 공백 줄을 걷어낸다(개체 트리 인스펙터가
 * `objectives.split('\n')...filter(Boolean)` 로 하는 것과 같은 규칙). 배열이 아니면 빈 배열.
 * 결과가 비면 렌더는 하위호환 경로(성취기준 기계 변환)로 떨어진다.
 */
export function normalizeObjectives(value) {
  if (!Array.isArray(value)) return [];
  return value.map((s) => String(s ?? '').trim()).filter(Boolean);
}

// ── S2.1(M2) 공유 추출 — head/섹션 조립의 순수 조각. AssembleWorksheet(manifest 경로)와
// RenderObjectTree(개체 트리 경로, C1)가 이 조각들을 공유해 문서 골격 중복을 피한다.
// 이 함수들은 기존 AssembleWorksheet 산출 바이트를 불변으로 유지하도록 원본 템플릿을
// 그대로 파라미터화한 것뿐이다(동작 변경 없음).

/** columns<=1 은 bodyHtml 그대로(바이트 불변), columns>1 만 .sheet-body 래퍼로 감싼다. */
export function wrapSheetBody(bodyHtml, columns) {
  return columns > 1 ? `<div class="sheet-body">\n  ${bodyHtml}\n  </div>` : bodyHtml;
}

/** 페이지 1장(`<section class="sheet">`) — run-head/run-foot/mode-badge 크롬 + bodyOut.
 *  sheetStyle: 페이지별 용지 override(P3-b) 인라인 스타일. 빈 문자열(기본)이면 style 속성을 아예
 *  달지 않아 종전 산출과 **바이트 동일**하다(미지정 페이지 무회귀). */
export function buildSheetSection({ pageNo, pageId = null, runHead, bodyOut, footLeft, footRightPrefix, sheetStyle = '' }) {
  const pageIdAttr = typeof pageId === 'string' && pageId
    ? ` data-page-id="${escapeHtml(pageId).replaceAll('"', '&quot;').replaceAll("'", '&#39;')}"`
    : '';
  const styleAttr = sheetStyle ? ` style="${sheetStyle}"` : '';
  return `<section class="sheet"${pageIdAttr}${styleAttr}>
  <span class="mode-badge"></span>
  <div class="run-head">${escapeHtml(runHead)}</div>

  ${bodyOut}

  <div class="run-foot"><span>${escapeHtml(footLeft || '')}</span><span>${escapeHtml(footRightPrefix ?? '')}　${pageNo}</span></div>
</section>`;
}

/**
 * 문서 전체(`<!DOCTYPE html>`…`</html>`) — head(폰트/KaTeX/CSS) + body(data-mode="MODE_TOKEN" + pagesHtml).
 *
 * **무드 주입(P2-a)**: `moodCss` 가 비어 있지 않으면 CSS concat 순서(paper → blocks → theme) **뒤에**
 * 무드 :root 오버라이드를 한 겹 append 한다(디자인 토큰 --wg-* 값 세트, 과목색 --c* 와 직교).
 * `moodCss` 가 빈 문자열(기본)이면 아무것도 붙지 않아 **산출 바이트가 현행과 동일**하다(무드 미지정=무회귀).
 * 무드 이름은 코드 로드가 아니라 이미 문자열로 해석되어 주입된다(themeCss 와 동일한 계층 규약 —
 * repo 접근은 호출부 책임, 이 함수는 순수 문자열 조립).
 */
export function buildDocumentHtml({
  lang, docTitle, katexEnabled, paperCss: paperCssText, blocksCss, themeCss, themeName, dataSubject, pagesHtml,
  moodCss = '', moodName = '', moodFramesCss = '', selfContained = null,
}) {
  // ── 자기완결 모드 ──────────────────────────────────────────────────────
  // selfContained 가 주어지면 **수식**을 조립 시점에 굽는다 — 브라우저 KaTeX 스크립트를 싣지
  // 않으므로, 오프라인에서 수식이 안 그려지던 문제와 측정 게이트가 그 스크립트를 타임아웃 없이
  // 기다려 무한 대기하던 경로가 함께 사라진다.
  //
  // **본문 글꼴은 아직 CDN 이다.** 인라인 코드는 있지만 기본 꺼짐이다(사유는
  // selfContainedAssets.INLINE_BODY_FONT). 그래서 산출 HTML 의 외부 URL 은 0개가 아니라
  // 글꼴 하나가 남는다 — 알려진 간극이고 self-contained.test.js 가 정확히 그 선을 지킨다.
  //
  // 주입하지 않으면 종전 CDN 경로 그대로다(호출부가 끄면 되는 한 줄 — 되돌리기 쉽게 남겨 둔다).
  let body = pagesHtml;
  let headExtra = '';
  let fontCssBlock = '';

  if (selfContained) {
    if (katexEnabled && selfContained.katex) {
      body = prerenderMathInHtml(pagesHtml, selfContained.katex).html;
      const kx = inlineFontFacesSync(selfContained.katexCss, selfContained.katexFonts, { codepoints: null });
      headExtra = `\n<style>\n${kx.css}\n</style>`;
    }
    // 본문 글꼴 인라인은 기본 꺼짐이다(사유는 selfContainedAssets.INLINE_BODY_FONT 주석).
    // 껐을 때 글꼴 선언을 통째로 빼면 시스템 글꼴로 폴백해 레이아웃이 조용히 바뀌므로,
    // 아래 fontLink 가 종전 CDN 링크로 되돌아간다.
    if (selfContained.fontCss && selfContained.inlineFonts !== false) {
      // 폰트 조각 선택은 **렌더된 본문**의 글자로 한다(수식 렌더 후여야 정확하다).
      const cps = collectCodepoints(body);
      const pf = inlineFontFacesSync(selfContained.fontCss, selfContained.fontChunks, { codepoints: cps });
      fontCssBlock = `\n<style>\n${pf.css}\n</style>`;
    }
  }

  const katex = selfContained ? headExtra : (katexEnabled ? '\n' + KATEX_HEAD : '');
  const fontLink = fontCssBlock
    || '\n<link rel="stylesheet" as="style" crossorigin\n  href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">';
  pagesHtml = body;
  const mood = moodCss
    ? `\n\n/* ===== 무드 오버라이드 (themes/moods/${moodName}.css) ===== */\n${moodCss}`
    : '';
  // 테두리 손그림 레이어(P2-d): 무드 레이어 **뒤**에 와야 무드가 정한 모서리·두께를 물려받는다.
  // 문자열 유무로 분기하므로 이 레이어가 없는 무드·무드 미지정 문서는 바이트가 그대로다.
  const frames = moodFramesCss
    ? `\n\n/* ===== 무드 테두리 레이어 (assets/${moodName}-frames.css) ===== */\n${moodFramesCss}`
    : '';
  // defs 는 마크업이라 <style> 에 못 넣는다. 위치는 계약이다 — 페이지 뒤·</body> 앞·display:none.
  // body 흐름 안에 두면 인라인 박스가 생겨 조판이 밀린다(실측: 3쪽 문서가 4쪽이 됐다).
  const defs = moodFramesCss ? `\n${MOOD_FRAMES_DEFS}\n` : '';
  return `<!DOCTYPE html>
<html lang="${lang}" data-mode="MODE_TOKEN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(docTitle)}</title>${fontLink}${katex}
<style>
${paperCssText}

${blocksCss}

/* ===== 교과 테마 토큰 (themes/${themeName}.css) ===== */
${themeCss}${mood}${frames}
</style>
</head>
<body data-mode="MODE_TOKEN" data-subject="${escapeHtml(dataSubject)}">

${pagesHtml}
${defs}
</body>
</html>
`;
}
