import { CONTENT_H } from '../constants';
import { sizeLabel } from './blocks';
import { reLayerBlock, type ImageService } from './images';
import type { Store } from '../state/store';
import type { Block } from '../types';
import { $$ } from '../utils/dom';

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
      const z = store.getZoom();
      const startY = e.clientY;
      const startH = b.h;
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('dragging');
      node.classList.add('resizing');

      const stacks = $$('.stack') as HTMLElement[];
      stacks.forEach((s) => s.classList.add('allow-resize'));

      const mv = (ev: PointerEvent) => {
        const h = Math.max(120, Math.round(startH + (ev.clientY - startY) / z));
        b.h = h;
        node.style.height = h + 'px';
        badge.textContent = sizeLabel(h, CONTENT_H);
        reLayerBlock(store, images, b);
      };

      const up = () => {
        try {
          handle.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        handle.classList.remove('dragging');
        node.classList.remove('resizing');
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

  function enableVSplit(div: HTMLElement, b: Block & { ratio: number }): void {
    div.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const body = div.parentElement!;
      div.setPointerCapture(e.pointerId);
      div.classList.add('dragging');

      const mv = (ev: PointerEvent) => {
        const rect = body.getBoundingClientRect();
        let ratio = (ev.clientY - rect.top) / rect.height;
        ratio = Math.min(0.8, Math.max(0.2, ratio));
        b.ratio = ratio;
        const panels = $$('.panel', body) as HTMLElement[];
        panels[0].style.flex = String(ratio);
        panels[1].style.flex = String(1 - ratio);
      };

      const up = () => {
        try {
          div.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        div.removeEventListener('pointermove', mv);
        div.removeEventListener('pointerup', up);
        div.classList.remove('dragging');
        images.reLayer(b);
        store.commit();
      };

      div.addEventListener('pointermove', mv);
      div.addEventListener('pointerup', up);
    });
  }

  function enableSplit(div: HTMLElement, b: Block & { ratio: number }): void {
    div.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const body = div.parentElement!;
      div.setPointerCapture(e.pointerId);
      div.classList.add('dragging');

      const mv = (ev: PointerEvent) => {
        const rect = body.getBoundingClientRect();
        let ratio = (ev.clientX - rect.left) / rect.width;
        ratio = Math.min(0.8, Math.max(0.2, ratio));
        b.ratio = ratio;
        const panels = $$('.panel', body) as HTMLElement[];
        panels[0].style.flex = String(ratio);
        panels[1].style.flex = String(1 - ratio);
      };

      const up = () => {
        try {
          div.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        div.removeEventListener('pointermove', mv);
        div.removeEventListener('pointerup', up);
        div.classList.remove('dragging');
        images.reLayer(b);
        store.commit();
      };

      div.addEventListener('pointermove', mv);
      div.addEventListener('pointerup', up);
    });
  }

  return { move, del, attachDrag, enableResize, enableVSplit, enableSplit };
}

export type Interactions = ReturnType<typeof createInteractions>;
