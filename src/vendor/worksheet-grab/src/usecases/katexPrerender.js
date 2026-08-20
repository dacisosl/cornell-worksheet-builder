// katexPrerender — 수식을 **조립 시점에** 렌더한다(브라우저가 아니라).
//
// 종전에는 산출 HTML 에 `$…$` 평문을 담고 KaTeX auto-render 스크립트를 CDN 에서 받아
// 브라우저가 그렸다. 문제가 셋이었다:
//   1) 오프라인이면 수식이 안 그려진다. 게다가 측정 게이트(gateInPage)가 `renderMathInElement`
//      를 **타임아웃 없이** 기다려 무한 대기한다(실측: 15초 넘게 무반응).
//   2) 같은 문서가 네트워크 상태에 따라 다른 레이아웃을 낸다. PPTX 좌표가 여기 매달린다.
//   3) 산출물에 271KB 짜리 katex.min.js 를 실어야 한다.
// 조립 시점에 그리면 셋 다 사라진다. 산출 HTML 에는 결과 마크업과 CSS 만 남고,
// **기다릴 대상이 없으므로 무한 대기 경로 자체가 없어진다.**
//
// KaTeX 는 벤더된 UMD 빌드를 vm 으로 평가해 쓴다(npm 의존 0 — 정적 자산일 뿐이다).

// **이 모듈은 순수하다(node: import 0).** AssembleWorksheet·RenderObjectTree 가 이걸 import 하는데
// 그 둘은 편집기가 브라우저로 서빙하는 그래프 안에 있어서, node 내장을 끌어들이면 순수성 게이트가
// 깨진다(browserGraph 테스트가 실제로 잡았다). 그래서 KaTeX 엔진 로딩(vm 평가)은 여기 두지 않고
// Node 쪽 조달 모듈(selfContainedAssets)이 하고, 여기서는 **이미 만들어진 엔진 객체**를 받는다.

/** `$…$`(인라인) 와 `$$…$$`(디스플레이). 브라우저 auto-render 에 주던 델리미터와 같다. */
const DISPLAY = /\$\$([\s\S]{1,2000}?)\$\$/g;
const INLINE = /\$([^$\n]{1,500}?)\$/g;

/** 텍스트 노드라도 이 안이면 건드리지 않는다(코드·스크립트 안의 `$` 는 수식이 아니다). */
const SKIP_ELEMENTS = new Set(['script', 'style', 'code', 'pre', 'textarea', 'math']);

/**
 * HTML 의 **텍스트 노드에서만** 델리미터를 찾아 렌더된 마크업으로 바꾼다.
 *
 * 태그 안(속성값 등)과 SKIP_ELEMENTS 내부는 건드리지 않는다. 태그 속성의 `$` 를 치환하면
 * 문서가 깨지고, `<code>` 안의 `$` 는 대개 수식이 아니라 셸 프롬프트다.
 *
 * @param {string} html
 * @param {{renderToString:(tex:string, opts:object)=>string}} katex 조달된 KaTeX 엔진
 * @returns {{html:string, rendered:number, failed:Array<{tex:string, message:string}>}}
 */
export function prerenderMathInHtml(html, katex) {
  if (typeof html !== 'string') throw new TypeError('prerenderMathInHtml 은 html(string) 이 필요합니다.');
  if (typeof katex?.renderToString !== 'function') {
    throw new TypeError('prerenderMathInHtml 은 renderToString 을 가진 KaTeX 엔진이 필요합니다.');
  }

  let rendered = 0;
  const failed = [];

  const renderOne = (tex, displayMode) => {
    const src = decodeEntities(tex).trim();
    if (src === '') return null;
    try {
      const out = katex.renderToString(src, { displayMode, throwOnError: false, output: 'htmlAndMathml' });
      rendered++;
      return out;
    } catch (e) {
      failed.push({ tex: src, message: String(e?.message ?? e) });
      return null;
    }
  };

  const convert = (text) => {
    let out = text.replace(DISPLAY, (whole, tex) => renderOne(tex, true) ?? whole);
    out = out.replace(INLINE, (whole, tex) => renderOne(tex, false) ?? whole);
    return out;
  };

  const parts = [];
  let i = 0;
  const skipStack = [];

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      parts.push(skipStack.length ? html.slice(i) : convert(html.slice(i)));
      break;
    }
    // 태그 앞의 텍스트 노드
    const text = html.slice(i, lt);
    parts.push(skipStack.length ? text : convert(text));

    // 주석은 통째로 통과
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      const stop = end < 0 ? html.length : end + 3;
      parts.push(html.slice(lt, stop));
      i = stop;
      continue;
    }

    // 태그 끝 찾기(속성값 안의 '>' 무시)
    let j = lt + 1;
    let quote = null;
    while (j < html.length) {
      const ch = html[j];
      if (quote) { if (ch === quote) quote = null; } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') break;
      j++;
    }
    if (j >= html.length) { parts.push(html.slice(lt)); break; }

    const raw = html.slice(lt, j + 1);
    parts.push(raw);
    const body = html.slice(lt + 1, j);
    const name = /^\/?\s*([A-Za-z][\w.-]*)/.exec(body)?.[1]?.toLowerCase();
    if (name && SKIP_ELEMENTS.has(name)) {
      if (body.startsWith('/')) { if (skipStack[skipStack.length - 1] === name) skipStack.pop(); }
      else if (!body.trimEnd().endsWith('/')) skipStack.push(name);
    }
    i = j + 1;
  }

  return { html: parts.join(''), rendered, failed };
}

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&amp;/gi, '&');
}
