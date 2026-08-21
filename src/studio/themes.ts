/**
 * 완성본 디자인 테마 5종.
 *
 * 문항 마크업은 테마와 무관하게 똑같다(.ws-item / .ws-no / .ws-stem …).
 * 테마가 정하는 건 CSS, 그리고 그 테마에서만 뜻이 통하는 장식 마크업이다 —
 * 리소의 스탬프와 바코드, 블루프린트의 표제란, 스티커의 별 배지 같은 것들.
 */

import baseCss from './themes/base.css?raw';
import risoCss from './themes/riso.css?raw';
import editorialCss from './themes/editorial.css?raw';
import stickerCss from './themes/sticker.css?raw';
import monoCss from './themes/mono.css?raw';
import blueprintCss from './themes/blueprint.css?raw';

export type ThemeName = 'riso' | 'editorial' | 'sticker' | 'mono' | 'blueprint';

export interface DocHead {
  title: string;
  subtitle: string;
  date: string;
}

export interface Theme {
  name: ThemeName;
  label: string;
  blurb: string;
  css: string;
  /** 페이지 안쪽 맨 앞에 깔리는 장식 (체커보드, 코너 마크 등) */
  decor: string;
  header: (h: DocHead) => string;
  footer: (h: DocHead) => string;
  /** 문항 번호 칸 */
  number: (n: number, sub: string) => string;
  /** 개념 상자 제목 */
  conceptTitle: (title: string) => string;
}

const FIELDS_KO: [string, string][] = [
  ['이름', ''],
  ['학년·반', ''],
  ['날짜', ''],
];
const FIELDS_EN: [string, string][] = [
  ['NAME', ''],
  ['CLASS', ''],
  ['DATE', ''],
];

function metaFields(labels: [string, string][]): string {
  return labels
    .map(([l]) => `<div class="ws-meta-field"><b>${l}</b><span></span></div>`)
    .join('');
}

export const BASE_CSS = baseCss;

export const THEMES: Record<ThemeName, Theme> = {
  riso: {
    name: 'riso',
    label: '리소그래프 진',
    blurb: '2도 인쇄 · 판 어긋남 · 스탬프 · 바코드',
    css: risoCss,
    decor: '',
    header: (h) => `
  <div class="ws-meta-top">
    <span>WORKSHEET · RISO CLUB EDITION</span>
    <span>2-DO PRINT · BLUE × NEON ORANGE</span>
  </div>
  <header class="ws-title-wrap">
    <h1 class="ws-title">${h.title}${h.subtitle ? `<span class="en">${h.subtitle}</span>` : ''}</h1>
    <div class="ws-stamp">오늘도<br>풀었다!</div>
  </header>
  <div class="ws-meta">${metaFields(FIELDS_EN)}</div>
  <div class="ws-cut">✂</div>`,
    footer: (h) => `
  <footer class="ws-foot">
    <div class="txt">${h.title}<br>PRINTED IN MY DESK · KEEP THIS SHEET</div>
    <div class="ws-barcode"></div>
  </footer>`,
    number: (n, sub) => `<div class="ws-no">Q${n}<small>${sub}</small></div>`,
    conceptTitle: (t) => `<div class="ws-concept-title">Concept — ${t}</div>`,
  },

  editorial: {
    name: 'editorial',
    label: '오버사이즈 에디토리얼',
    blurb: '거대 아웃라인 번호 · 코발트 블루 · 스펙시트 헤더',
    css: editorialCss,
    decor: '',
    header: (h) => `
  <header class="ws-spec">
    <div class="ws-spec-l">
      <div class="ws-spec-kicker"><span>WORKSHEET</span><span>${h.date}</span></div>
      <h1 class="ws-title">${h.title}${h.subtitle ? `<br><span class="thin">${h.subtitle}</span>` : ''}</h1>
    </div>
    <div class="ws-spec-r">
      ${FIELDS_EN.map(([l]) => `<div class="ws-spec-cell"><b>${l}</b><span></span></div>`).join('')}
    </div>
  </header>
  <div class="ws-strip">
    <span><span class="dot">●</span> ${h.title}</span>
    <span>${h.subtitle}</span>
  </div>`,
    footer: (h) => `
  <footer class="ws-foot">
    <span>${h.title}</span>
    <span>${h.date}</span>
    <span class="pg">1/1</span>
  </footer>`,
    number: (n, sub) => `<div class="ws-no">${String(n).padStart(2, '0')}<small>${sub}</small></div>`,
    conceptTitle: (t) => `<div class="ws-concept-title"><em>CONCEPT</em>${t}</div>`,
  },

  sticker: {
    name: 'sticker',
    label: '키치 스티커 팩',
    blurb: '다이컷 카드 · 체커보드 · 별 스티커',
    css: stickerCss,
    decor: '<div class="ws-checker"></div>',
    header: (h) => `
  <header class="ws-header">
    <span class="ws-kicker">${h.subtitle || h.date}</span>
    <div class="ws-star">
      <svg viewBox="0 0 60 60"><path d="M30 3l6.6 15.9L54 20.4 41.4 32.1 44.7 49 30 40.2 15.3 49l3.3-16.9L6 20.4l17.4-1.5z"
        fill="#ffd23e" stroke="#1c1b1a" stroke-width="2.6" stroke-linejoin="round"/>
        <text x="30" y="35" text-anchor="middle" font-size="11" font-weight="900" font-family="Pretendard,sans-serif">GO!</text></svg>
    </div>
    <h1 class="ws-title"><span class="hl">${h.title}</span></h1>
    <div class="ws-meta">${metaFields(FIELDS_KO)}</div>
  </header>`,
    footer: (h) => `
  <footer class="ws-foot">
    <span>${h.title} ✶ 다 풀면 스티커 붙이기 ⬜⬜⬜</span>
    <span class="pg">1 / 1</span>
  </footer>`,
    number: (n) => `<div class="ws-no">
      <svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="${
        ['#7cb8ff', '#ff8fb2', '#c9a8ff', '#8fe0b0', '#ffd23e'][(n - 1) % 5]
      }" stroke="#1c1b1a" stroke-width="2.4"/></svg>
      <span style="position:relative">${n}</span></div>`,
    conceptTitle: (t) => `<div class="ws-concept-title">💡 ${t}</div>`,
  },

  mono: {
    name: 'mono',
    label: '모노 미니멀',
    blurb: '흑백 헤어라인 · 넉넉한 여백 · 버밀리언 포인트',
    css: monoCss,
    decor: '',
    header: (h) => `
  <header class="ws-header">
    <div class="ws-over"><span><b>—</b>&nbsp; WORKSHEET</span><span>${h.date}</span></div>
    <h1 class="ws-title">${h.title}</h1>
    <div class="ws-bar"></div>
    <div class="ws-meta">${metaFields(FIELDS_KO)}</div>
  </header>`,
    footer: (h) => `
  <footer class="ws-foot">
    <span>${h.title}</span>
    <span class="pg"><b>·</b> 1 / 1</span>
  </footer>`,
    number: (n, sub) => `<div class="ws-no">${String(n).padStart(2, '0')}<small>${sub}</small></div>`,
    conceptTitle: (t) => `<div class="ws-concept-title">CONCEPT — ${t}</div>`,
  },

  blueprint: {
    name: 'blueprint',
    label: '블루프린트',
    blurb: '제도 블루 · 도트 그리드 · 치수선 · 표제란',
    css: blueprintCss,
    decor:
      '<div class="ws-cross tl"></div><div class="ws-cross tr"></div>' +
      '<div class="ws-cross bl"></div><div class="ws-cross br"></div>',
    header: (h) => `
  <header class="ws-header">
    <div class="ws-over">
      <span class="sheet">SHEET A-01</span>
      <span>MATH WORKSHEET</span>
      <span>${h.date}</span>
    </div>
    <div class="ws-head-grid">
      <div>
        <h1 class="ws-title">${h.title}</h1>
        ${h.subtitle ? `<div class="ws-subtitle">${h.subtitle}</div>` : ''}
        <div class="ws-dim"><span class="bar"></span><span class="lab">WORKSHEET</span></div>
      </div>
      <div class="ws-meta">${metaFields(FIELDS_EN)}</div>
    </div>
  </header>`,
    footer: (h) => `
  <footer class="ws-foot">
    <span><b>PROJECT</b> ${h.title}</span>
    <span class="grow"><b>DATE</b> ${h.date}</span>
    <span><b>SCALE</b> NTS</span>
    <span class="pg"><b>SHEET</b> 1 / 1</span>
  </footer>`,
    number: (n, sub) => `<div class="ws-no"><span class="disc">${n}</span><small>${sub}</small></div>`,
    conceptTitle: (t) => `<div class="ws-concept-title">NOTE — ${t}</div>`,
  },
};

export const THEME_ORDER: ThemeName[] = ['riso', 'editorial', 'sticker', 'mono', 'blueprint'];

export function isThemeName(v: unknown): v is ThemeName {
  return typeof v === 'string' && v in THEMES;
}
