/**
 * 조판 — 내용 모델(PolishedDoc)을 **혼자서도 열리는 A4 HTML 문서**로 만든다.
 *
 * 결과물은 iframe 미리보기, 인쇄, 파일 저장에 그대로 쓰인다. 그래서 CSS는 인라인이고
 * 도판은 dataURL이며, 바깥에서 가져오는 건 웹폰트와 KaTeX뿐이다.
 */

import katex from 'katex';
import katexCssRaw from 'katex/dist/katex.min.css?raw';

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
import { BASE_CSS, THEMES, type ThemeName } from './themes';

export interface RenderOpts {
  /** 미리보기에서 교사가 직접 고칠 수 있게 할지 */
  editable?: boolean;
  /** data-path → 고쳐 쓴 innerHTML */
  overrides?: Record<string, string>;
}

const FONT_CSS =
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css';
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

function figureHtml(f: FigureRef, wide: boolean): string {
  if (!f.src) return '';
  const cap = f.caption ? `<figcaption>${escapeHtml(f.caption)}</figcaption>` : '';
  const cls = wide ? 'ws-figure ws-figure--wide' : 'ws-figure ws-figure--side';
  return `<figure class="${cls}"><img src="${f.src}" alt="">${cap}</figure>`;
}

function problemHtml(
  item: ProblemItem,
  n: number,
  path: string,
  theme: ThemeName,
  opts: RenderOpts,
): string {
  const t = THEMES[theme];
  const doubts = item.uncertain ?? [];
  const sub = item.tagLabel
    ? item.tagLabel
    : item.choices?.length
      ? 'CHOICE'
      : item.figures?.length
        ? 'GRAPH'
        : 'SOLVE';

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

  return `<section class="ws-item ws-problem c${((n - 1) % 5) + 1}">
    ${t.number(n, sub)}
    <div>${inner}</div>
  </section>`;
}

function conceptHtml(
  item: ConceptItem,
  path: string,
  theme: ThemeName,
  opts: RenderOpts,
): string {
  const t = THEMES[theme];
  const figs = (item.figures ?? []).filter((f) => f.src);
  const body = editable(
    runsToHtml(item.body),
    `${path}.body`,
    'ws-concept-body',
    'div',
    opts,
  );
  return `<section class="ws-item ws-concept">
    ${t.conceptTitle(escapeHtml(item.title ?? '핵심 개념'))}
    ${body}
    ${figs.map((f) => figureHtml(f, true)).join('')}
  </section>`;
}

function imageHtml(item: ImageItem): string {
  if (!item.src) return '';
  const cap = item.caption ? `<figcaption>${escapeHtml(item.caption)}</figcaption>` : '';
  return `<section class="ws-item ws-image"><figure><img src="${item.src}" alt="">${cap}</figure></section>`;
}

function itemHtml(
  item: WorksheetItem,
  n: number,
  path: string,
  theme: ThemeName,
  opts: RenderOpts,
): string {
  if (item.kind === 'problem') return problemHtml(item, n, path, theme, opts);
  if (item.kind === 'concept') return conceptHtml(item, path, theme, opts);
  return imageHtml(item);
}

function sectionsHtml(
  sections: DocSection[],
  theme: ThemeName,
  opts: RenderOpts,
): string {
  let n = 0;
  const out: string[] = [];
  sections.forEach((sec, si) => {
    sec.items.forEach((item, ii) => {
      if (item.kind === 'problem') n += 1;
      out.push(itemHtml(item, n, `s${si}.i${ii}`, theme, opts));
    });
  });
  return out.join('\n');
}

/** 완성본 한 편을 통째로 만든다 — 이 문자열만 있으면 어디서든 열린다. */
export function renderDocument(
  doc: PolishedDoc,
  theme: ThemeName,
  opts: RenderOpts = {},
): string {
  const t = THEMES[theme];
  const head = {
    title: escapeHtml(doc.meta.title || '학습지'),
    subtitle: escapeHtml(doc.meta.subtitle ?? ''),
    date: escapeHtml(doc.meta.date),
  };

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${head.title}</title>
<link rel="stylesheet" href="${FONT_CSS}">
<style>
${KATEX_CSS}
${BASE_CSS}
${t.css}
</style>
</head>
<body>
<div class="ws-page">${t.decor}<div class="ws-doc">
${t.header(head)}
${sectionsHtml(doc.sections, theme, opts)}
${t.footer(head)}
</div></div>
</body>
</html>`;
}
