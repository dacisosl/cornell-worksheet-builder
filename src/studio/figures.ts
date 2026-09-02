/**
 * 도판 준비 — 캡처에서 그림 영역만 잘라내고, 스캔 얼룩을 걷어내 인쇄에 쓸 만하게 만든다.
 *
 * 글은 다시 조판하지만 그림·그래프·표는 원본을 그대로 쓴다. 그래서 여기서 하는 일은
 * 잘라내기(bbox) → 배경 흰색화 → 흰 여백 잘라내기 → 선명하게, 이 네 가지뿐이다.
 *
 * 잘라낸 뒤 **실제로 덮는 영역(box)** 도 함께 돌려준다. 여유를 두고 잘라 여백을 다듬으면
 * 영역이 조금 달라지는데, 조판은 그 실제 영역에 그림을 앉혀야 초안 크기와 맞는다.
 */

import { loadImage, unsharp } from '../lib/imageProcessing';
import { compose } from './snapshot';
import type { FigureRef, Rect } from './schema';

/** bbox 가 조금씩 어긋나도 그림이 잘리지 않게 두는 여유 */
const PAD = 0.02;

function canvasOf(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const g = c.getContext('2d', { willReadFrequently: true });
  return g ? { c, g } : null;
}

/** bbox(0..1) 영역을 여유를 두고 잘라낸다. 잘라낸 픽셀 영역도 함께. */
function cropBBox(
  img: HTMLImageElement,
  bbox: Rect,
): { c: HTMLCanvasElement; x: number; y: number; w: number; h: number } | null {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const x = Math.max(0, Math.round((bbox[0] - PAD) * nw));
  const y = Math.max(0, Math.round((bbox[1] - PAD) * nh));
  const w = Math.round(Math.min(nw - x, (bbox[2] + PAD * 2) * nw));
  const h = Math.round(Math.min(nh - y, (bbox[3] + PAD * 2) * nh));
  if (w < 4 || h < 4) return null;

  const made = canvasOf(w, h);
  if (!made) return null;
  made.g.drawImage(img, x, y, w, h, 0, 0, made.c.width, made.c.height);
  return { c: made.c, x, y, w, h };
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
function trimMargins(c: HTMLCanvasElement): { c: HTMLCanvasElement; left: number; top: number } {
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return { c, left: 0, top: 0 };
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
  if (nw < 8 || nh < 8 || (nw === w && nh === h)) return { c, left: 0, top: 0 };

  const made = canvasOf(nw, nh);
  if (!made) return { c, left: 0, top: 0 };
  made.g.drawImage(c, left, top, nw, nh, 0, 0, nw, nh);
  return { c: made.c, left, top };
}

/**
 * 정리한 도판을 dataURL 로, 실제로 덮는 영역(원본 대비 비율)과 함께.
 * 실패하면 원본을 그대로, 영역은 bbox 그대로 돌려준다.
 */
export async function prepareFigure(
  src: string,
  bbox: Rect,
): Promise<{ src: string; box: Rect; aspect: number }> {
  try {
    const img = await loadImage(src);
    const cropped = cropBBox(img, bbox);
    if (!cropped) return { src, box: bbox, aspect: img.naturalWidth / Math.max(1, img.naturalHeight) };
    normalizeWhite(cropped.c);
    const trimmed = trimMargins(cropped.c);
    const nw = Math.max(1, img.naturalWidth);
    const nh = Math.max(1, img.naturalHeight);
    const box: Rect = [
      (cropped.x + trimmed.left) / nw,
      (cropped.y + trimmed.top) / nh,
      trimmed.c.width / nw,
      trimmed.c.height / nh,
    ];
    const url = trimmed.c.toDataURL('image/png');
    const reloaded = await loadImage(url);
    return { src: unsharp(reloaded) ?? url, box, aspect: trimmed.c.width / Math.max(1, trimmed.c.height) };
  } catch {
    return { src, box: bbox, aspect: bbox[2] / Math.max(1e-6, bbox[3]) };
  }
}

/**
 * 문서 안의 모든 FigureRef 에 잘라낸 도판을 채워 넣는다.
 * 원본 이미지 한 장 안에 들어가는 그림은 그 이미지에서(해상도가 좋다), 아니면 캡처에서
 * 자른다. box 는 어느 쪽이든 **캡처(문제칸) 대비 비율**로 맞춰 둔다.
 * src 는 저장하지 않으므로(용량) 문서를 열 때마다 여기서 다시 만든다.
 */
export async function fillFigures(
  refs: FigureRef[],
  captureSrc: (from: string) => string | undefined,
  imageSrc: (imgId: number) => string | undefined,
): Promise<void> {
  for (const ref of refs) {
    if (ref.src) continue;
    const origin = ref.source ? imageSrc(ref.source.imgId) : undefined;
    if (ref.source && origin) {
      const r = await prepareFigure(origin, ref.source.bbox);
      ref.src = r.src;
      ref.box = compose(ref.source.at, r.box);
      ref.aspect = r.aspect;
      continue;
    }
    const cap = captureSrc(ref.from);
    if (!cap) continue;
    const r = await prepareFigure(cap, ref.bbox);
    ref.src = r.src;
    ref.box = r.box;
    ref.aspect = r.aspect;
  }
}
