import { GRID, PAGE_H, PAGE_MARGIN, SNAP } from '../constants';
import { loadImage, readFileAsDataURL, unsharp } from './imageProcessing';
import { hasImages } from './blocks';
import type { Store } from '../state/store';
import type { Block, ImageBlock, ImageObj } from '../types';
import { $, $$, el } from '../utils/dom';
import { Icons } from '../utils/icons';

/** 칸 크기 조절 중에 이미지를 제자리에 두기 위한 픽셀 좌표 스냅샷 */
export interface ImgSnapshot {
  layer: HTMLElement;
  items: { im: ImageObj; left: number; top: number; w: number; h: number }[];
}

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

  /** 같은 그룹에 묶인 이미지 id 목록 (그룹이 없으면 자기 자신만) */
  function groupMates(imgs: ImageObj[], im: ImageObj): number[] {
    if (im.g == null) return [im.id];
    return imgs.filter((o) => o.g === im.g).map((o) => o.id);
  }

  /** 현재 고른 이미지 객체들 (기준 이미지가 마지막) */
  function selectedObjs(block: ImageBlock): ImageObj[] {
    if (store.selected?.b !== block.id) return [];
    const imgs = block.imgs ?? [];
    return store.selectedIds
      .map((id) => imgs.find((o) => o.id === id))
      .filter((o): o is ImageObj => !!o);
  }

  /**
   * 이미지를 고른다.
   * 그룹에 속한 이미지는 그룹 전체가 함께 선택되고,
   * Shift/Ctrl을 누른 채 고르면 기존 선택에 더하거나 뺀다.
   */
  function selectImage(bId: number, iId: number, additive = false): void {
    const b = store.findBlock(bId);
    const imgs = b && hasImages(b) ? (b.imgs ?? []) : [];
    const im = imgs.find((o) => o.id === iId);
    const mates = im ? groupMates(imgs, im) : [iId];

    let ids: number[];
    if (additive && store.selected?.b === bId) {
      const cur = store.selectedIds;
      const alreadyIn = mates.every((id) => cur.includes(id));
      const rest = cur.filter((id) => !mates.includes(id));
      ids = alreadyIn ? rest : [...rest, ...mates];
    } else {
      ids = mates;
    }
    // 기준(마지막으로 누른) 이미지를 맨 뒤로
    if (ids.includes(iId)) ids = [...ids.filter((x) => x !== iId), iId];

    store.setSelection(bId, ids);
    $$('.img-layer').forEach(applySel);
  }

  function deselectImage(): void {
    if (!store.selected) return;
    store.clearSelection();
    $$('.img-layer').forEach(applySel);
  }

  function applySel(layer: Element): void {
    const bn = layer.closest('.block');
    const multi =
      !!bn && store.selected?.b === +bn.getAttribute('data-id')! && store.selectedIds.length > 1;
    layer.classList.toggle('multi-sel', multi);
    $$('.imgobj', layer).forEach((o) => {
      const bn = o.closest('.block');
      const sel = bn && store.isImgSelected(+bn.getAttribute('data-id')!, +o.getAttribute('data-img')!);
      o.classList.toggle('selected', !!sel);
      const prim =
        bn &&
        store.selected?.b === +bn.getAttribute('data-id')! &&
        store.selected.i === +o.getAttribute('data-img')!;
      o.classList.toggle('primary', !!prim);
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
    // 여러 개를 골랐으면 함께 지운다.
    const sel = selectedObjs(block);
    const kill = new Set(sel.some((o) => o.id === im.id) ? sel.map((o) => o.id) : [im.id]);
    block.imgs = (block.imgs ?? []).filter((o) => !kill.has(o.id));
    if (store.selected?.b === block.id) store.clearSelection();
    store.commit();
    reLayer(block);
  }

  /** 고른 이미지들을 한 그룹으로 묶는다. */
  function groupSelected(block: ImageBlock): void {
    const sel = selectedObjs(block);
    if (sel.length < 2) return;
    const g = store.nextGroupId();
    sel.forEach((im) => {
      im.g = g;
    });
    store.commit();
    reLayer(block);
  }

  /** 고른 이미지들의 그룹을 푼다. */
  function ungroupSelected(block: ImageBlock): void {
    const sel = selectedObjs(block);
    if (!sel.length) return;
    const groups = new Set(sel.map((im) => im.g).filter((g): g is number => g != null));
    if (!groups.size) return;
    (block.imgs ?? []).forEach((im) => {
      if (im.g != null && groups.has(im.g)) im.g = null;
    });
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

  /** 가로 정돈: 이미지를 한 줄로 나란히, 같은 폭으로 배치 */
  function arrangeImgsRow(block: ImageBlock): void {
    const imgs = block.imgs ?? [];
    if (!imgs.length) return;
    const layer = blockLayer(block.id);
    if (!layer) return;
    const pw = layer.clientWidth;
    const ph = layer.clientHeight;
    const n = imgs.length;
    const padX = 8 / pw;
    const gap = 10 / pw;
    const yPad = 8 / ph;
    let w = (1 - padX * 2 - gap * (n - 1)) / n;
    // 가장 세로로 긴 이미지가 칸 높이를 넘으면 전체를 축소
    const maxH = Math.max(...imgs.map((im) => (w * pw * im.ar) / ph));
    if (maxH > 1 - yPad * 2) w *= (1 - yPad * 2) / maxH;
    let x = (1 - (n * w + gap * (n - 1))) / 2;
    imgs.forEach((im) => {
      im.w = w;
      im.x = x;
      im.y = yPad;
      x += w + gap;
    });
    store.commit();
    reLayer(block);
  }

  /**
   * 겹침 정리: 지금 크기를 지키면서 서로 겹치지 않게 다시 배치한다.
   * 위→아래, 왼→오른쪽 순서를 지켜 줄(row) 단위로 채우고,
   * 칸 높이를 넘으면 전체를 같은 비율로 줄인다.
   */
  function spreadImgs(block: ImageBlock): void {
    const imgs = block.imgs ?? [];
    if (imgs.length < 2) return;
    const layer = blockLayer(block.id);
    if (!layer) return;
    const pw = layer.clientWidth || 1;
    const ph = layer.clientHeight || 1;
    const pad = 8;
    const gap = 10;
    const avail = Math.max(20, pw - pad * 2);

    const items = imgs
      .map((im) => ({ im, w: im.w * pw, h: im.w * pw * im.ar, x: im.x * pw, y: im.y * ph }))
      .sort((a, b) => a.y - b.y || a.x - b.x);

    // 칸보다 넓은 이미지는 먼저 폭을 맞춘다.
    items.forEach((it) => {
      if (it.w > avail) {
        it.h *= avail / it.w;
        it.w = avail;
      }
    });

    type Item = (typeof items)[number];
    const rows: Item[][] = [];
    let row: Item[] = [];
    let rowW = 0;
    items.forEach((it) => {
      const add = row.length ? gap + it.w : it.w;
      if (row.length && rowW + add > avail) {
        rows.push(row);
        row = [it];
        rowW = it.w;
      } else {
        row.push(it);
        rowW += add;
      }
    });
    if (row.length) rows.push(row);

    const rowH = rows.map((r) => Math.max(...r.map((i) => i.h)));
    const gaps = gap * (rows.length - 1);
    const stackH = rowH.reduce((a, b) => a + b, 0);
    const room = ph - pad * 2 - gaps;
    const scale = stackH > room ? Math.max(0.05, room / stackH) : 1;

    let y = pad;
    rows.forEach((r, ri) => {
      const rowWidth = r.reduce((a, i) => a + i.w * scale, 0) + gap * (r.length - 1);
      let x = Math.max(pad, (pw - rowWidth) / 2);
      r.forEach((it) => {
        it.im.w = (it.w * scale) / pw;
        it.im.x = x / pw;
        it.im.y = y / ph;
        x += it.w * scale + gap;
      });
      y += rowH[ri] * scale + gap;
    });

    store.commit();
    reLayer(block);
  }

  function snapshotImgs(block: ImageBlock): ImgSnapshot | null {
    const layer = blockLayer(block.id);
    if (!layer) return null;
    const pw = layer.clientWidth || 1;
    const ph = layer.clientHeight || 1;
    return {
      layer,
      items: (block.imgs ?? []).map((im) => {
        // 화면에 그려진 값이 있으면 그것을 쓴다 — 모델 값은 칸에 맞춰 보정되기 전일 수 있다.
        const node = $(`.imgobj[data-img="${im.id}"]`, layer) as HTMLElement | null;
        const w = node ? parseFloat(node.style.width) || im.w * pw : im.w * pw;
        const left = node ? parseFloat(node.style.left) || 0 : im.x * pw;
        const top = node ? parseFloat(node.style.top) || 0 : im.y * ph;
        return { im, left, top, w, h: w * im.ar };
      }),
    };
  }

  /**
   * 스냅샷의 픽셀 위치·크기를 그대로 유지한 채 바뀐 칸 크기에 맞춘다.
   * 이미지가 칸을 벗어나면 아무것도 바꾸지 않고 false를 돌려준다.
   */
  function applySnapshot(snap: ImgSnapshot | null): boolean {
    if (!snap || !snap.items.length) return true;
    const pw = snap.layer.clientWidth || 1;
    const ph = snap.layer.clientHeight || 1;
    // clientWidth/Height는 정수라 1px 정도는 오차로 본다.
    const SLACK = 1.5;
    const fits = snap.items.every(
      (it) => it.left + it.w <= pw + SLACK && it.top + it.h <= ph + SLACK,
    );
    if (!fits) return false;
    snap.items.forEach((it) => {
      it.im.w = it.w / pw;
      it.im.x = it.left / pw;
      it.im.y = it.top / ph;
    });
    return true;
  }

  /** 앱 내부 이미지 클립보드 — 시스템 클립보드가 막혀도 붙여넣기가 되도록 보관 */
  let clipImg: string | null = null;

  function toast(msg: string): void {
    let t = $('#imgToast') as HTMLElement | null;
    if (!t) {
      t = el('div', { class: 'app-toast', id: 'imgToast' });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('on');
    window.clearTimeout(+(t.dataset.timer ?? 0));
    t.dataset.timer = String(window.setTimeout(() => t?.classList.remove('on'), 1600));
  }

  /** 선택된 이미지를 PNG로 시스템 클립보드에 복사한다. */
  async function copyImage(im: ImageObj): Promise<void> {
    // 시스템 클립보드가 막혀도 앱 안에서는 붙여넣을 수 있도록 먼저 보관한다.
    clipImg = im.src;
    toast('이미지를 복사했어요. 붙여넣을 칸에서 Ctrl+V');
    try {
      const img = await loadImage(dispSrc(im));
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d')?.drawImage(img, 0, 0);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
      if (blob) await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch {
      /* 시스템 클립보드 사용 불가 — 내부 복사본으로 붙여넣기 */
    }
  }

  function copySelectedImage(): boolean {
    if (!store.selected) return false;
    const b = store.findBlock(store.selected.b);
    if (!b || !hasImages(b)) return false;
    const im = (b.imgs ?? []).find((x) => x.id === store.selected!.i);
    if (!im) return false;
    void copyImage(im);
    return true;
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

  function isTextEditing(): boolean {
    const a = document.activeElement as HTMLElement | null;
    return (
      !!a &&
      (a.tagName === 'INPUT' ||
        a.tagName === 'TEXTAREA' ||
        a.isContentEditable ||
        !!a.closest('[contenteditable="true"]'))
    );
  }

  document.addEventListener('keydown', (e) => {
    // 텍스트 편집 중에는 브라우저 기본 동작을 우선한다.
    if (isTextEditing()) return;

    if (e.key === 'Delete') {
      if (deleteSelectedImage()) e.preventDefault();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
      if (copySelectedImage()) e.preventDefault();
    }
  });

  // 필드 밖(이미지 선택 상태)에서의 붙여넣기 — 선택된 이미지가 있는 칸에 넣는다.
  document.addEventListener('paste', (e) => {
    // 칸(필드)에서 이미 처리한 붙여넣기면 여기서 또 넣지 않는다.
    if (e.defaultPrevented) return;
    if (isTextEditing()) return;
    if (!store.selected) return;
    const b = store.findBlock(store.selected.b);
    if (!b || !hasImages(b)) return;

    for (const it of e.clipboardData?.items ?? []) {
      if (it.type?.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) {
          e.preventDefault();
          void ingestFile(b, f);
          return;
        }
      }
    }

    if (clipImg) {
      e.preventDefault();
      void ingestDataURL(b, clipImg);
    }
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

  function imgToolbar(
    block: ImageBlock,
    im: ImageObj,
    obj: HTMLElement,
    layer: HTMLElement,
  ): HTMLElement {
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
      // 그룹 버튼은 상황에 맞을 때만 보인다 (CSS로 표시 제어)
      mk(Icons.group, '고른 이미지 그룹으로 묶기', () => groupSelected(block), 'only-multi'),
      mk(Icons.ungroup, '그룹 해제', () => ungroupSelected(block), 'only-grouped on'),
      mk(Icons.copy, '복사 (Ctrl+C) — 다른 칸에 Ctrl+V로 붙여넣기', () => void copyImage(im)),
      mk(Icons.crop, '이미지 자르기', () => startCrop(block, im, obj, layer)),
      mk(Icons.sharp, '화질 보정 켜기/끄기', () => toggleSharp(block, im), im.sharpened ? 'on' : ''),
      mk(Icons.trash, '삭제 — 여럿을 골랐으면 함께 지웁니다', () => delImg(block, im), 'danger'),
    );
    return bar;
  }

  /** 이미지 자르기: 이미지 위에 자르기 상자를 띄우고, 적용 시 원본을 잘라 교체한다. */
  function startCrop(
    block: ImageBlock,
    im: ImageObj,
    obj: HTMLElement,
    layer: HTMLElement,
  ): void {
    if ($('.crop-box', obj)) return;
    obj.classList.add('cropping');
    const st = { x: 0.08, y: 0.08, w: 0.84, h: 0.84 };

    const box = el('div', { class: 'crop-box' });
    const applyBox = () => {
      box.style.left = st.x * 100 + '%';
      box.style.top = st.y * 100 + '%';
      box.style.width = st.w * 100 + '%';
      box.style.height = st.h * 100 + '%';
    };
    applyBox();

    (['nw', 'ne', 'sw', 'se'] as const).forEach((c) =>
      box.appendChild(el('span', { class: 'cbh ' + c, data: { c } })),
    );

    const actions = el('div', { class: 'crop-actions' }, [
      el('button', {
        class: 'cab ok',
        title: '자르기 적용',
        html: Icons.check,
        onpointerdown: (e: Event) => e.stopPropagation(),
        onclick: (e: Event) => {
          e.stopPropagation();
          void applyCrop();
        },
      }),
      el('button', {
        class: 'cab',
        title: '취소',
        html: '&times;',
        onpointerdown: (e: Event) => e.stopPropagation(),
        onclick: (e: Event) => {
          e.stopPropagation();
          cleanup();
        },
      }),
    ]);
    box.appendChild(actions);
    obj.appendChild(box);

    function cleanup(): void {
      box.remove();
      obj.classList.remove('cropping');
    }

    function dragCrop(pe: PointerEvent, mode: string): void {
      pe.preventDefault();
      pe.stopPropagation();
      const r = obj.getBoundingClientRect();
      const s0 = { ...st };
      const sx = pe.clientX;
      const sy = pe.clientY;
      const tgt = pe.target as HTMLElement;
      tgt.setPointerCapture(pe.pointerId);
      const mv = (ev: Event) => {
        const p = ev as PointerEvent;
        const dx = (p.clientX - sx) / r.width;
        const dy = (p.clientY - sy) / r.height;
        if (mode === 'move') {
          st.x = Math.min(Math.max(0, s0.x + dx), 1 - s0.w);
          st.y = Math.min(Math.max(0, s0.y + dy), 1 - s0.h);
        } else {
          let x1 = s0.x;
          let y1 = s0.y;
          let x2 = s0.x + s0.w;
          let y2 = s0.y + s0.h;
          if (mode.includes('w')) x1 = Math.min(Math.max(0, x1 + dx), x2 - 0.05);
          if (mode.includes('e')) x2 = Math.max(Math.min(1, x2 + dx), x1 + 0.05);
          if (mode.includes('n')) y1 = Math.min(Math.max(0, y1 + dy), y2 - 0.05);
          if (mode.includes('s')) y2 = Math.max(Math.min(1, y2 + dy), y1 + 0.05);
          st.x = x1;
          st.y = y1;
          st.w = x2 - x1;
          st.h = y2 - y1;
        }
        applyBox();
      };
      const up = () => {
        tgt.removeEventListener('pointermove', mv);
        tgt.removeEventListener('pointerup', up);
      };
      tgt.addEventListener('pointermove', mv);
      tgt.addEventListener('pointerup', up);
    }

    box.addEventListener('pointerdown', ((e: Event) => {
      const pe = e as PointerEvent;
      const t = pe.target as HTMLElement;
      if (t.classList.contains('cbh')) {
        dragCrop(pe, t.dataset.c!);
        return;
      }
      if (t.closest('.crop-actions')) return;
      dragCrop(pe, 'move');
    }) as EventListener);

    async function applyCrop(): Promise<void> {
      try {
        const img = await loadImage(im.src);
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        const sx = Math.round(st.x * nw);
        const sy = Math.round(st.y * nh);
        const sw = Math.max(1, Math.round(st.w * nw));
        const sh = Math.max(1, Math.round(st.h * nh));
        const c = document.createElement('canvas');
        c.width = sw;
        c.height = sh;
        const g = c.getContext('2d');
        if (!g) {
          cleanup();
          return;
        }
        g.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        const src = c.toDataURL('image/png');

        // 잘린 영역이 화면상 제자리에 남도록 배치를 보정한다.
        const pw = layer.clientWidth || 1;
        const ph = layer.clientHeight || 1;
        const oldW = im.w;
        const oldHpx = oldW * pw * im.ar;
        im.x = im.x + st.x * oldW;
        im.y = im.y + (st.y * oldHpx) / ph;
        im.w = oldW * st.w;
        im.ar = sh / sw;
        im.src = src;
        const cropped = await loadImage(src);
        im.sharpSrc = unsharp(cropped);
        im.sharpened = im.sharpened && !!im.sharpSrc;
        cleanup();
        clampImg(block, im);
        store.commit();
        reLayer(block);
      } catch {
        cleanup();
      }
    }
  }

  /**
   * 좌표평면 이미지를 캔버스로 그려 dataURL로 만든다.
   * 인쇄에서도 또렷하도록 고해상도로 그리고, 축에 눈금을 표시한다.
   */
  function coordPlaneDataURL(cells = 10): string {
    const size = 1200;
    const step = size / cells;
    const mid = size / 2;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d')!;

    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, size, size);

    // 격자
    g.strokeStyle = '#b7bfcb';
    g.lineWidth = 1.4;
    for (let i = 0; i <= cells; i++) {
      const p = Math.round(i * step) + 0.5;
      g.beginPath();
      g.moveTo(0, p);
      g.lineTo(size, p);
      g.stroke();
      g.beginPath();
      g.moveTo(p, 0);
      g.lineTo(p, size);
      g.stroke();
    }

    // 축
    g.strokeStyle = '#1f2328';
    g.fillStyle = '#1f2328';
    g.lineWidth = 3.4;
    g.beginPath();
    g.moveTo(0, mid);
    g.lineTo(size, mid);
    g.moveTo(mid, 0);
    g.lineTo(mid, size);
    g.stroke();

    // 눈금
    g.lineWidth = 2.2;
    const tick = 9;
    for (let i = 0; i <= cells; i++) {
      const p = Math.round(i * step) + 0.5;
      if (Math.abs(p - mid) < 1) continue;
      g.beginPath();
      g.moveTo(p, mid - tick);
      g.lineTo(p, mid + tick);
      g.moveTo(mid - tick, p);
      g.lineTo(mid + tick, p);
      g.stroke();
    }

    // 화살촉 (x축 오른쪽, y축 위쪽)
    const ah = 20;
    g.beginPath();
    g.moveTo(size, mid);
    g.lineTo(size - ah, mid - ah * 0.45);
    g.lineTo(size - ah, mid + ah * 0.45);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(mid, 0);
    g.lineTo(mid - ah * 0.45, ah);
    g.lineTo(mid + ah * 0.45, ah);
    g.closePath();
    g.fill();

    g.font = 'italic 40px Georgia, serif';
    g.fillText('x', size - 36, mid + 42);
    g.fillText('y', mid + 18, 40);
    g.font = '34px Georgia, serif';
    g.fillText('O', mid - 40, mid + 38);

    return c.toDataURL('image/png');
  }

  function addCoordPlane(block: ImageBlock): void {
    const src = coordPlaneDataURL();
    block.imgs = block.imgs ?? [];
    const id = store.nextImgId();
    block.imgs.push({
      id,
      src,
      sharpSrc: null,
      sharpened: false,
      ar: 1,
      x: 0.28,
      y: 0.04,
      w: 0.44,
    });
    store.commit();
    render();
    selectImage(block.id, id);
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
      selectImage(block.id, im.id, pe.shiftKey || pe.ctrlKey || pe.metaKey);
      const z = store.getEffectiveScale();
      const pw = layer.clientWidth;
      const ph = layer.clientHeight;
      const w = im.w * pw;
      const h = w * im.ar;
      const sx = pe.clientX;
      const sy = pe.clientY;
      const startL = im.x * pw;
      const startT = im.y * ph;

      // 함께 고른(또는 그룹으로 묶인) 이미지들은 같은 거리만큼 움직인다.
      const movers = selectedObjs(block)
        .filter((o) => o.id !== im.id)
        .map((o) => {
          const ow = o.w * pw;
          return {
            im: o,
            node: $(`.imgobj[data-img="${o.id}"]`, layer) as HTMLElement | null,
            left: o.x * pw,
            top: o.y * ph,
            w: ow,
            h: ow * o.ar,
          };
        });
      const moverIds = new Set([im.id, ...movers.map((m) => m.im.id)]);
      const others = (block.imgs ?? [])
        .filter((o) => !moverIds.has(o.id))
        .map((o) => {
          const ow = o.w * pw;
          return { left: o.x * pw, top: o.y * ph, w: ow, h: ow * o.ar };
        });

      // 선택 묶음 전체가 칸을 벗어나지 않도록 이동 범위를 미리 구한다.
      const minDx = Math.max(-startL, ...movers.map((m) => -m.left));
      const maxDx = Math.min(pw - w - startL, ...movers.map((m) => pw - m.w - m.left));
      const minDy = Math.max(-startT, ...movers.map((m) => -m.top));
      const maxDy = Math.min(ph - h - startT, ...movers.map((m) => ph - m.h - m.top));

      obj.setPointerCapture(pe.pointerId);
      obj.classList.add('moving');

      const mv = (ev: Event) => {
        const p = ev as PointerEvent;
        let nl = startL + (p.clientX - sx) / z;
        let nt = startT + (p.clientY - sy) / z;
        if (!movers.length) {
          const g = snap(nl, nt, w, h, pw, ph, others, layer);
          nl = g.left;
          nt = g.top;
        }
        let dx = nl - startL;
        let dy = nt - startT;
        dx = Math.max(minDx, Math.min(maxDx, dx));
        dy = Math.max(minDy, Math.min(maxDy, dy));
        nl = startL + dx;
        nt = startT + dy;
        obj.style.left = nl + 'px';
        obj.style.top = nt + 'px';
        im.x = nl / pw;
        im.y = nt / ph;
        movers.forEach((m) => {
          const ml = m.left + dx;
          const mt = m.top + dy;
          m.im.x = ml / pw;
          m.im.y = mt / ph;
          if (m.node) {
            m.node.style.left = ml + 'px';
            m.node.style.top = mt + 'px';
          }
        });
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
        selectImage(block.id, im.id, pe.shiftKey || pe.ctrlKey || pe.metaKey);
        const z = store.getEffectiveScale();
        const pw = layer.clientWidth;
        const ph = layer.clientHeight;
        const corner = hd.getAttribute('data-corner')!;
        const startW = im.w * pw;
        const startH = startW * im.ar;
        const startL = im.x * pw;
        const startT = im.y * ph;
        const sx = pe.clientX;
        const dir = corner.includes('e') ? 1 : -1;

        // 함께 고른 이미지들은 묶음 전체가 같은 비율로 커지고 작아진다.
        const sel = selectedObjs(block);
        const group =
          sel.length > 1 && sel.some((o) => o.id === im.id)
            ? sel.map((o) => {
                const ow = o.w * pw;
                return {
                  im: o,
                  node: $(`.imgobj[data-img="${o.id}"]`, layer) as HTMLElement | null,
                  left: o.x * pw,
                  top: o.y * ph,
                  w: ow,
                  h: ow * o.ar,
                };
              })
            : [];

        // 기준 상자: 혼자면 그 이미지, 묶음이면 전체를 감싸는 상자
        const boxL = group.length ? Math.min(...group.map((g) => g.left)) : startL;
        const boxT = group.length ? Math.min(...group.map((g) => g.top)) : startT;
        const boxR = group.length ? Math.max(...group.map((g) => g.left + g.w)) : startL + startW;
        const boxB = group.length ? Math.max(...group.map((g) => g.top + g.h)) : startT + startH;
        const boxW = boxR - boxL;
        const boxH = boxB - boxT;
        const anchorX = corner.includes('w') ? boxR : boxL;
        const anchorY = corner.includes('n') ? boxB : boxT;
        // 묶음이 칸을 벗어나지 않는 최대 배율
        const maxF = Math.min(
          corner.includes('w') ? anchorX / boxW : (pw - anchorX) / boxW,
          corner.includes('n') ? anchorY / boxH : (ph - anchorY) / boxH,
        );

        hd.setPointerCapture(pe.pointerId);
        obj.classList.add('resizing');

        const mv = (ev: Event) => {
          const p = ev as PointerEvent;
          const dw = (p.clientX - sx) / z;
          const wanted = Math.max(40, startW + dir * dw);
          let f = Math.min(wanted / startW, maxF);
          // 어떤 이미지도 40px보다 작아지지 않게
          const minW = group.length ? Math.min(...group.map((g) => g.w)) : startW;
          f = Math.max(f, 40 / minW);

          if (!group.length) {
            const nw = startW * f;
            const nh = nw * im.ar;
            const left = corner.includes('w') ? anchorX - nw : anchorX;
            const top = corner.includes('n') ? anchorY - nh : anchorY;
            obj.style.width = nw + 'px';
            obj.style.left = left + 'px';
            obj.style.top = top + 'px';
            im.w = nw / pw;
            im.x = left / pw;
            im.y = top / ph;
            return;
          }

          const nBoxL = corner.includes('w') ? anchorX - boxW * f : anchorX;
          const nBoxT = corner.includes('n') ? anchorY - boxH * f : anchorY;
          group.forEach((g) => {
            const nw = g.w * f;
            const left = nBoxL + (g.left - boxL) * f;
            const top = nBoxT + (g.top - boxT) * f;
            g.im.w = nw / pw;
            g.im.x = left / pw;
            g.im.y = top / ph;
            const node = g.im.id === im.id ? obj : g.node;
            if (node) {
              node.style.width = nw + 'px';
              node.style.left = left + 'px';
              node.style.top = top + 'px';
            }
          });
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
      const obj = el('div', {
        class: 'imgobj' + (im.g != null ? ' grouped' : ''),
        data: { img: String(im.id) },
      });
      const pic = el('img', { src: dispSrc(im), draggable: 'false' });
      obj.appendChild(pic);
      obj.appendChild(imgToolbar(block, im, obj, layer));
      (['nw', 'ne', 'sw', 'se'] as const).forEach((c) =>
        obj.appendChild(el('span', { class: 'ihandle ' + c, data: { corner: c } })),
      );
      positionImg(obj, im, layer);
      enableImgMove(obj, block, im, layer);
      enableImgResize(obj, block, im, layer);
      obj.addEventListener('pointerdown', (e) => {
        const t = e.target as Element;
        // 그림 자체·손잡이·도구막대는 각자 처리한다 (여기서 또 고르면 선택이 뒤집힌다).
        if (t.tagName === 'IMG' || t.closest('.ihandle') || t.closest('.img-tb')) return;
        selectImage(block.id, im.id, e.shiftKey || e.ctrlKey || e.metaKey);
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

  return {
    renderImages,
    reLayer,
    attachPaste,
    enableImageDrop,
    ingestFile,
    addCoordPlane,
    arrangeImgs,
    arrangeImgsRow,
    spreadImgs,
    groupSelected,
    ungroupSelected,
    snapshotImgs,
    applySnapshot,
    deselectImage,
    deleteSelectedImage,
    copySelectedImage,
    blockLayer,
  };
}

export type ImageService = ReturnType<typeof createImageService>;

export function reLayerBlock(_store: Store, images: ImageService, block: Block): void {
  if (hasImages(block)) images.reLayer(block);
}

export { PAGE_H, PAGE_MARGIN };
