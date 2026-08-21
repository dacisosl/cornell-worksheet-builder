/**
 * 도판 준비 — 캡처에서 그림 영역만 잘라내고, 스캔 얼룩을 걷어내 인쇄에 쓸 만하게 만든다.
 *
 * 글은 다시 조판하지만 그림·그래프·표는 원본을 그대로 쓴다. 그래서 여기서 하는 일은
 * 잘라내기(bbox) → 배경 흰색화 → 흰 여백 잘라내기 → 선명하게, 이 네 가지뿐이다.
 */

import { loadImage, unsharp } from '../lib/imageProcessing';
import type { FigureRef } from './schema';

/** bbox 가 조금씩 어긋나도 그림이 잘리지 않게 두는 여유 */
const PAD = 0.02;

function canvasOf(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const g = c.getContext('2d', { willReadFrequently: true });
  return g ? { c, g } : null;
}

/** bbox(0..1) 영역을 잘라낸다 — images.ts 의 applyCrop 과 같은 캔버스 방식 */
function cropBBox(img: HTMLImageElement, bbox: [number, number, number, number]): HTMLCanvasElement | null {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const x = Math.max(0, (bbox[0] - PAD) * nw);
  const y = Math.max(0, (bbox[1] - PAD) * nh);
  const w = Math.min(nw - x, (bbox[2] + PAD * 2) * nw);
  const h = Math.min(nh - y, (bbox[3] + PAD * 2) * nh);
  if (w < 4 || h < 4) return null;

  const made = canvasOf(w, h);
  if (!made) return null;
  made.g.drawImage(img, Math.round(x), Math.round(y), Math.round(w), Math.round(h), 0, 0, made.c.width, made.c.height);
  return made.c;
}

/**
 * 스캔·촬영으로 회색이 된 종이 배경을 흰색으로 되돌린다.
 * 밝은 쪽 95백분위를 흰색으로 잡아 늘리므로, 잉크(어두운 쪽)는 그대로 남는다.
 */
function normalizeWhite(c: HTMLCanvasElement): void {
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return;
  const img = g.getImageData(0, 0, c.width, c.height);
  const px = img.data;

  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const lum = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    hist[Math.min(255, Math.max(0, Math.round(lum)))] += 1;
  }
  const total = px.length / 4;
  let acc = 0;
  let p95 = 255;
  for (let v = 0; v < 256; v += 1) {
    acc += hist[v];
    if (acc >= total * 0.95) {
      p95 = v;
      break;
    }
  }
  // 이미 충분히 흰 종이면 손대지 않는다.
  if (p95 >= 246 || p95 < 120) return;

  const scale = 255 / p95;
  for (let i = 0; i < px.length; i += 4) {
    px[i] = Math.min(255, px[i] * scale);
    px[i + 1] = Math.min(255, px[i + 1] * scale);
    px[i + 2] = Math.min(255, px[i + 2] * scale);
  }
  g.putImageData(img, 0, 0);
}

/** 사방의 완전히 흰 띠를 잘라낸다 — 캡처 여백 때문에 도판이 작아 보이는 걸 막는다 */
function trimMargins(c: HTMLCanvasElement): HTMLCanvasElement {
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return c;
  const { width: w, height: h } = c;
  const px = g.getImageData(0, 0, w, h).data;
  const WHITE = 244;

  const rowBlank = (y: number): boolean => {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      if (px[i] < WHITE || px[i + 1] < WHITE || px[i + 2] < WHITE) return false;
    }
    return true;
  };
  const colBlank = (x: number): boolean => {
    for (let y = 0; y < h; y += 1) {
      const i = (y * w + x) * 4;
      if (px[i] < WHITE || px[i + 1] < WHITE || px[i + 2] < WHITE) return false;
    }
    return true;
  };

  let top = 0;
  let bottom = h - 1;
  let left = 0;
  let right = w - 1;
  while (top < bottom && rowBlank(top)) top += 1;
  while (bottom > top && rowBlank(bottom)) bottom -= 1;
  while (left < right && colBlank(left)) left += 1;
  while (right > left && colBlank(right)) right -= 1;

  const keep = 6; // 잘라낸 자리에 숨 쉴 여백은 남긴다
  top = Math.max(0, top - keep);
  left = Math.max(0, left - keep);
  bottom = Math.min(h - 1, bottom + keep);
  right = Math.min(w - 1, right + keep);

  const nw = right - left + 1;
  const nh = bottom - top + 1;
  if (nw < 8 || nh < 8 || (nw === w && nh === h)) return c;

  const made = canvasOf(nw, nh);
  if (!made) return c;
  made.g.drawImage(c, left, top, nw, nh, 0, 0, nw, nh);
  return made.c;
}

/** 정리한 도판을 dataURL 로 — 실패하면 원본 캡처를 그대로 돌려준다 */
export async function prepareFigure(
  captureSrc: string,
  bbox: [number, number, number, number],
): Promise<string> {
  try {
    const img = await loadImage(captureSrc);
    const cropped = cropBBox(img, bbox);
    if (!cropped) return captureSrc;
    normalizeWhite(cropped);
    const trimmed = trimMargins(cropped);
    const url = trimmed.toDataURL('image/png');
    const reloaded = await loadImage(url);
    return unsharp(reloaded) ?? url;
  } catch {
    return captureSrc;
  }
}

/**
 * 문서 안의 모든 FigureRef 에 잘라낸 도판을 채워 넣는다.
 * src 는 저장하지 않으므로(용량) 문서를 열 때마다 여기서 다시 만든다.
 */
export async function fillFigures(
  refs: FigureRef[],
  captureSrc: (from: string) => string | undefined,
): Promise<void> {
  for (const ref of refs) {
    if (ref.src) continue;
    const src = captureSrc(ref.from);
    if (!src) continue;
    ref.src = await prepareFigure(src, ref.bbox);
  }
}
