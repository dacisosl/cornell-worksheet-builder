/**
 * 그림 다시 그리기 — 캡처에서 잘라낸 도판(그래프·도형·표)을 vision 모델로 **벡터(SVG)**로
 * 다시 그린다. 잘라 붙인 캡처는 해상도·배경 얼룩이 남지만, 다시 그린 벡터는 인쇄에서
 * 또렷하고 디자인의 잉크색을 그대로 따른다.
 *
 * 원칙
 * - 크기는 바꾸지 않는다. SVG 는 잘라낸 그림과 같은 가로/세로 비의 상자 안에 들어가고,
 *   그 상자는 초안에서 그림이 차지하던 자리·폭에 그대로 앉는다(typeset).
 * - 만들어 내지 않는다. 보이는 요소만 옮기고, 사진·캐릭터·삽화처럼 벡터로 옮길 수 없는
 *   그림은 null — 원본 캡처를 그대로 쓴다.
 * - 믿지 않는다. 모델이 준 SVG 는 허용 목록으로 정제한다: 스크립트·외부 참조·이미지 금지.
 * - 교사가 확인한다. 미리보기에서 그림을 클릭하면 원본과 다시 그린 것을 바꿔 볼 수 있다.
 */

import { complete, ModelError, parseJsonLoose, type AiSettings } from '../lib/aiClient';
import type { FigureRef } from './schema';

const MAX_SVG_CHARS = 24_000;

const ALLOWED_TAGS = new Set([
  'svg', 'g', 'path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse',
  'text', 'tspan', 'defs', 'marker', 'title', 'desc', 'clippath',
]);

/** 이런 속성은 통째로 버린다 — 이벤트·외부 참조·스크립트 통로 */
function badAttr(name: string, value: string): boolean {
  const n = name.toLowerCase();
  if (n.startsWith('on')) return true;
  if (n === 'href' || n === 'xlink:href' || n === 'src') return true;
  const v = value.toLowerCase();
  if (v.includes('url(') || v.includes('expression(') || v.includes('javascript:')) return true;
  return false;
}

/**
 * 모델이 준 SVG 문자열을 정제한다. 모양이 어긋나거나 위험하면 null.
 * 루트의 width/height 는 지우고 viewBox 만 남겨 조판이 크기를 정하게 한다.
 */
export function sanitizeSvg(raw: string): string | null {
  const text = raw.trim();
  if (!text.startsWith('<svg') || text.length > MAX_SVG_CHARS) return null;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  } catch {
    return null;
  }
  if (doc.querySelector('parsererror')) return null;
  const root = doc.documentElement;
  if (root.nodeName.toLowerCase() !== 'svg') return null;

  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (!ALLOWED_TAGS.has(el.nodeName.toLowerCase())) {
      el.remove();
      continue;
    }
    for (const a of Array.from(el.attributes)) {
      if (badAttr(a.name, a.value)) el.removeAttribute(a.name);
    }
  }
  for (const a of Array.from(root.attributes)) {
    if (badAttr(a.name, a.value)) root.removeAttribute(a.name);
  }

  // viewBox 가 없으면 width/height 로 만든다. 그래도 없으면 크기를 정할 수 없다.
  if (!root.getAttribute('viewBox')) {
    const w = parseFloat(root.getAttribute('width') ?? '');
    const h = parseFloat(root.getAttribute('height') ?? '');
    if (!(w > 0 && h > 0)) return null;
    root.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  root.removeAttribute('width');
  root.removeAttribute('height');
  root.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  // 그린 게 없으면(빈 껍데기) 실패로 본다.
  if (!root.querySelector('path, line, polyline, polygon, rect, circle, ellipse, text')) return null;

  return new XMLSerializer().serializeToString(root);
}

function redrawPrompt(aspect: number): string {
  const W = 300;
  const H = Math.max(40, Math.round(W / Math.max(0.2, Math.min(5, aspect))));
  return `이 그림은 수학 학습지에서 잘라낸 도판이다. 이것을 **SVG 벡터로 충실히 다시 그려라.**

규칙
- 보이는 것만 옮긴다: 좌표축·화살표·격자·곡선·직선·점·점선·라벨·표의 칸과 글. 없는 요소를 더하거나 수치·글자를 바꾸지 마라.
- viewBox="0 0 ${W} ${H}" 로 그린다(원본과 같은 비율). width·height 속성은 넣지 않는다.
- 색은 두 가지만: 주선·글자 #1A1A1A, 보조선·점선 #6E6E6E. 배경·면 색은 넣지 않는다(투명).
- 곡선은 <path> 로 매끈하게. 표시된 점(A, B, 접점 등)이 곡선 위에 정확히 놓이게 좌표를 맞춘다.
- 글자는 <text> 로. 변수·점 이름은 font-family="serif" font-style="italic", 나머지 글은 font-family="sans-serif". font-size 는 ${Math.round(W / 22)} 안팎.
- 선 굵기: 곡선 2.2, 축 1.2, 보조선 0.8.
- <script>, <image>, <foreignObject>, <style>, href, url() 은 절대 쓰지 않는다.
- 사진·캐릭터·삽화·스크린숏처럼 벡터로 옮길 수 없는 그림이면 그리지 말고 svg 를 null 로 둔다.

출력은 JSON 객체 하나뿐이다. 설명이나 코드펜스는 붙이지 마라.
{"svg":"<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 ${W} ${H}\\">...</svg>"} 또는 {"svg":null}`;
}

/**
 * 도판 하나를 다시 그린다. 옮길 수 없는 그림이거나 결과가 어긋나면 null.
 * 모델·키 문제(ModelError)는 그대로 던진다 — 호출부가 나머지를 멈춘다.
 */
export async function redrawFigure(
  settings: AiSettings,
  ref: FigureRef,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!ref.src) return null;
  const aspect = ref.aspect && ref.aspect > 0 ? ref.aspect : 1.4;
  const text = await complete(settings, {
    system: '당신은 교과서 도판을 정확한 SVG 벡터로 옮기는 제도사다. 보이는 것만 그리고, 없는 것은 그리지 않는다.',
    user: redrawPrompt(aspect),
    images: [ref.src],
    json: true,
    signal,
  });
  let raw: unknown;
  try {
    raw = parseJsonLoose<unknown>(text);
  } catch {
    return null;
  }
  const svg = (raw as { svg?: unknown } | null)?.svg;
  if (typeof svg !== 'string') return null;
  return sanitizeSvg(svg);
}

/**
 * 문서의 도판을 최대 2개씩 동시에 다시 그린다. 이미 그린 것은 건너뛴다.
 * 모델·키 문제가 나면 남은 그림은 부르지 않고 그 오류를 돌려준다.
 */
export async function redrawAll(
  settings: AiSettings,
  refs: FigureRef[],
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ drawn: number; fatal?: string }> {
  const todo = refs.filter((r) => r.src && r.svg === undefined);
  let next = 0;
  let done = 0;
  let drawn = 0;
  let fatal: string | undefined;

  async function worker(): Promise<void> {
    while (next < todo.length && !fatal) {
      if (signal?.aborted) return;
      const ref = todo[next++];
      try {
        const svg = await redrawFigure(settings, ref, signal);
        // null 은 "옮길 수 없는 그림"이라는 답 — 다음에 다시 묻지 않도록 빈 문자열로 남긴다.
        ref.svg = svg ?? '';
        if (svg) drawn += 1;
      } catch (e) {
        if (e instanceof ModelError) fatal = e.message;
        // 그 외 실패는 그 그림만 원본으로 둔다 (svg 는 undefined 로 남아 다음에 다시 시도).
      }
      done += 1;
      onProgress(done, todo.length);
    }
  }

  await Promise.all([worker(), worker()]);
  return { drawn, fatal };
}
