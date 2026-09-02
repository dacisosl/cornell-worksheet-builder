/**
 * 조판 — 내용 모델(PolishedDoc)을 **혼자서도 열리는 A4 HTML 문서**로 만든다.
 *
 * 디자인은 모노 미니멀 하나다(design.css). 검정 + 회색만 쓰고, 위계는 색이 아니라
 * 선 굵기·여백·굵기 대비로 만든다 — 흑백 복사기로 인쇄해도 정보가 손실되지 않는다.
 *
 * 결과물은 iframe 미리보기, 인쇄, 파일 저장에 그대로 쓰인다. 그래서 CSS는 인라인이고
 * 도판은 dataURL이며, 바깥에서 가져오는 건 웹폰트와 KaTeX 글꼴뿐이다.
 */

import katex from 'katex';
import katexCssRaw from 'katex/dist/katex.min.css?raw';

import designCss from './design.css?raw';
import type {
  ConceptItem,
  DocSection,
  FigureRef,
  ImageItem,
  PolishedDoc,
  ProblemItem,
  Run,
  WorksheetItem,
} from './schema';

export interface RenderOpts {
  /** 미리보기에서 교사가 직접 고칠 수 있게 할지 */
  editable?: boolean;
  /** data-path → 고쳐 쓴 innerHTML */
  overrides?: Record<string, string>;
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

/**
 * 문항 마크 — 6.2mm 정사각형. 기본은 검정 바탕 + 흰 숫자, 유형이 다른 문제
 * (예제·빈칸 등 tagLabel이 붙은 문제)는 같은 크기의 흰 바탕 + 검정 테두리.
 * 색은 바꾸지 않는다.
 */
function markHtml(item: ProblemItem, n: number): string {
  const tag = item.tagLabel?.trim() ?? '';
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
function mathHtml(latex: string): string {
  try {
    return katex.renderToString(latex, { throwOnError: false, output: 'html' });
  } catch {
    return `<span class="ws-math-raw">${escapeHtml(latex)}</span>`;
  }
}

function runsToHtml(runs: Run[], doubts: string[] = []): string {
  return runs
    .map((r) => (r.t === 'text' ? textWithDoubts(r.s, doubts) : mathHtml(r.latex)))
    .join('');
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

/** 초안에서 차지하던 폭(칸 폭 대비 %) — 없으면 null 로 두어 기본 크기를 쓴다 */
function widthPct(wFrac: number | undefined, min: number, max: number): number | null {
  if (typeof wFrac !== 'number' || !Number.isFinite(wFrac)) return null;
  return Math.round(Math.min(max, Math.max(min, wFrac * 100)));
}

/**
 * 도판은 초안에서 보이던 크기로 앉힌다 — 칸 가득 늘리지 않는다.
 * 교사가 작게 붙인 그림은 완성본에서도 작아야 칸 배치가 무너지지 않는다.
 */
function figureHtml(f: FigureRef, wide: boolean): string {
  if (!f.src) return '';
  const cap = f.caption ? `<figcaption>${escapeHtml(f.caption)}</figcaption>` : '';
  const cls = wide ? 'ws-figure ws-figure--wide' : 'ws-figure ws-figure--side';
  const pct = widthPct(f.wFrac, 12, wide ? 100 : 60);
  const style = pct == null ? '' : wide ? ` style="width:${pct}%"` : ` style="flex-basis:${pct}%"`;
  return `<figure class="${cls}"${style}><img src="${f.src}" alt="">${cap}</figure>`;
}

function problemHtml(item: ProblemItem, n: number, path: string, opts: RenderOpts): string {
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

  const answer = `<div class="ws-answer" style="--lines:${item.answerLines}"></div>`;
  const figs = (item.figures ?? []).filter((f) => f.src);

  // 도판이 있으면 글과 나란히 세운다. 없으면 한 단으로 쭉 흐른다.
  const inner = figs.length
    ? `<div class="ws-row"><div class="ws-row-main">${stem}${choices}${subqs}${answer}</div>${figs
        .map((f) => figureHtml(f, false))
        .join('')}</div>`
    : `${stem}${choices}${subqs}${answer}`;

  return `<section class="ws-item ws-problem">
    ${markHtml(item, n)}
    <div>${inner}</div>
  </section>`;
}

/** 개념 정리 박스 — 용어(24mm) | 정의. 면 색(tint)은 용어 칸 한 곳에만 쓴다. */
function conceptHtml(item: ConceptItem, path: string, opts: RenderOpts): string {
  const figs = (item.figures ?? []).filter((f) => f.src);
  const body = editable(runsToHtml(item.body), `${path}.body`, 'ws-concept-body', 'div', opts);
  return `<section class="ws-item ws-concept">
    <div class="ws-concept-term">${escapeHtml(item.title ?? '개념')}</div>
    <div class="ws-concept-main">${body}${figs.map((f) => figureHtml(f, true)).join('')}</div>
  </section>`;
}

function imageHtml(item: ImageItem): string {
  if (!item.src) return '';
  const cap = item.caption ? `<figcaption>${escapeHtml(item.caption)}</figcaption>` : '';
  const pct = widthPct(item.wFrac, 12, 100);
  const style = pct == null ? '' : ` style="width:${pct}%"`;
  return `<section class="ws-item ws-image"><figure${style}><img src="${item.src}" alt="">${cap}</figure></section>`;
}

function itemHtml(item: WorksheetItem, n: number, path: string, opts: RenderOpts): string {
  if (item.kind === 'problem') return problemHtml(item, n, path, opts);
  if (item.kind === 'concept') return conceptHtml(item, path, opts);
  return imageHtml(item);
}

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

/* ── 초안 배치를 그대로 옮기는 조판 ──────────────────────────────
   교사가 한 쪽에 문제 여섯과 여백 여섯을 놓았으면 완성본도 그래야 한다.
   그래서 칸의 자리·크기(쪽·행·반칸·높이 비율)를 초안에서 받아 그대로 재현하고,
   글은 그 칸 **안에서** 다시 조판한다. */

/** 한 칸 = 초안의 블록 하나. 안의 아이템들을 그 칸 높이에 맞춰 앉힌다. */
function cellHtml(sec: DocSection, si: number, startNo: number, opts: RenderOpts): string {
  let n = startNo;
  const inner = sec.items
    .map((item, ii) => {
      if (item.kind === 'problem') n += 1;
      return itemHtml(item, n, `s${si}.i${ii}`, opts);
    })
    .join('\n');
  // 초안이 정해 둔 문제칸:풀이칸 비율을 풀이 여백의 기본 크기로 쓴다.
  const split = sec.geom?.ratio;
  const style = typeof split === 'number' ? ` style="--split:${split.toFixed(3)}"` : '';
  return `<div class="ws-cell"${style}><div class="ws-cellin">${inner}</div></div>`;
}

function countProblems(sec: DocSection): number {
  return sec.items.filter((i) => i.kind === 'problem').length;
}

/** 배치 정보가 있는 문서를 쪽·행·칸 구조로 조판한다. */
function laidOutPages(doc: PolishedDoc, opts: RenderOpts, head: DocHead): string {
  // 쪽 → 행 → 칸
  const pages = new Map<number, Map<number, { sec: DocSection; si: number }[]>>();
  doc.sections.forEach((sec, si) => {
    const g = sec.geom!;
    if (!pages.has(g.page)) pages.set(g.page, new Map());
    const rows = pages.get(g.page)!;
    if (!rows.has(g.row)) rows.set(g.row, []);
    rows.get(g.row)!.push({ sec, si });
  });

  const pageNums = [...pages.keys()].sort((a, b) => a - b);
  const total = pageNums.length;
  let no = 0;

  return pageNums
    .map((pn, pi) => {
      const rows = [...pages.get(pn)!.entries()].sort((a, b) => a[0] - b[0]);
      const gaps = Math.max(0, rows.length - 1);

      const rowsHtml = rows
        .map(([, cells]) => {
          const f = Math.max(...cells.map((c) => c.sec.geom!.hFrac));
          const inner = cells
            .map(({ sec, si }) => {
              const html = cellHtml(sec, si, no, opts);
              no += countProblems(sec);
              return html;
            })
            .join('');
          return `<div class="ws-trow" style="--f:${f.toFixed(4)}">${inner}</div>`;
        })
        .join('\n');

      return `<div class="ws-page ws-page--grid"><div class="ws-doc">
${pi === 0 ? headerHtml(head) : contHtml(head)}
<div class="ws-stack" style="--gaps:${gaps}">
${rowsHtml}
</div>
${footerHtml(head, `${pi + 1} / ${total}`)}
</div></div>`;
    })
    .join('\n');
}

/**
 * 여러 쪽짜리는 위에서 아래로 쌓는다.
 * 디자인 CSS가 body를 flex로 잡아 두어(한 쪽짜리 기준) 그냥 두면 쪽이 가로로 늘어선다.
 * 디자인보다 뒤에 붙여 순서로 이긴다.
 */
const GRID_TAIL_CSS = `
body{display:block;padding:14px 0}
/* 쪽 높이를 확정해야 행의 퍼센트 높이가 풀린다 (기본은 min-height만 준다) */
.ws-page{height:297mm;min-height:297mm;overflow:hidden;margin:0 auto 14px}
@media print{body{padding:0}.ws-page{margin:0}}
`;

/**
 * 칸에 다 안 들어가면 글씨를 조금 줄여 맞춘다.
 * 여백(풀이칸)이 먼저 줄고, 그래도 넘칠 때만 글씨가 줄어든다. 한계(0.78)까지 줄여도
 * 넘치면 거기서 멈춘다 — 읽을 수 없을 만큼 작아지느니 교사가 칸을 키우는 편이 낫다.
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
    document.querySelectorAll('.ws-cell').forEach(function(cell){
      var box = cell.querySelector('.ws-cellin');
      if(!box) return;
      cell.classList.remove('ws-noroom', 'ws-clip');
      var k = shrink(cell, box);
      // 아직도 넘치면 여백을 끝까지 내준 뒤 다시 줄여 본다
      if(box.scrollHeight > cell.clientHeight + 1){
        cell.classList.add('ws-noroom');
        k = shrink(cell, box);
      }
      cell.classList.toggle('ws-tight', k < 1);
      // 그래도 안 들어가면 잘린다 — 조용히 잘리지 않도록 표시해 둔다
      cell.classList.toggle('ws-clip', box.scrollHeight > cell.clientHeight + 1);
    });
  }
  if(document.readyState === 'complete') fit();
  else window.addEventListener('load', fit);
  window.addEventListener('beforeprint', fit);
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
})();
</script>`;

/** 완성본 한 편을 통째로 만든다 — 이 문자열만 있으면 어디서든 열린다. */
export function renderDocument(doc: PolishedDoc, opts: RenderOpts = {}): string {
  const head: DocHead = {
    title: escapeHtml(doc.meta.title || '학습지'),
    subtitle: escapeHtml(doc.meta.subtitle ?? ''),
    date: escapeHtml(doc.meta.date),
  };

  // 초안 배치를 아는 문서는 그 배치대로, 모르는 문서(예시 등)는 한 단으로 흐른다.
  const laidOut = doc.sections.length > 0 && doc.sections.every((s) => s.geom);
  const body = laidOut
    ? laidOutPages(doc, opts, head)
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
${laidOut ? GRID_TAIL_CSS : ''}
</style>
</head>
<body>
${body}
${laidOut ? FIT_SCRIPT : ''}
</body>
</html>`;
}
