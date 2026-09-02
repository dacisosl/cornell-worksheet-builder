/**
 * 초안 굽기 — 편집 중인 쪽을 **PDF처럼 한 장의 그림**으로 만들고, 같은 순간에
 * 칸·패널·이미지의 자리를 잰다.
 *
 * 두 일은 서로 독립이다. 좌표는 DOM에서 재고(항상 성공), 픽셀은 html2canvas가
 * 만든다(실패할 수 있다). 그래서 굽기가 실패해도 배치는 그대로 지켜지고,
 * 캡처만 이미지 조각을 다시 합성해 채운다.
 *
 * 좌표는 전부 **그 쪽 .stack(본문 영역) 대비 비율**이다. 완성본 조판은 이 비율을
 * 자기 본문 영역에 퍼센트로 그대로 앉힌다 — 초안과 같은 자리, 같은 크기.
 */

import { loadImage } from '../lib/imageProcessing';
import type { ImageObj } from '../types';
import type { Rect } from './schema';

export type PanelKey = 'prob' | 'sol' | 'ex' | 'cimg' | 'main';

/** 패널 안의 이미지 한 장 — rect 는 패널 대비 비율 */
export interface ImgBox {
  imgId: number;
  rect: Rect;
}

/** 초안 블록 하나의 자리 (stack 대비 비율) */
export interface BlockSnap {
  blockId: number;
  page: number;
  rect: Rect;
  /** 제목행 — 숨긴 블록은 없다 */
  head?: Rect;
  /** 제목행을 숨긴 블록(테두리 없음) */
  bare: boolean;
  /** 쪽 아래로 넘쳐 잘린 블록 */
  clipped: boolean;
  panels: Partial<Record<PanelKey, Rect>>;
  imgs: Partial<Record<PanelKey, ImgBox[]>>;
}

export interface PageSnap {
  index: number;
  canvas: HTMLCanvasElement | null;
  pageRect: DOMRect;
  stackRect: DOMRect;
}

export interface Bake {
  pages: PageSnap[];
  blocks: Map<number, BlockSnap>;
  /** 모든 쪽의 그림이 만들어졌는지 */
  rasterized: boolean;
}

export interface PrintLayout {
  enter(): void;
  exit(): void;
}

/** 캡처 한 장의 최대 변 길이(px) — 화질과 요청 크기의 균형점 */
export const CELL_MAX_SIDE = 2600;

const FIELD_OF: Record<PanelKey, string> = {
  prob: '.f-prob',
  sol: '.f-sol',
  ex: '.f-ex',
  cimg: '.f-cimg',
  main: '.f-main',
};

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** 요소의 자리를 기준 사각형 대비 비율로 */
function frac(el: Element, base: DOMRect): Rect {
  const r = el.getBoundingClientRect();
  const w = Math.max(1, base.width);
  const h = Math.max(1, base.height);
  return [(r.left - base.left) / w, (r.top - base.top) / h, r.width / w, r.height / h];
}

/** 기준 밖으로 나간 부분을 잘라낸다 — 화면에서도 그만큼만 보인다 */
function clampRect(r: Rect): Rect {
  const x0 = clamp01(r[0]);
  const y0 = clamp01(r[1]);
  const x1 = clamp01(r[0] + r[2]);
  const y1 = clamp01(r[1] + r[3]);
  return [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
}

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

function pageElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('#sheetBook .sheet-page'));
}

/** 지금 화면에 잡혀 있는 쪽·칸·패널·이미지 자리를 전부 잰다 */
function measure(pageEls: HTMLElement[]): { pages: PageSnap[]; blocks: Map<number, BlockSnap> } {
  const pages: PageSnap[] = [];
  const blocks = new Map<number, BlockSnap>();

  pageEls.forEach((pageEl, pi) => {
    const stack = pageEl.querySelector<HTMLElement>('.stack');
    const pageRect = pageEl.getBoundingClientRect();
    const stackRect = stack?.getBoundingClientRect() ?? pageRect;
    pages.push({ index: pi, canvas: null, pageRect, stackRect });
    if (!stack) return;

    for (const blockEl of stack.querySelectorAll<HTMLElement>('.block[data-id]')) {
      const id = Number(blockEl.dataset.id);
      if (!Number.isFinite(id)) continue;
      const raw = frac(blockEl, stackRect);
      const bare = blockEl.classList.contains('headless');
      const headEl = bare ? null : blockEl.querySelector<HTMLElement>('.bhead:not(.compact)');
      const head = headEl && headEl.offsetHeight > 0 ? clampRect(frac(headEl, stackRect)) : undefined;

      const panels: Partial<Record<PanelKey, Rect>> = {};
      const imgs: Partial<Record<PanelKey, ImgBox[]>> = {};
      for (const key of Object.keys(FIELD_OF) as PanelKey[]) {
        const field = blockEl.querySelector(FIELD_OF[key]);
        const panel = field?.closest<HTMLElement>('.panel');
        if (!panel) continue;
        panels[key] = clampRect(frac(panel, stackRect));
        const layer = panel.querySelector<HTMLElement>('.img-layer');
        if (layer) {
          const pr = panel.getBoundingClientRect();
          imgs[key] = Array.from(layer.querySelectorAll<HTMLElement>('.imgobj')).map((o) => ({
            imgId: Number(o.dataset.img),
            rect: frac(o, pr),
          }));
        }
      }

      blocks.set(id, {
        blockId: id,
        page: pi,
        rect: clampRect(raw),
        head,
        bare,
        clipped: raw[1] + raw[3] > 1.002,
        panels,
        imgs,
      });
    }
  });

  return { pages, blocks };
}

/** 쪽에 붙은 캡처 중 가장 촘촘한 것이 원본 해상도를 지키는 배율 (2~3배) */
function pageScale(pageEl: HTMLElement): number {
  let k = 2;
  for (const img of pageEl.querySelectorAll<HTMLImageElement>('.imgobj img')) {
    if (img.clientWidth > 0 && img.naturalWidth > 0) k = Math.max(k, img.naturalWidth / img.clientWidth);
  }
  return Math.min(3, k);
}

/**
 * 초안을 굽는다. 인쇄 배치 모드로 들어가 편집 UI를 감춘 뒤 자리를 재고 쪽마다
 * 그림을 만들고, 무슨 일이 있어도 원래 화면으로 돌아온다.
 */
export async function bakeDraft(
  printLayout: PrintLayout,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Bake> {
  printLayout.enter();
  try {
    try {
      await document.fonts?.ready;
    } catch {
      /* 글꼴 API가 없으면 그냥 간다 */
    }
    await nextFrame();
    await nextFrame();

    const pageEls = pageElements();
    const { pages, blocks } = measure(pageEls);
    onProgress(0, pages.length);

    let rasterized = true;
    let html2canvas: typeof import('html2canvas').default | null = null;
    try {
      html2canvas = (await import('html2canvas')).default;
    } catch {
      rasterized = false;
    }

    if (html2canvas) {
      for (let i = 0; i < pageEls.length; i += 1) {
        if (signal?.aborted) break;
        try {
          pages[i].canvas = await html2canvas(pageEls[i], {
            scale: pageScale(pageEls[i]),
            backgroundColor: '#ffffff',
            logging: false,
            useCORS: false,
            // 미리보기 iframe·스튜디오 창·필기 도구는 종이의 일부가 아니다.
            ignoreElements: (el) =>
              el.tagName === 'IFRAME' ||
              !!el.closest('.st-overlay, .st-pill, .draw-tb-host, .notebar, .page-tools'),
          });
        } catch {
          rasterized = false;
        }
        onProgress(i + 1, pageEls.length);
      }
    }

    return { pages, blocks, rasterized: rasterized && pages.every((p) => p.canvas) };
  } finally {
    printLayout.exit();
  }
}

/** 큰 캔버스를 최대 변 길이 안으로 줄여 PNG dataURL 로 */
function toDataUrlCapped(src: HTMLCanvasElement): string {
  const k = Math.min(1, CELL_MAX_SIDE / Math.max(src.width, src.height));
  if (k >= 1) return src.toDataURL('image/png');
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * k));
  c.height = Math.max(1, Math.round(src.height * k));
  const g = c.getContext('2d');
  if (!g) return src.toDataURL('image/png');
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

/**
 * 구운 쪽에서 한 패널을 그대로 잘라낸다. 캡처가 곧 패널이므로 모델이 돌려주는
 * bbox(0~1)가 패널 좌표와 같아진다. 쪽 그림이 없으면 null.
 */
export function cropPanel(bake: Bake, blockId: number, key: PanelKey): string | null {
  const b = bake.blocks.get(blockId);
  const p = b?.panels[key];
  const page = b ? bake.pages[b.page] : undefined;
  if (!b || !p || !page?.canvas || p[2] <= 0 || p[3] <= 0) return null;

  const { canvas, pageRect, stackRect } = page;
  const kx = canvas.width / Math.max(1, pageRect.width);
  const ky = canvas.height / Math.max(1, pageRect.height);
  const sx = (stackRect.left - pageRect.left + p[0] * stackRect.width) * kx;
  const sy = (stackRect.top - pageRect.top + p[1] * stackRect.height) * ky;
  const sw = p[2] * stackRect.width * kx;
  const sh = p[3] * stackRect.height * ky;
  if (sw < 2 || sh < 2) return null;

  const c = document.createElement('canvas');
  c.width = Math.round(sw);
  c.height = Math.round(sh);
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(canvas, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return toDataUrlCapped(c);
}

/**
 * 쪽 그림이 없을 때의 대안 — 패널과 같은 비율의 흰 캔버스에 이미지들을 **패널 안
 * 자리 그대로** 그린다. 좌표계가 패널과 같아야 bbox 가 그대로 맞는다.
 * (타이핑한 글은 담기지 않는다 — 그건 참고 원문으로 따로 준다.)
 */
export async function compositePanel(
  bake: Bake,
  blockId: number,
  key: PanelKey,
  imgs: ImageObj[],
): Promise<string | null> {
  const b = bake.blocks.get(blockId);
  const p = b?.panels[key];
  const boxes = b?.imgs[key] ?? [];
  const page = b ? bake.pages[b.page] : undefined;
  if (!b || !p || !page || !boxes.length) return null;

  const pw = Math.max(1, p[2] * page.stackRect.width);
  const ph = Math.max(1, p[3] * page.stackRect.height);
  const srcOf = (im: ImageObj): string => (im.sharpened && im.sharpSrc ? im.sharpSrc : im.src);

  const placed: { el: HTMLImageElement; r: Rect }[] = [];
  for (const box of boxes) {
    const im = imgs.find((x) => x.id === box.imgId);
    if (!im) continue;
    try {
      placed.push({ el: await loadImage(srcOf(im)), r: box.rect });
    } catch {
      /* 깨진 이미지는 건너뛴다 */
    }
  }
  if (!placed.length) return null;

  // 가장 촘촘한 조각이 원본 해상도를 지키는 배율로, 캔버스 한도 안에서.
  let scale = 1;
  for (const { el, r } of placed) scale = Math.max(scale, el.naturalWidth / Math.max(1, r[2] * pw));
  scale = Math.max(0.2, Math.min(scale, 3, CELL_MAX_SIDE / Math.max(pw, ph)));

  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(pw * scale));
  c.height = Math.max(1, Math.round(ph * scale));
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = 'high';
  for (const { el, r } of placed) {
    g.drawImage(el, r[0] * c.width, r[1] * c.height, r[2] * c.width, r[3] * c.height);
  }
  return c.toDataURL('image/png');
}

/** 진행 상자에 보여 줄 작은 쪽 그림 */
export function thumbnailUrl(page: PageSnap, width = 140): string | null {
  if (!page.canvas) return null;
  const k = width / Math.max(1, page.canvas.width);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(page.canvas.width * k));
  c.height = Math.max(1, Math.round(page.canvas.height * k));
  const g = c.getContext('2d');
  if (!g) return null;
  g.imageSmoothingQuality = 'high';
  g.drawImage(page.canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

/** 사각형 안쪽 좌표를 다른 사각형 기준으로 — `inner` 를 `outer` 대비 비율로 */
export function within(inner: Rect, outer: Rect): Rect {
  const w = Math.max(1e-6, outer[2]);
  const h = Math.max(1e-6, outer[3]);
  return [(inner[0] - outer[0]) / w, (inner[1] - outer[1]) / h, inner[2] / w, inner[3] / h];
}

/** 비율 사각형을 다른 비율 사각형 안에 얹는다 — `inner` 는 `outer` 대비 비율 */
export function compose(outer: Rect, inner: Rect): Rect {
  return [
    outer[0] + inner[0] * outer[2],
    outer[1] + inner[1] * outer[3],
    inner[2] * outer[2],
    inner[3] * outer[3],
  ];
}
