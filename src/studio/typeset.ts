/**
 * 조판 — 내용 모델(PolishedDoc)을 **혼자서도 열리는 A4 HTML 문서**로 만든다.
 *
 * 디자인은 모노 미니멀 하나다(design.css). 검정 + 회색만 쓰고, 위계는 색이 아니라
 * 선 굵기·여백·굵기 대비로 만든다 — 흑백 복사기로 인쇄해도 정보가 손실되지 않는다.
 *
 * 조판 모드는 둘이다.
 * - **절대배치**: 초안에서 구워 잰 자리(geom)가 있으면 칸·문제칸·풀이칸·문제·그림을
 *   그 자리에 그대로 앉힌다. 배치는 초안, 옷만 새 디자인.
 * - **흐름**: 자리를 모르는 문서(예시)는 위에서 아래로 흘린다.
 *
 * 결과물은 iframe 미리보기, 인쇄, 파일 저장에 그대로 쓰인다. 그래서 CSS는 인라인이고
 * 도판은 dataURL이며, 바깥에서 가져오는 건 웹폰트와 KaTeX 글꼴뿐이다.
 */

import katex from 'katex';
import katexCssRaw from 'katex/dist/katex.min.css?raw';

import designCss from './design.css?raw';
import { DESIGNS, type DesignName } from './designs';
import type {
  ConceptItem,
  DocSection,
  FigureRef,
  ImageItem,
  PanelName,
  PolishedDoc,
  ProblemItem,
  Rect,
  Run,
  SectionGeom,
  WorksheetItem,
} from './schema';
import { anchorsUsable } from './schema';
import { within } from './snapshot';

export interface RenderOpts {
  /** 미리보기에서 교사가 직접 고칠 수 있게 할지 */
  editable?: boolean;
  /** data-path → 고쳐 쓴 innerHTML */
  overrides?: Record<string, string>;
  /** 덧입힐 디자인 — 없으면 모노 미니멀 */
  design?: DesignName;
}

/** 서체는 한 가족만 — Noto Sans KR. 수식은 KaTeX가 세리프 수식체로 저절로 구분된다. */
const FONT_CSS =
  'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap';
/**
 * KaTeX 스타일은 문서 안에 넣고, 글꼴 파일만 CDN에서 가져오게 주소를 바꾼다.
 * 그래야 저장한 완성본을 인터넷 없이 열어도 수식이 제 크기·제 자리에 나온다
 * (글꼴만 시스템 것으로 대체된다).
 */
const KATEX_CSS = katexCssRaw.replace(
  /url\(fonts\//g,
  'url(https://cdn.jsdelivr.net/npm/katex@0.18.4/dist/fonts/',
);

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface DocHead {
  title: string;
  subtitle: string;
  date: string;
}

/** 머리말: 태그 + 제목 ─── 이름 / 학년·반 / 날짜 */
function headerHtml(h: DocHead): string {
  const fields = ['이름', '학년·반', '날짜']
    .map((l) => `<div class="ws-meta-field"><b>${l}</b><span></span></div>`)
    .join('');
  return `<header class="ws-head">
  <div class="ws-head-l">
    <span class="ws-tagbox">${h.subtitle || '학습지'}</span>
    <h1 class="ws-title">${h.title}</h1>
  </div>
  <div class="ws-meta">${fields}</div>
</header>`;
}

/** 이어지는 쪽의 러닝헤드 — 작게, 회색으로 */
function contHtml(h: DocHead): string {
  return `<div class="ws-cont"><b>${h.title}</b><span>${h.subtitle || h.date}</span></div>`;
}

/** 푸터: 단원명 ───────── n / N */
function footerHtml(h: DocHead, page?: string): string {
  return `<footer class="ws-foot">
  <span>${h.subtitle || h.title}</span>
  <span class="ws-foot-line"></span>
  <span class="pg">${page ?? '1 / 1'}</span>
</footer>`;
}

/** 자동 꼬리표("문제 3", "개념 1" 같은 것)는 마크가 대신하므로 보이지 않는다 */
function isAutoTag(tag: string | undefined): boolean {
  return !tag || /^(문제|개념|모의고사|이미지)\s*\d*$/.test(tag.trim());
}

/**
 * 문항 마크 — 6.2mm 정사각형. 기본은 검정 바탕 + 흰 숫자, 유형이 다른 문제
 * (예제·빈칸 등 tagLabel이 붙은 문제)는 같은 크기의 흰 바탕 + 검정 테두리.
 * 색은 바꾸지 않는다.
 */
function markHtml(n: number, tagLabel?: string): string {
  const tag = tagLabel?.trim() ?? '';
  const isEx = tag === '예' || tag === '예제';
  const face = isEx ? '예' : String(n);
  const cls = tag ? 'ws-no alt' : 'ws-no';
  const label = tag && !isEx ? `<small class="ws-marktag">${escapeHtml(tag)}</small>` : '';
  return `<div class="ws-mark"><div class="${cls}">${escapeHtml(face)}</div>${label}</div>`;
}

/**
 * 텍스트를 싣되, 모델이 확신하지 못한 어절은 형광 표시한다.
 * 교사의 눈이 의심스러운 자리로 바로 가도록 — 인쇄에는 표시가 나오지 않는다.
 */
function textWithDoubts(s: string, doubts: string[]): string {
  const escaped = escapeHtml(s);
  if (!doubts.length) return escaped;
  let out = escaped;
  for (const d of doubts) {
    const needle = escapeHtml(d);
    if (!needle.trim()) continue;
    const idx = out.indexOf(needle);
    if (idx < 0) continue;
    out =
      out.slice(0, idx) +
      `<mark class="ws-uncertain">${needle}</mark>` +
      out.slice(idx + needle.length);
  }
  return out;
}

/**
 * 수식은 저장하는 순간 HTML로 굳혀 둔다. 완성본 파일을 나중에 인터넷 없이 열어도
 * `\(x^2\)` 같은 날것이 보이는 일은 없다. 문법이 틀린 수식은 원문을 그대로 남겨
 * 교사가 미리보기에서 고칠 수 있게 한다.
 */
function mathHtml(latex: string, display = false): string {
  try {
    return katex.renderToString(latex, { throwOnError: false, output: 'html', displayMode: display });
  } catch {
    return `<span class="ws-math-raw">${escapeHtml(latex)}</span>`;
  }
}

/**
 * 런들을 HTML 로. 원문에서 별도 줄 가운데 있던 수식은 여기서도 줄을 끊고 가운데
 * 크게 앉힌다 — 분수·등식이 문장에 끼어 눌리지 않게.
 */
function runsToHtml(runs: Run[], doubts: string[] = []): string {
  return runs
    .map((r) => {
      if (r.t === 'text') return textWithDoubts(r.s, doubts);
      if (r.display) return `<div class="ws-display">${mathHtml(r.latex, true)}</div>`;
      return mathHtml(r.latex);
    })
    .join('');
}

/** 원문에서 테두리·음영 박스로 묶여 있던 글 — 인용 박스로 */
function noteHtml(runs: Run[] | undefined, path: string, opts: RenderOpts): string {
  if (!runs?.length) return '';
  return editable(runsToHtml(runs), `${path}.note`, 'ws-note', 'div', opts);
}

/** 미리보기에서 고친 내용이 있으면 그것으로, 없으면 새로 조판한 것으로 */
function editable(
  html: string,
  path: string,
  cls: string,
  tag: string,
  opts: RenderOpts,
): string {
  const body = opts.overrides?.[path] ?? html;
  const attr = opts.editable ? ` contenteditable="true" data-path="${path}"` : '';
  return `<${tag} class="${cls}"${attr}>${body}</${tag}>`;
}

const pct = (n: number): string => `${(n * 100).toFixed(3)}%`;

/** 비율 사각형 → 절대배치 인라인 스타일 */
function pos(r: Rect): string {
  return `left:${pct(r[0])};top:${pct(r[1])};width:${pct(r[2])};height:${pct(r[3])}`;
}

/** 아이템 하나를 조판할 때의 자리 정보 (절대배치 모드에서만 채워진다) */
interface Place {
  /** 이 아이템이 앉는 박스 대비 아이템 영역 — 없으면 흐름 */
  bbox?: Rect;
}

/**
 * 도판의 알맹이 — 다시 그린 SVG 가 있고 교사가 원본으로 되돌리지 않았으면 SVG,
 * 아니면 잘라낸 캡처. 둘 다 **잘라낸 그림과 같은 가로/세로 비의 상자**에 들어가므로
 * 어느 쪽을 쓰든 차지하는 자리는 같다. 미리보기에서는 클릭으로 둘을 바꿔 볼 수 있다.
 */
function figureBody(f: FigureRef, path: string, opts: RenderOpts): string {
  const useSvg = !!f.svg && f.useSvg !== false;
  const aspect = f.aspect && f.aspect > 0 ? f.aspect : undefined;
  const ratio = aspect ? ` style="aspect-ratio:${aspect.toFixed(4)}"` : '';
  const inner = useSvg
    ? `<div class="ws-svg"${ratio}>${f.svg}</div>`
    : `<img src="${f.src}" alt="">`;
  // 다시 그린 그림이 있을 때만 바꿔 보기 단추를 단다 — 화면에서만, 인쇄에는 안 나온다.
  const toggle =
    opts.editable && f.svg
      ? `<button type="button" class="ws-figtoggle" data-fig="${path}" title="${useSvg ? '원본 캡처로 보기' : '다시 그린 그림으로 보기'}">${useSvg ? '원본' : '벡터'}</button>`
      : '';
  const badge = useSvg ? '<span class="ws-figbadge" aria-hidden="true">SVG</span>' : '';
  return `${inner}${toggle}${badge}`;
}

/**
 * 도판은 초안에서 보이던 크기로 앉힌다 — 칸 가득 늘리지 않는다.
 * 자리를 알면 문제 영역 대비 폭과 위치를 그대로 쓰고, 문제 오른쪽(왼쪽)에 세로로 길게
 * 서 있던 그림은 글 옆에 띄운다. 자리를 모르면 기본 크기로 옆에 세운다.
 */
function figureHtml(f: FigureRef, place: Place | null, wide: boolean, path: string, opts: RenderOpts): string {
  if (!f.src && !f.svg) return '';
  const cap = f.caption ? `<figcaption>${escapeHtml(f.caption)}</figcaption>` : '';
  const box = f.box ?? f.bbox;
  const body = figureBody(f, path, opts);

  if (place?.bbox) {
    const rel = within(box, place.bbox);
    const w = Math.min(1, Math.max(0.08, rel[2]));
    const cx = rel[0] + rel[2] / 2;
    const tall = rel[3] >= 0.45;
    let cls = 'ws-figure ws-figure--block';
    let style = `width:${pct(w)};margin-left:${pct(Math.max(0, Math.min(1 - w, rel[0])))}`;
    if (tall && cx > 0.6) {
      cls = 'ws-figure ws-figure--float-r';
      style = `width:${pct(w)}`;
    } else if (tall && cx < 0.4) {
      cls = 'ws-figure ws-figure--float-l';
      style = `width:${pct(w)}`;
    }
    return `<figure class="${cls}" style="${style}">${body}${cap}</figure>`;
  }

  if (place) {
    // 절대배치 박스 안이지만 아이템 자리는 모른다 — 박스 폭 기준으로 크기만 지킨다.
    const w = Math.min(1, Math.max(0.08, box[2]));
    return `<figure class="ws-figure ws-figure--block" style="width:${pct(w)};margin-left:${pct(Math.min(1 - w, box[0]))}">${body}${cap}</figure>`;
  }

  const cls = wide ? 'ws-figure ws-figure--wide' : 'ws-figure ws-figure--side';
  return `<figure class="${cls}">${body}${cap}</figure>`;
}

function problemHtml(
  item: ProblemItem,
  n: number,
  path: string,
  opts: RenderOpts,
  place: Place | null,
  noMark: boolean,
): string {
  const doubts = item.uncertain ?? [];
  const stem = editable(runsToHtml(item.stem, doubts), `${path}.stem`, 'ws-stem', 'p', opts);

  const choices = item.choices?.length
    ? `<div class="ws-choices">${item.choices
        .map(
          (c, i) =>
            `<span class="ws-choice"><b>${'①②③④⑤⑥⑦⑧'[i] ?? `(${i + 1})`}</b> ${runsToHtml(c)}</span>`,
        )
        .join('')}</div>`
    : '';

  const subqs = item.subqs?.length
    ? `<div class="ws-subqs">${item.subqs
        .map((q, i) => `<div class="ws-subq"><b>(${i + 1})</b><span>${runsToHtml(q)}</span></div>`)
        .join('')}</div>`
    : '';

  const figs = (item.figures ?? []).filter((f) => f.src || f.svg);
  const note = noteHtml(item.note, path, opts);
  const fig = (f: FigureRef, i: number, w: boolean) => figureHtml(f, place, w, `${path}.f${i}`, opts);

  if (place) {
    // 절대배치: 풀이 줄은 풀이칸 박스가 따로 맡는다. 그림은 글 안에 자리대로.
    const rendered = figs.map((f, i) => fig(f, i, false));
    const floats = rendered.filter((h) => h.includes('--float'));
    const blocks = rendered.filter((h) => !h.includes('--float'));
    const inner = `${floats.join('')}${stem}${choices}${subqs}${note}${blocks.join('')}`;
    return `<section class="ws-item ws-problem${noMark ? ' ws-problem--nomark' : ''}">
    ${noMark ? '' : markHtml(n, item.tagLabel)}
    <div>${inner}</div>
  </section>`;
  }

  const answer = `<div class="ws-answer" style="--lines:${item.answerLines}"></div>`;
  // 도판이 있으면 글과 나란히 세운다. 없으면 한 단으로 쭉 흐른다.
  const inner = figs.length
    ? `<div class="ws-row"><div class="ws-row-main">${stem}${choices}${subqs}${note}${answer}</div>${figs
        .map((f, i) => fig(f, i, false))
        .join('')}</div>`
    : `${stem}${choices}${subqs}${note}${answer}`;

  return `<section class="ws-item ws-problem">
    ${markHtml(n, item.tagLabel)}
    <div>${inner}</div>
  </section>`;
}

/** 개념 정리 박스 — 용어(24mm) | 정의. 면 색(tint)은 용어 칸 한 곳에만 쓴다. */
function conceptHtml(item: ConceptItem, path: string, opts: RenderOpts, place: Place | null): string {
  const figs = (item.figures ?? []).filter((f) => f.src || f.svg);
  const body = editable(runsToHtml(item.body), `${path}.body`, 'ws-concept-body', 'div', opts);
  const note = noteHtml(item.note, path, opts);
  const figsHtml = figs.map((f, i) => figureHtml(f, place, true, `${path}.f${i}`, opts)).join('');

  if (place) {
    // 절대배치: 용어는 칸 머리가 맡는다. 여기는 정의와 그림만.
    return `<section class="ws-item ws-concept ws-concept--abs">
    <div class="ws-concept-main">${body}${note}${figsHtml}</div>
  </section>`;
  }

  return `<section class="ws-item ws-concept">
    <div class="ws-concept-term">${escapeHtml(item.title ?? '개념')}</div>
    <div class="ws-concept-main">${body}${note}${figsHtml}</div>
  </section>`;
}

function imageHtml(item: ImageItem, place: Place | null): string {
  if (!item.src) return '';
  const cap = item.caption ? `<figcaption>${escapeHtml(item.caption)}</figcaption>` : '';
  if (place) {
    // 캡처가 곧 문제칸이므로 bbox 자리에 그대로 채우면 픽셀 그대로다.
    const r = item.bbox ?? [0, 0, 1, 1];
    return `<section class="ws-item ws-image ws-image--abs" style="${pos(r)}"><figure><img src="${item.src}" alt="">${cap}</figure></section>`;
  }
  return `<section class="ws-item ws-image"><figure><img src="${item.src}" alt="">${cap}</figure></section>`;
}

function itemHtml(
  item: WorksheetItem,
  n: number,
  path: string,
  opts: RenderOpts,
  place: Place | null = null,
  noMark = false,
): string {
  if (item.kind === 'problem') return problemHtml(item, n, path, opts, place, noMark);
  if (item.kind === 'concept') return conceptHtml(item, path, opts, place);
  return imageHtml(item, place);
}

/* ── 흐름 조판 (예시 등, 자리를 모르는 문서) ─────────────────── */

function sectionsHtml(sections: DocSection[], opts: RenderOpts): string {
  let n = 0;
  const out: string[] = [];
  sections.forEach((sec, si) => {
    sec.items.forEach((item, ii) => {
      if (item.kind === 'problem') n += 1;
      out.push(itemHtml(item, n, `s${si}.i${ii}`, opts));
    });
  });
  return out.join('\n');
}

/* ── 절대배치 조판 — 초안 자리 그대로 ─────────────────────────────
   교사가 잡아 둔 칸(쪽·자리·크기), 그 안의 문제칸과 풀이칸, 문제가 차지한 영역,
   그림의 자리를 전부 비율로 받아 퍼센트로 재현한다. 글은 그 영역 **안에서** 다시
   조판되고, 남는 자리는 초안처럼 필기 줄이 채운다. */

const RULED: PanelName[] = ['sol'];

/** 이 칸에서 그림 캡처가 있던 패널 — 전사한 아이템이 앉는 곳 */
function contentPanelOf(sec: DocSection, g: SectionGeom): PanelName | null {
  if (sec.srcType === 'concept') return g.panels.cimg ? 'cimg' : g.panels.ex ? 'ex' : null;
  if (sec.srcType === 'image') return g.panels.main ? 'main' : null;
  return g.panels.prob ? 'prob' : null;
}

/** 풀이칸이 문제칸의 오른쪽에 있나(가로 분할), 아래에 있나(세로 분할) */
function solSide(g: SectionGeom): 'right' | 'below' {
  const p = g.panels.prob ?? g.panels.cimg;
  const s = g.panels.sol ?? g.panels.ex;
  if (!p || !s) return 'below';
  return s[0] >= p[0] + p[2] * 0.5 ? 'right' : 'below';
}

/** 박스 안 아이템들 — 자리를 알면 그 자리에, 아니면 위에서 아래로 */
function boxItemsHtml(
  items: { item: WorksheetItem; idx: number }[],
  si: number,
  numbering: { n: number },
  opts: RenderOpts,
  noMark: boolean,
): string {
  const anchored = anchorsUsable(items.map((x) => x.item));
  const parts = items.map(({ item, idx }) => {
    if (item.kind === 'problem') numbering.n += 1;
    const place: Place = { bbox: anchored ? item.bbox : undefined };
    if (item.kind === 'image') return imageHtml(item, place);
    const html = itemHtml(item, numbering.n, `s${si}.i${idx}`, opts, place, noMark);
    if (!anchored) return html;
    return `<div class="ws-slot" style="top:${pct(item.bbox![1])};height:${pct(item.bbox![3])}" data-fit><div class="ws-fitin">${html}</div></div>`;
  });
  const cls = anchored ? 'ws-boxin ws-boxin--anchored' : 'ws-boxin ws-fitin';
  return `<div class="${cls}">${parts.join('\n')}</div>`;
}

/** 한 칸 = 초안의 블록 하나 — 그 자리에, 그 안의 패널도 그 자리에 */
function cellAbsHtml(sec: DocSection, si: number, numbering: { n: number }, opts: RenderOpts): string {
  const g = sec.geom!;
  const r = g.rect;
  const kind = sec.srcType;
  const problems = sec.items.filter((it) => it.kind === 'problem').length;
  const content = contentPanelOf(sec, g);
  const side = solSide(g);

  // 머리: 문제·모의고사는 번호 마크 + 제목, 개념은 용어 칩
  let head = '';
  let noMark = false;
  if (g.head && !g.bare) {
    const title = sec.title?.trim() ?? '';
    const tag = isAutoTag(sec.tagLabel) ? '' : `<span class="ws-cellhead-tag">${escapeHtml(sec.tagLabel!)}</span>`;
    if (kind === 'concept') {
      head = `<div class="ws-cellhead ws-cellhead--concept" style="${pos(within(g.head, r))}">${tag}<span class="ws-cellhead-title">${escapeHtml(title || '개념')}</span></div>`;
    } else {
      // 문제가 하나면 번호는 머리에 한 번만 — 문항 안에서 되풀이하지 않는다.
      const mark = problems === 1 ? markHtml(numbering.n + 1, undefined) : '';
      noMark = problems === 1;
      head = `<div class="ws-cellhead" style="${pos(within(g.head, r))}">${mark}${tag}<span class="ws-cellhead-title">${escapeHtml(title)}</span></div>`;
    }
  }

  // 아이템을 패널별로 나눈다: 자리를 아는 아이템은 그림 패널로, 타이핑 글은 설명 패널로.
  const perPanel = new Map<PanelName, { item: WorksheetItem; idx: number }[]>();
  sec.items.forEach((item, idx) => {
    let key: PanelName | null = content;
    if (kind === 'concept' && g.panels.cimg && g.panels.ex && !item.bbox) key = 'ex';
    if (!key) key = g.panels.prob ? 'prob' : g.panels.ex ? 'ex' : g.panels.main ? 'main' : 'cimg';
    if (!perPanel.has(key)) perPanel.set(key, []);
    perPanel.get(key)!.push({ item, idx });
  });

  const boxes: string[] = [];
  for (const key of Object.keys(g.panels) as PanelName[]) {
    const p = g.panels[key];
    if (!p) continue;
    const items = perPanel.get(key) ?? [];
    const ruled = RULED.includes(key);
    const cls = ['ws-box', `ws-box--${key}`];
    if (ruled || (key === 'ex' && kind === 'concept')) cls.push('ws-box--ruled');
    if (key === 'sol' || (key === 'ex' && kind === 'concept' && g.panels.cimg)) cls.push(`ws-box--${side}`);
    const inner = items.length
      ? boxItemsHtml(items, si, numbering, opts, noMark)
      : ruled
        ? ''
        : '<div class="ws-boxin ws-fitin"></div>';
    boxes.push(`<div class="${cls.join(' ')}" style="${pos(within(p, r))}"${items.length && !inner.includes('--anchored') ? ' data-fit' : ''}>${inner}</div>`);
  }

  const cls = ['ws-cell', `ws-cell--${kind}`];
  if (g.bare) cls.push('ws-cell--bare');
  if (g.clipped) cls.push('ws-cell--clipped');
  return `<div class="${cls.join(' ')}" style="${pos(r)}">${head}${boxes.join('\n')}</div>`;
}

/** 자리 정보가 있는 문서를 쪽마다 절대배치로 조판한다 */
function absolutePages(doc: PolishedDoc, opts: RenderOpts, head: DocHead): string {
  const indexed = doc.sections.map((sec, si) => ({ sec, si }));
  // 읽는 순서 = 쪽 → 위 → 왼쪽. 번호도 이 순서로 매긴다.
  indexed.sort((a, b) => {
    const ga = a.sec.geom!;
    const gb = b.sec.geom!;
    if (ga.page !== gb.page) return ga.page - gb.page;
    if (Math.abs(ga.rect[1] - gb.rect[1]) > 0.01) return ga.rect[1] - gb.rect[1];
    return ga.rect[0] - gb.rect[0];
  });

  const pages = new Map<number, { sec: DocSection; si: number }[]>();
  for (const x of indexed) {
    const pn = x.sec.geom!.page;
    if (!pages.has(pn)) pages.set(pn, []);
    pages.get(pn)!.push(x);
  }
  const pageNums = [...pages.keys()].sort((a, b) => a - b);
  const total = pageNums.length;
  const numbering = { n: 0 };

  return pageNums
    .map((pn, pi) => {
      const cells = pages.get(pn)!.map(({ sec, si }) => cellAbsHtml(sec, si, numbering, opts)).join('\n');
      const top = pi === 0 && doc.meta.showHead !== false ? headerHtml(head) : contHtml(head);
      return `<div class="ws-page ws-page--abs"><div class="ws-doc">
${top}
<div class="ws-stack">
${cells}
</div>
${footerHtml(head, `${pi + 1} / ${total}`)}
</div></div>`;
    })
    .join('\n');
}

/**
 * 여러 쪽짜리는 위에서 아래로 쌓는다.
 * 디자인 CSS가 body를 flex로 잡아 두어(한 쪽짜리 기준) 그냥 두면 쪽이 가로로 늘어선다.
 * 디자인보다 뒤에 붙여 순서로 이긴다. 쪽 높이를 확정해야 퍼센트 자리가 풀린다.
 */
const ABS_TAIL_CSS = `
body{display:block;padding:14px 0}
.ws-page{height:297mm;min-height:297mm;overflow:hidden;margin:0 auto 14px}
@media print{body{padding:0}.ws-page{margin:0}}
`;

/**
 * 자리에 다 안 들어가면 글씨를 조금 줄여 맞춘다.
 * 한계(0.78)까지 줄여도 넘치면 거기서 멈춘다 — 읽을 수 없을 만큼 작아지느니 교사가
 * 초안에서 칸을 키우는 편이 낫다. 넘친 자리는 화면에서 표시한다.
 */
const FIT_SCRIPT = `<script>
(function(){
  var FLOOR = 0.78;
  function shrink(cell, box){
    var k = 1;
    box.style.zoom = '';
    while(box.scrollHeight > cell.clientHeight + 1 && k > FLOOR){
      k = Math.round((k - 0.04) * 100) / 100;
      box.style.zoom = k;
    }
    return k;
  }
  function fit(){
    document.querySelectorAll('[data-fit]').forEach(function(cell){
      var box = cell.querySelector(':scope > .ws-fitin');
      if(!box) return;
      cell.classList.remove('ws-clip');
      var k = shrink(cell, box);
      cell.classList.toggle('ws-tight', k < 1);
      cell.classList.toggle('ws-clip', box.scrollHeight > cell.clientHeight + 1);
    });
  }
  if(document.readyState === 'complete') fit();
  else window.addEventListener('load', fit);
  window.addEventListener('beforeprint', fit);
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
})();
</script>`;

/** 미리보기에서 도판의 원본/벡터를 바꿔 보는 단추 — 부모(스튜디오)에 알리면 거기서 문서를 고친다 */
const FIG_TOGGLE_SCRIPT = `<script>
document.addEventListener('click', function(e){
  var b = e.target && e.target.closest ? e.target.closest('.ws-figtoggle') : null;
  if(!b) return;
  e.preventDefault();
  if(window.parent && window.parent !== window) window.parent.postMessage({ type: 'ws-fig-toggle', path: b.getAttribute('data-fig') }, '*');
});
</script>`;

/** 완성본 한 편을 통째로 만든다 — 이 문자열만 있으면 어디서든 열린다. */
export function renderDocument(doc: PolishedDoc, opts: RenderOpts = {}): string {
  const head: DocHead = {
    title: escapeHtml(doc.meta.title || '학습지'),
    subtitle: escapeHtml(doc.meta.subtitle ?? ''),
    date: escapeHtml(doc.meta.date),
  };

  // 초안 자리를 아는 문서는 그 자리대로, 모르는 문서(예시 등)는 한 단으로 흐른다.
  const absolute = doc.sections.length > 0 && doc.sections.every((s) => s.geom);
  const body = absolute
    ? absolutePages(doc, opts, head)
    : `<div class="ws-page"><div class="ws-doc">
${headerHtml(head)}
${sectionsHtml(doc.sections, opts)}
${footerHtml(head)}
</div></div>`;

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${head.title}</title>
<link rel="stylesheet" href="${FONT_CSS}">
<style>
${KATEX_CSS}
${designCss}
${DESIGNS[opts.design ?? 'mono'].css}
${absolute ? ABS_TAIL_CSS : ''}
</style>
</head>
<body>
${body}
${absolute ? FIT_SCRIPT : ''}
${opts.editable ? FIG_TOGGLE_SCRIPT : ''}
</body>
</html>`;
}
