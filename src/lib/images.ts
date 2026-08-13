import { GRID, PAGE_H, PAGE_MARGIN, SNAP } from '../constants';
import { loadImage, readFileAsDataURL, unsharp } from './imageProcessing';
import { hasImages } from './blocks';
import type { Store } from '../state/store';
import type { Block, ImageBlock, ImageObj } from '../types';
import { $, $$, el } from '../utils/dom';
import { Icons } from '../utils/icons';

export interface ImageContext {
  store: Store;
  render: () => void;
}

export function createImageService(ctx: ImageContext) {
  const { store, render } = ctx;

  function blockNode(id: number): HTMLElement | null {
    return $(`.block[data-id="${id}"]`);
  }

  function blockLayer(id: number): HTMLElement | null {
    const n = blockNode(id);
    return n ? $('.img-layer', n) : null;
  }

  function reLayer(block: ImageBlock): void {
    const l = blockLayer(block.id);
    if (l) renderImages(block, l);
  }

  function dispSrc(im: ImageObj): string {
    return im.sharpened && im.sharpSrc ? im.sharpSrc : im.src;
  }

  function selectImage(bId: number, iId: number): void {
    store.selected = { b: bId, i: iId };
    $$('.img-layer').forEach(applySel);
  }

  function deselectImage(): void {
    if (!store.selected) return;
    store.selected = null;
    $$('.img-layer').forEach(applySel);
  }

  function applySel(layer: Element): void {
    $$('.imgobj', layer).forEach((o) => {
      const bn = o.closest('.block');
      const sel =
        store.selected &&
        bn &&
        +bn.getAttribute('data-id')! === store.selected.b &&
        +o.getAttribute('data-img')! === store.selected.i;
      o.classList.toggle('selected', !!sel);
    });
  }

  async function ingestFile(block: ImageBlock, file: File): Promise<void> {
    if (!file.type.startsWith('image/')) return;
    const dataURL = await readFileAsDataURL(file);
    await ingestDataURL(block, dataURL);
  }

  async function ingestDataURL(block: ImageBlock, dataURL: string): Promise<void> {
    try {
      const im = await loadImage(dataURL);
      const ar = im.naturalHeight / im.naturalWidth || 0.6;
      const sharp = unsharp(im);
      addImage(block, { src: dataURL, sharpSrc: sharp, ar });
    } catch {
      addImage(block, { src: dataURL, sharpSrc: null, ar: 0.6 });
    }
  }

  function addImage(
    block: ImageBlock,
    { src, sharpSrc, ar }: { src: string; sharpSrc: string | null; ar: number },
  ): void {
    block.imgs = block.imgs ?? [];
    const n = block.imgs.length;
    const id = store.nextImgId();
    const off = Math.min(0.04 * n, 0.2);
    block.imgs.push({
      id,
      src,
      sharpSrc: sharpSrc ?? null,
      sharpened: !!sharpSrc,
      ar,
      x: 0.12 + off,
      y: 0.06 + off,
      w: 0.72,
    });
    store.commit();
    render();
    selectImage(block.id, id);
  }

  function clampImg(block: ImageBlock, im: ImageObj): void {
    const layer = blockLayer(block.id);
    if (!layer) return;
    const pw = layer.clientWidth;
    const ph = layer.clientHeight;
    let w = im.w * pw;
    let h = w * im.ar;
    if (h > ph) {
      h = ph;
      w = h / im.ar;
      im.w = w / pw;
    }
    const left = Math.max(0, Math.min(im.x * pw, pw - w));
    const top = Math.max(0, Math.min(im.y * ph, ph - h));
    im.x = left / pw;
    im.y = top / ph;
  }

  function scaleImg(block: ImageBlock, im: ImageObj, factor: number): void {
    const layer = blockLayer(block.id);
    if (!layer) return;
    const pw = layer.clientWidth;
    const ph = layer.clientHeight;
    const cx = im.x + im.w / 2;
    const cyTop = im.y;
    const oldH = (im.w * pw * im.ar) / ph;
    const cy = cyTop + oldH / 2;
    im.w = Math.max(0.06, Math.min(1, im.w * factor));
    const newH = (im.w * pw * im.ar) / ph;
    im.x = cx - im.w / 2;
    im.y = cy - newH / 2;
    clampImg(block, im);
    store.commit();
    reLayer(block);
  }

  function toggleSharp(block: ImageBlock, im: ImageObj): void {
    if (im.sharpened) {
      im.sharpened = false;
      store.commit();
      reLayer(block);
      return;
    }
    if (im.sharpSrc) {
      im.sharpened = true;
      store.commit();
      reLayer(block);
      return;
    }
    const i = new Image();
    i.onload = () => {
      const s = unsharp(i);
      if (s) {
        im.sharpSrc = s;
        im.sharpened = true;
      }
      store.commit();
      reLayer(block);
    };
    i.src = im.src;
  }

  function delImg(block: ImageBlock, im: ImageObj): void {
    block.imgs = (block.imgs ?? []).filter((o) => o.id !== im.id);
    if (store.selected?.b === block.id && store.selected?.i === im.id) store.selected = null;
    store.commit();
    reLayer(block);
  }

  function arrangeImgs(block: ImageBlock): void {
    const imgs = block.imgs ?? [];
    if (!imgs.length) return;
    const layer = blockLayer(block.id);
    if (!layer) return;
    const pw = layer.clientWidth;
    const ph = layer.clientHeight;
    const pad = 8 / ph;
    const gap = 10 / ph;
    const wFrac = 0.92;
    let totalH = 0;
    imgs.forEach((im) => {
      totalH += (wFrac * pw * im.ar) / ph;
    });
    totalH += gap * (imgs.length - 1) + pad * 2;
    const scale = totalH > 1 ? 1 / totalH : 1;
    let y = pad;
    imgs.forEach((im) => {
      im.w = wFrac * scale;
      im.x = (1 - im.w) / 2;
      im.y = y;
      y += (im.w * pw * im.ar) / ph + gap * scale;
    });
    store.commit();
    reLayer(block);
  }

  function deleteSelectedImage(): boolean {
    if (!store.selected) return false;
    const b = store.findBlock(store.selected.b);
    if (!b || !hasImages(b)) return false;
    const im = (b.imgs ?? []).find((x) => x.id === store.selected!.i);
    if (!im) return false;
    delImg(b, im);
    return true;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Delete') return;
    // 텍스트 편집 중에는 브라우저 기본 동작을 우선한다.
    const a = document.activeElement as HTMLElement | null;
    const isTextEditing =
      !!a &&
      (a.tagName === 'INPUT' ||
        a.tagName === 'TEXTAREA' ||
        a.isContentEditable ||
        !!a.closest('[contenteditable="true"]'));
    if (isTextEditing) return;

    if (deleteSelectedImage()) e.preventDefault();
  });

  function positionImg(obj: HTMLElement, im: ImageObj, layer: HTMLElement): void {
    const pw = layer.clientWidth || 1;
    const ph = layer.clientHeight || 1;
    let w = im.w * pw;
    let h = w * im.ar;
    if (h > ph) {
      h = ph;
      w = h / im.ar;
      im.w = w / pw;
    }
    let left = im.x * pw;
    let top = im.y * ph;
    left = Math.max(0, Math.min(left, pw - w));
    top = Math.max(0, Math.min(top, ph - h));
    obj.style.width = w + 'px';
    obj.style.left = left + 'px';
    obj.style.top = top + 'px';
  }

  function clearGuides(layer: Element): void {
    $$('.galign', layer).forEach((n) => n.remove());
  }

  function addGuide(layer: HTMLElement, dir: 'v' | 'h', pos: number): void {
    const g = el('div', { class: 'galign ' + dir });
    if (dir === 'v') g.style.left = pos + 'px';
    else g.style.top = pos + 'px';
    layer.appendChild(g);
  }

  function snap(
    nl: number,
    nt: number,
    w: number,
    h: number,
    pw: number,
    ph: number,
    others: { left: number; top: number; w: number; h: number }[],
    layer: HTMLElement,
  ): { left: number; top: number } {
    clearGuides(layer);
    const xC = [
      { p: 0, g: 0 },
      { p: (pw - w) / 2, g: pw / 2 },
      { p: pw - w, g: pw },
    ];
    const yC = [
      { p: 0, g: 0 },
      { p: (ph - h) / 2, g: ph / 2 },
      { p: ph - h, g: ph },
    ];
    others.forEach((o) => {
      xC.push(
        { p: o.left, g: o.left },
        { p: o.left + o.w / 2 - w / 2, g: o.left + o.w / 2 },
        { p: o.left + o.w - w, g: o.left + o.w },
      );
      yC.push(
        { p: o.top, g: o.top },
        { p: o.top + o.h / 2 - h / 2, g: o.top + o.h / 2 },
        { p: o.top + o.h - h, g: o.top + o.h },
      );
    });

    let bx: number | null = null;
    let bxd = SNAP + 1;
    let bxg = 0;
    xC.forEach((c) => {
      const d = Math.abs(nl - c.p);
      if (d < bxd) {
        bxd = d;
        bx = c.p;
        bxg = c.g;
      }
    });

    let by: number | null = null;
    let byd = SNAP + 1;
    let byg = 0;
    yC.forEach((c) => {
      const d = Math.abs(nt - c.p);
      if (d < byd) {
        byd = d;
        by = c.p;
        byg = c.g;
      }
    });

    if (bx != null) {
      nl = bx;
      addGuide(layer, 'v', bxg);
    } else if (store.state.meta.grid) {
      nl = Math.round(nl / GRID) * GRID;
    }

    if (by != null) {
      nt = by;
      addGuide(layer, 'h', byg);
    } else if (store.state.meta.grid) {
      nt = Math.round(nt / GRID) * GRID;
    }

    return { left: nl, top: nt };
  }

  function imgToolbar(block: ImageBlock, im: ImageObj): HTMLElement {
    const bar = el('div', { class: 'img-tb' });
    const mk = (html: string, title: string, fn: () => void, cls = '') =>
      el('button', {
        class: 'tbb' + (cls ? ' ' + cls : ''),
        title,
        html,
        onpointerdown: (e: Event) => e.stopPropagation(),
        onclick: (e: Event) => {
          e.stopPropagation();
          fn();
        },
      });

    bar.append(
      mk('−', '축소', () => scaleImg(block, im, 1 / 1.12)),
      mk('+', '확대', () => scaleImg(block, im, 1.12)),
      mk(Icons.fit, '칸 너비에 맞추기', () => {
        im.x = 0.04;
        im.w = 0.92;
        clampImg(block, im);
        store.commit();
        reLayer(block);
      }),
      mk(Icons.sharp, '화질 보정 켜기/끄기', () => toggleSharp(block, im), im.sharpened ? 'on' : ''),
      mk(Icons.trash, '삭제', () => delImg(block, im), 'danger'),
    );
    return bar;
  }

  function enableImgMove(
    obj: HTMLElement,
    block: ImageBlock,
    im: ImageObj,
    layer: HTMLElement,
  ): void {
    const pic = obj.querySelector('img');
    if (!pic) return;

    pic.addEventListener('pointerdown', ((e: Event) => {
      const pe = e as PointerEvent;
      pe.preventDefault();
      selectImage(block.id, im.id);
      const z = store.getZoom();
      const pw = layer.clientWidth;
      const ph = layer.clientHeight;
      const w = im.w * pw;
      const h = w * im.ar;
      const sx = pe.clientX;
      const sy = pe.clientY;
      const startL = im.x * pw;
      const startT = im.y * ph;
      const others = (block.imgs ?? [])
        .filter((o) => o.id !== im.id)
        .map((o) => {
          const ow = o.w * pw;
          return { left: o.x * pw, top: o.y * ph, w: ow, h: ow * o.ar };
        });

      obj.setPointerCapture(pe.pointerId);
      obj.classList.add('moving');

      const mv = (ev: Event) => {
        const p = ev as PointerEvent;
        let nl = startL + (p.clientX - sx) / z;
        let nt = startT + (p.clientY - sy) / z;
        const g = snap(nl, nt, w, h, pw, ph, others, layer);
        nl = g.left;
        nt = g.top;
        nl = Math.max(0, Math.min(nl, pw - w));
        nt = Math.max(0, Math.min(nt, ph - h));
        obj.style.left = nl + 'px';
        obj.style.top = nt + 'px';
        im.x = nl / pw;
        im.y = nt / ph;
      };

      const up = () => {
        try {
          obj.releasePointerCapture(pe.pointerId);
        } catch {
          /* ignore */
        }
        obj.classList.remove('moving');
        obj.removeEventListener('pointermove', mv);
        obj.removeEventListener('pointerup', up);
        clearGuides(layer);
        store.commit();
      };

      obj.addEventListener('pointermove', mv);
      obj.addEventListener('pointerup', up);
    }) as EventListener);
  }

  function enableImgResize(
    obj: HTMLElement,
    block: ImageBlock,
    im: ImageObj,
    layer: HTMLElement,
  ): void {
    $$('.ihandle', obj).forEach((hd) => {
      hd.addEventListener('pointerdown', ((e: Event) => {
        const pe = e as PointerEvent;
        pe.preventDefault();
        pe.stopPropagation();
        selectImage(block.id, im.id);
        const z = store.getZoom();
        const pw = layer.clientWidth;
        const ph = layer.clientHeight;
        const corner = hd.getAttribute('data-corner')!;
        const startW = im.w * pw;
        const startH = startW * im.ar;
        const startL = im.x * pw;
        const startT = im.y * ph;
        const anchorX = corner.includes('w') ? startL + startW : startL;
        const anchorY = corner.includes('n') ? startT + startH : startT;
        const sx = pe.clientX;
        const dir = corner.includes('e') ? 1 : -1;

        hd.setPointerCapture(pe.pointerId);
        obj.classList.add('resizing');

        const mv = (ev: Event) => {
          const p = ev as PointerEvent;
          const dw = (p.clientX - sx) / z;
          let nw = Math.max(40, Math.min(pw, startW + dir * dw));
          let nh = nw * im.ar;
          if (nh > ph) {
            nh = ph;
            nw = nh / im.ar;
          }
          let left = corner.includes('w') ? anchorX - nw : anchorX;
          let top = corner.includes('n') ? anchorY - nh : anchorY;
          left = Math.max(0, Math.min(left, pw - nw));
          top = Math.max(0, Math.min(top, ph - nh));
          obj.style.width = nw + 'px';
          obj.style.left = left + 'px';
          obj.style.top = top + 'px';
          im.w = nw / pw;
          im.x = left / pw;
          im.y = top / ph;
        };

        const up = () => {
          try {
            hd.releasePointerCapture(pe.pointerId);
          } catch {
            /* ignore */
          }
          obj.classList.remove('resizing');
          hd.removeEventListener('pointermove', mv);
          hd.removeEventListener('pointerup', up);
          store.commit();
        };

        hd.addEventListener('pointermove', mv);
        hd.addEventListener('pointerup', up);
      }) as EventListener);
    });
  }

  function renderImages(block: ImageBlock, layer: HTMLElement): void {
    layer.innerHTML = '';
    const fieldEl = layer.parentElement?.querySelector('.field');
    const imgs = block.imgs ?? [];
    if (fieldEl) fieldEl.classList.toggle('has-img', imgs.length > 0);

    imgs.forEach((im) => {
      const obj = el('div', { class: 'imgobj', data: { img: String(im.id) } });
      const pic = el('img', { src: dispSrc(im), draggable: 'false' });
      obj.appendChild(pic);
      obj.appendChild(imgToolbar(block, im));
      (['nw', 'ne', 'sw', 'se'] as const).forEach((c) =>
        obj.appendChild(el('span', { class: 'ihandle ' + c, data: { corner: c } })),
      );
      positionImg(obj, im, layer);
      enableImgMove(obj, block, im, layer);
      enableImgResize(obj, block, im, layer);
      obj.addEventListener('pointerdown', (e) => {
        if ((e.target as Element).closest('.ihandle') || (e.target as Element).closest('.img-tb')) return;
        selectImage(block.id, im.id);
      });
      layer.appendChild(obj);
    });
    applySel(layer);
  }

  function attachPaste(field: HTMLElement, block: ImageBlock): void {
    field.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.type?.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            void ingestFile(block, f);
            return;
          }
        }
      }
    });
  }

  function enableImageDrop(panel: HTMLElement, block: ImageBlock): void {
    const onDrag = ((e: Event) => {
      const de = e as DragEvent;
      if (de.dataTransfer && [...de.dataTransfer.types].includes('Files')) {
        de.preventDefault();
        panel.classList.add('drag-over');
      }
    }) as EventListener;

    const onDrop = ((e: Event) => {
      const de = e as DragEvent;
      if (de.type === 'drop') {
        const fs = de.dataTransfer?.files;
        if (fs?.length) {
          de.preventDefault();
          [...fs].forEach((f) => void ingestFile(block, f));
        }
      }
      panel.classList.remove('drag-over');
    }) as EventListener;

    panel.addEventListener('dragenter', onDrag);
    panel.addEventListener('dragover', onDrag);
    panel.addEventListener('dragleave', onDrop);
    panel.addEventListener('drop', onDrop);
  }

  function imgTools(block: ImageBlock): HTMLElement {
    const input = el('input', {
      type: 'file',
      accept: 'image/*',
      multiple: 'true',
      style: 'display:none',
      onchange: (e: Event) => {
        const target = e.target as HTMLInputElement;
        [...(target.files ?? [])].forEach((f) => void ingestFile(block, f));
        target.value = '';
      },
    });
    const add = el('button', {
      class: 'minibtn',
      html: Icons.image + '<span>이미지</span>',
      title: '이미지 파일 추가',
      onclick: () => input.click(),
    });
    const tidy = el('button', {
      class: 'minibtn',
      html: Icons.grid2 + '<span>정돈</span>',
      title: '이미지 오·열 자동 정렬',
      onclick: () => arrangeImgs(block),
    });
    return el('div', { class: 'field-tools' }, [add, tidy, input]);
  }

  return {
    renderImages,
    reLayer,
    attachPaste,
    enableImageDrop,
    imgTools,
    arrangeImgs,
    deselectImage,
    deleteSelectedImage,
    blockLayer,
  };
}

export type ImageService = ReturnType<typeof createImageService>;

export function reLayerBlock(_store: Store, images: ImageService, block: Block): void {
  if (hasImages(block)) images.reLayer(block);
}

export { PAGE_H, PAGE_MARGIN };
