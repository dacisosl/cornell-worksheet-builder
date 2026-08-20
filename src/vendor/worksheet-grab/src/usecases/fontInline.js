// fontInline — @font-face 를 data URI 로 인라인해 산출 HTML 의 **외부 URL 을 0개로** 만든다.
//
// 왜: 본문 폰트(Pretendard)와 수식 폰트(KaTeX)가 CDN 에서 왔다. 오프라인이면 대체 폰트로
// 떨어지고, 한글은 자폭·행간이 달라 **레이아웃이 바뀐다**. 파일을 다른 PC 나 피그마로 넘겨도 같다.
//
// 크기는 **문서가 실제 쓰는 조각만 고르는 것**으로 푼다. Pretendard 가변 dynamic-subset 은
// unicode-range 로 92조각이라, 문서 텍스트의 코드포인트에 걸리는 조각만 넣으면 된다
// (실측: 활동지 한 편이 262 코드포인트로 17조각). 정적 빌드 굵기 9종 6.58MB 대비 596KB 다.
// **폰트 파일을 파싱하지 않는다** — CSS 의 unicode-range 와 문서 텍스트만 본다(무의존 유지).

/** @font-face 블록 하나를 파싱한다. */
function parseFaces(css) {
  const faces = [];
  for (const m of String(css).matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = m[1];
    const urls = [...body.matchAll(/url\(([^)]+)\)/g)].map((u) => u[1].replace(/['"]/g, ''));
    const range = /unicode-range\s*:\s*([^;]+)/.exec(body)?.[1]?.trim() ?? null;
    faces.push({ whole: m[0], body, urls, range });
  }
  return faces;
}

/**
 * `U+AC00-D7A3, U+1100-11FF` 형태가 주어진 코드포인트 집합과 겹치는가.
 * `U+31??` 같은 와일드카드도 처리한다.
 */
export function rangeIntersects(range, codepoints) {
  if (!range) return true; // unicode-range 가 없으면 전 범위 담당(보수적으로 포함)
  for (const part of range.split(',')) {
    const t = part.trim().replace(/^U\+/i, '');
    if (t === '') continue;
    let lo; let hi;
    if (t.includes('-')) {
      [lo, hi] = t.split('-').map((x) => parseInt(x, 16));
    } else if (t.includes('?')) {
      lo = parseInt(t.replace(/\?/g, '0'), 16);
      hi = parseInt(t.replace(/\?/g, 'F'), 16);
    } else {
      lo = parseInt(t, 16); hi = lo;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    for (const c of codepoints) if (c >= lo && c <= hi) return true;
  }
  return false;
}

/** HTML 에서 **화면에 보일 텍스트**의 코드포인트를 모은다(태그·스크립트·스타일 제외). */
export function collectCodepoints(html) {
  const text = String(html)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  const cps = new Set();
  for (const ch of text) cps.add(ch.codePointAt(0));
  return cps;
}

/**
 * CSS 의 @font-face 를 필요한 것만 남기고 data URI 로 바꾼다.
 *
 * @param {string} css 벤더 CSS(상대경로 url 사용)
 * @param {(relPath:string)=>Promise<Buffer|null>} readFont 상대경로 -> 폰트 바이트(없으면 null)
 * @param {{codepoints?:Set<number>|null, mime?:string}} opts
 *   codepoints 가 null 이면 **전부** 인라인한다(KaTeX 처럼 범위를 예측할 수 없는 경우).
 * @returns {Promise<{css:string, inlined:number, skipped:number, bytes:number}>}
 */
export async function inlineFontFaces(css, readFont, { codepoints = null, mime = 'font/woff2' } = {}) {
  const faces = parseFaces(css);
  let out = String(css);
  let inlined = 0; let skipped = 0; let bytes = 0;

  for (const face of faces) {
    const needed = codepoints ? rangeIntersects(face.range, codepoints) : true;
    if (!needed) {
      // 안 쓰는 조각은 **블록째 지운다.** src 만 비우면 브라우저가 빈 url 을 요청한다.
      out = out.split(face.whole).join('');
      skipped++;
      continue;
    }
    let body = face.body;
    let loaded = false;
    for (const url of face.urls) {
      if (url.startsWith('data:')) { loaded = true; continue; }
      const buf = await readFont(url);
      if (!buf) continue;
      bytes += buf.length;
      body = body.split(`url(${url})`).join(`url(data:${mime};base64,${buf.toString('base64')})`);
      // 따옴표가 있는 형태도 처리
      body = body.split(`url("${url}")`).join(`url(data:${mime};base64,${buf.toString('base64')})`);
      body = body.split(`url('${url}')`).join(`url(data:${mime};base64,${buf.toString('base64')})`);
      loaded = true;
    }
    // data URI 로 못 바꾼 상대경로 src 는 걷어낸다(오프라인에서 요청이 새는 것을 막는다).
    body = body.replace(/,?\s*url\((?!data:)[^)]*\)(\s*format\([^)]*\))?/g, '');
    if (!loaded) { out = out.split(face.whole).join(''); skipped++; continue; }
    out = out.split(face.whole).join(`@font-face {${body}}`);
    inlined++;
  }

  return { css: out, inlined, skipped, bytes };
}

/**
 * inlineFontFaces 의 동기판. `buildDocumentHtml` 이 동기 함수라 여기서 await 을 할 수 없어,
 * 바이트를 미리 읽어 둔 Map 을 받는다(조달은 selfContainedAssets 소관).
 *
 * @param {string} css
 * @param {Map<string,Buffer>} chunks 상대경로 -> 바이트
 * @param {{codepoints?:Set<number>|null, mime?:string}} opts
 */
export function inlineFontFacesSync(css, chunks, { codepoints = null, mime = 'font/woff2' } = {}) {
  const faces = parseFaces(css);
  let out = String(css);
  let inlined = 0; let skipped = 0; let bytes = 0;

  for (const face of faces) {
    if (codepoints && !rangeIntersects(face.range, codepoints)) {
      out = out.split(face.whole).join('');
      skipped++;
      continue;
    }
    let body = face.body;
    let loaded = false;
    for (const url of face.urls) {
      if (url.startsWith('data:')) { loaded = true; continue; }
      const buf = chunks.get(url);
      if (!buf) continue;
      bytes += buf.length;
      const uri = `url(data:${mime};base64,${buf.toString('base64')})`;
      for (const form of [`url(${url})`, `url("${url}")`, `url('${url}')`]) body = body.split(form).join(uri);
      loaded = true;
    }
    body = body.replace(/,?\s*url\((?!data:)[^)]*\)(\s*format\([^)]*\))?/g, '');
    if (!loaded) { out = out.split(face.whole).join(''); skipped++; continue; }
    out = out.split(face.whole).join(`@font-face {${body}}`);
    inlined++;
  }
  return { css: out, inlined, skipped, bytes };
}

/** 산출물에 외부 URL 이 남았는지 확인한다(자기완결의 기계 판정). */
export function findExternalUrls(html) {
  const found = new Set();
  for (const m of String(html).matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g)) {
    if (/^(https?:)?\/\//i.test(m[1])) found.add(m[1]);
  }
  for (const m of String(html).matchAll(/url\(([^)]+)\)/g)) {
    const u = m[1].replace(/['"]/g, '').trim();
    if (/^(https?:)?\/\//i.test(u)) found.add(u);
  }
  return [...found];
}
