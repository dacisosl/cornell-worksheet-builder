import { CONTENT_H } from '../constants';
import { hasImages, sizeLabel } from './blocks';
import { reLayerBlock, type ImageService, type ImgSnapshot } from './images';
import type { Store } from '../state/store';
import type { Block } from '../types';
import { $$ } from '../utils/dom';

/** 칸 비율 허용 범위 — 조절 손잡이와 크기 조절이 같은 한계를 쓴다 */
const RATIO_MIN = 0.2;
const RATIO_MAX = 0.8;

/** ratio로 위·아래 칸을 나누는 세로 배치인지 */
function colPanels(node: HTMLElement): HTMLElement[] {
  const body = node.querySelector('.bbody.col');
  if (!body) return [];
  return [...body.children].filter((c) => c.classList.contains('panel')) as HTMLElement[];
}

export interface InteractionContext {
  store: Store;
  images: ImageService;
  syncFromDOM: () => void;
  render: () => void;
  paginate: () => void;
}

export function createInteractions(ctx: InteractionContext) {
  const { store, images, syncFromDOM, render, paginate } = ctx;
  let dragId: number | null = null;

  function move(id: number, dir: number): void {
    syncFromDOM();
    const i = store.state.blocks.findIndex((b) => b.id === id);
    const j = i + dir;
    if (j < 0 || j >= store.state.blocks.length) return;
    [store.state.blocks[i], store.state.blocks[j]] = [store.state.blocks[j], store.state.blocks[i]];
    store.commit();
    render();
  }

  function del(id: number): void {
    syncFromDOM();
    store.state.blocks = store.state.blocks.filter((b) => b.id !== id);
    store.commit();
    render();
  }

  function attachDrag(handle: HTMLElement, node: HTMLElement, b: Block): void {
    handle.setAttribute('draggable', 'true');

    handle.addEventListener('dragstart', (e) => {
      dragId = b.id;
      node.classList.add('dragging');
      e.dataTransfer!.effectAllowed = 'move';
      e.dataTransfer!.setData('text/plain', String(b.id));
      try {
        e.dataTransfer!.setDragImage(node, 20, 20);
      } catch {
        /* ignore */
      }
    });

    handle.addEventListener('dragend', () => {
      dragId = null;
      node.classList.remove('dragging');
      $$('.block').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
    });

    node.addEventListener('dragover', (e) => {
      if (dragId == null || dragId === b.id) return;
      e.preventDefault();
      const r = node.getBoundingClientRect();
      const after = e.clientY - r.top > r.height / 2;
      node.classList.toggle('drop-after', after);
      node.classList.toggle('drop-before', !after);
    });

    node.addEventListener('dragleave', () => node.classList.remove('drop-before', 'drop-after'));

    node.addEventListener('drop', (e) => {
      if (dragId == null || dragId === b.id) return;
      e.preventDefault();
      syncFromDOM();
      const from = store.state.blocks.findIndex((x) => x.id === dragId);
      const moved = store.state.blocks.splice(from, 1)[0];
      let to = store.state.blocks.findIndex((x) => x.id === b.id);
      const r = node.getBoundingClientRect();
      if (e.clientY - r.top > r.height / 2) to += 1;
      store.state.blocks.splice(to, 0, moved);
      store.commit();
      render();
    });
  }

  function enableResize(handle: HTMLElement, node: HTMLElement, b: Block, badge: HTMLElement): void {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const z = store.getEffectiveScale();
      const startY = e.clientY;
      const startH = b.h;
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('dragging');
      node.classList.add('resizing');

      const stacks = $$('.stack') as HTMLElement[];
      stacks.forEach((s) => s.classList.add('allow-resize'));

      // 높이를 바꿔도 이미지는 제자리에 있어야 한다.
      // 지금 이미 이미지가 칸을 벗어나 있으면(예전 파일 등) 잠금을 걸지 않는다.
      let snap: ImgSnapshot | null = hasImages(b) ? images.snapshotImgs(b) : null;
      if (snap && !images.applySnapshot(snap)) snap = null;

      // 세로 2단(모의고사·개념 상단) 블록: 위 칸 높이를 고정해 아래 칸만 늘고 준다.
      const panels = colPanels(node);
      const ratioBlock = panels.length === 2 && 'ratio' in b ? (b as Block & { ratio: number }) : null;
      const body = ratioBlock ? (panels[0].parentElement as HTMLElement) : null;
      const topPx = ratioBlock ? panels[0].offsetHeight : 0;
      // 칸 사이 여백(구분선 등) — flex가 나눠 갖지 않는 높이
      const chrome = body ? body.offsetHeight - panels[0].offsetHeight - panels[1].offsetHeight : 0;

      let lastGood = startH;

      /** 높이를 적용한다. 위 칸이나 이미지가 자리를 잃으면 false */
      const apply = (h: number): boolean => {
        b.h = h;
        node.style.height = h + 'px';
        let ok = true;
        if (ratioBlock && body) {
          const free = body.offsetHeight - chrome;
          const r = free > 0 ? topPx / free : ratioBlock.ratio;
          // 위 칸 높이를 그대로 지킬 수 없는 크기면 더 줄이지 않는다.
          if (r > RATIO_MAX || r < RATIO_MIN) ok = false;
          const clamped = Math.min(RATIO_MAX, Math.max(RATIO_MIN, r));
          ratioBlock.ratio = clamped;
          panels[0].style.flex = String(clamped);
          panels[1].style.flex = String(1 - clamped);
        }
        return images.applySnapshot(snap) && ok;
      };

      const mv = (ev: PointerEvent) => {
        const want = Math.max(120, Math.round(startH + (ev.clientY - startY) / z));
        if (want === b.h) return;
        const ok = apply(want);
        if (!ok) {
          // 이 이상 줄이면 이미지가 잘린다 — 직전 크기에서 멈춘다.
          apply(lastGood);
        } else {
          lastGood = want;
        }
        node.classList.toggle('resize-blocked', !ok);
        badge.textContent = sizeLabel(b.h, CONTENT_H);
        reLayerBlock(store, images, b);
      };

      const up = () => {
        try {
          handle.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        handle.classList.remove('dragging');
        node.classList.remove('resizing', 'resize-blocked');
        stacks.forEach((s) => s.classList.remove('allow-resize'));
        handle.removeEventListener('pointermove', mv);
        handle.removeEventListener('pointerup', up);
        store.commit();
        paginate();
      };

      handle.addEventListener('pointermove', mv);
      handle.addEventListener('pointerup', up);
    });
  }

  /**
   * 칸 비율 조절 공통 처리.
   * 비율을 바꾸는 동안에도 이미지는 제자리·같은 크기로 두고,
   * 이미지가 칸을 벗어나게 되는 비율에서는 더 줄어들지 않게 멈춘다.
   */
  function enableRatioDrag(
    div: HTMLElement,
    b: Block & { ratio: number },
    axis: 'x' | 'y',
  ): void {
    div.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const body = div.parentElement!;
      div.setPointerCapture(e.pointerId);
      div.classList.add('dragging');

      const panels = $$('.panel', body) as HTMLElement[];
      let snap: ImgSnapshot | null = hasImages(b) ? images.snapshotImgs(b) : null;
      if (snap && !images.applySnapshot(snap)) snap = null;
      let lastGood = b.ratio;

      const apply = (ratio: number): boolean => {
        b.ratio = ratio;
        panels[0].style.flex = String(ratio);
        panels[1].style.flex = String(1 - ratio);
        return images.applySnapshot(snap);
      };

      const mv = (ev: PointerEvent) => {
        const rect = body.getBoundingClientRect();
        const raw =
          axis === 'y'
            ? (ev.clientY - rect.top) / rect.height
            : (ev.clientX - rect.left) / rect.width;
        const ratio = Math.min(RATIO_MAX, Math.max(RATIO_MIN, raw));
        if (ratio === b.ratio) return;
        const ok = apply(ratio);
        if (!ok) apply(lastGood);
        else lastGood = ratio;
        div.classList.toggle('resize-blocked', !ok);
        images.reLayer(b);
      };

      const up = () => {
        try {
          div.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        div.removeEventListener('pointermove', mv);
        div.removeEventListener('pointerup', up);
        div.classList.remove('dragging', 'resize-blocked');
        images.reLayer(b);
        store.commit();
      };

      div.addEventListener('pointermove', mv);
      div.addEventListener('pointerup', up);
    });
  }

  /** 위·아래로 나뉜 칸의 비율 조절 */
  function enableVSplit(div: HTMLElement, b: Block & { ratio: number }): void {
    enableRatioDrag(div, b, 'y');
  }

  /** 좌·우로 나뉜 칸의 비율 조절 */
  function enableSplit(div: HTMLElement, b: Block & { ratio: number }): void {
    enableRatioDrag(div, b, 'x');
  }

  return { move, del, attachDrag, enableResize, enableVSplit, enableSplit };
}

export type Interactions = ReturnType<typeof createInteractions>;
