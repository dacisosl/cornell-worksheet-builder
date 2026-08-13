import type { Store } from '../state/store';
import type { DrawHolder, DrawSet, DrawStroke, DrawText } from '../types';
import { el } from '../utils/dom';
import { Icons } from '../utils/icons';

export interface DrawContext {
  store: Store;
}

type Tool = 'pen' | 'text' | 'erase';

const PEN_COLORS = ['#22252a', '#d3453d', '#2563eb'];
const PEN_WIDTH = 2.2;
const TEXT_SIZE = 15;
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * 필드 위에 자유 필기(펜)·텍스트 상자를 얹는 서비스.
 * 데이터는 block.draws[key]에 비율 좌표로 저장되어 JSON 저장/불러오기와 함께 유지된다.
 */
export function createDrawService(ctx: DrawContext) {
  const { store } = ctx;

  function setOf(holder: DrawHolder, key: string): DrawSet {
    holder.draws = holder.draws ?? {};
    holder.draws[key] = holder.draws[key] ?? { strokes: [], texts: [] };
    return holder.draws[key];
  }

  /**
   * 패널(또는 페이지 여백)에 필기 레이어를 붙이고, 필기 모드를 여닫는 연필 버튼을 돌려준다.
   * tbHost를 주면 필기 도구 막대가 그곳에 붙어 본문을 가리지 않는다.
   */
  function attach(
    panel: HTMLElement,
    block: DrawHolder,
    key: string,
    tbHost?: HTMLElement,
  ): HTMLButtonElement {
    const layer = el('div', { class: 'draw-layer' });
    const svg = document.createElementNS(SVG_NS, 'svg');
    layer.appendChild(svg);
    panel.appendChild(layer);

    let active = false;
    let tool: Tool = 'pen';
    let color = PEN_COLORS[0];
    let tb: HTMLElement | null = null;

    function pathD(pts: [number, number][], w: number, h: number): string {
      if (pts.length < 2) return '';
      const P = pts.map(([x, y]) => [x * w, y * h]);
      let d = `M${P[0][0].toFixed(1)} ${P[0][1].toFixed(1)}`;
      for (let i = 1; i < P.length - 1; i++) {
        const mx = (P[i][0] + P[i + 1][0]) / 2;
        const my = (P[i][1] + P[i + 1][1]) / 2;
        d += ` Q${P[i][0].toFixed(1)} ${P[i][1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
      }
      const last = P[P.length - 1];
      d += ` L${last[0].toFixed(1)} ${last[1].toFixed(1)}`;
      return d;
    }

    function strokePath(st: DrawStroke, w: number, h: number): SVGPathElement {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', pathD(st.pts, w, h));
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', st.color);
      p.setAttribute('stroke-width', String(st.w));
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
      p.addEventListener('pointerdown', (e) => {
        if (!active || tool !== 'erase') return;
        e.preventDefault();
        e.stopPropagation();
        const set = setOf(block, key);
        const i = set.strokes.indexOf(st);
        if (i >= 0) set.strokes.splice(i, 1);
        store.commit();
        renderAll();
      });
      return p;
    }

    function textNode(tx: DrawText): HTMLElement {
      const body = el('span', {
        class: 'dt-body',
        contenteditable: 'true',
        spellcheck: 'false',
        text: tx.text,
      });
      body.addEventListener('input', () => {
        tx.text = body.textContent ?? '';
        store.scheduleSave();
      });
      body.addEventListener('blur', () => {
        if (!(body.textContent ?? '').trim()) {
          removeText();
          return;
        }
        store.commit();
      });
      body.addEventListener('pointerdown', (e) => {
        if (active && tool === 'erase') {
          e.preventDefault();
          e.stopPropagation();
          removeText();
          return;
        }
        e.stopPropagation();
      });

      const node = el(
        'div',
        {
          class: 'dtext',
          style: `left:${tx.x * 100}%;top:${tx.y * 100}%;font-size:${tx.size}px;color:${tx.color}`,
        },
        [el('span', { class: 'dt-drag', title: '드래그하여 이동', html: Icons.grip }), body],
      );

      function removeText(): void {
        const set = setOf(block, key);
        const i = set.texts.indexOf(tx);
        if (i >= 0) set.texts.splice(i, 1);
        store.commit();
        renderAll();
      }

      const drag = node.querySelector('.dt-drag')!;
      drag.addEventListener('pointerdown', ((e: Event) => {
        const pe = e as PointerEvent;
        pe.preventDefault();
        pe.stopPropagation();
        const r = layer.getBoundingClientRect();
        const sx = pe.clientX;
        const sy = pe.clientY;
        const ox = tx.x;
        const oy = tx.y;
        drag.setPointerCapture(pe.pointerId);
        const mv = (ev: Event) => {
          const p = ev as PointerEvent;
          tx.x = Math.max(0, Math.min(0.98, ox + (p.clientX - sx) / r.width));
          tx.y = Math.max(0, Math.min(0.98, oy + (p.clientY - sy) / r.height));
          node.style.left = tx.x * 100 + '%';
          node.style.top = tx.y * 100 + '%';
        };
        const up = () => {
          drag.removeEventListener('pointermove', mv);
          drag.removeEventListener('pointerup', up);
          store.commit();
        };
        drag.addEventListener('pointermove', mv);
        drag.addEventListener('pointerup', up);
      }) as EventListener);

      return node;
    }

    function renderAll(): void {
      const w = layer.clientWidth || 1;
      const h = layer.clientHeight || 1;
      svg.setAttribute('width', String(w));
      svg.setAttribute('height', String(h));
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      [...layer.querySelectorAll('.dtext')].forEach((n) => n.remove());
      const set = block.draws?.[key];
      if (!set) return;
      set.strokes.forEach((st) => svg.appendChild(strokePath(st, w, h)));
      set.texts.forEach((tx) => layer.appendChild(textNode(tx)));
    }

    function startStroke(e: PointerEvent): void {
      e.preventDefault();
      const r = layer.getBoundingClientRect();
      const pts: [number, number][] = [
        [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height],
      ];
      const live = document.createElementNS(SVG_NS, 'path');
      live.setAttribute('fill', 'none');
      live.setAttribute('stroke', color);
      live.setAttribute('stroke-width', String(PEN_WIDTH));
      live.setAttribute('stroke-linecap', 'round');
      live.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(live);
      layer.setPointerCapture(e.pointerId);

      const mv = (ev: Event) => {
        const p = ev as PointerEvent;
        const fx = (p.clientX - r.left) / r.width;
        const fy = (p.clientY - r.top) / r.height;
        const last = pts[pts.length - 1];
        if (Math.abs(fx - last[0]) * r.width < 1.5 && Math.abs(fy - last[1]) * r.height < 1.5) return;
        pts.push([Math.max(0, Math.min(1, fx)), Math.max(0, Math.min(1, fy))]);
        live.setAttribute('d', pathD(pts, r.width, r.height));
      };
      const up = () => {
        layer.removeEventListener('pointermove', mv);
        layer.removeEventListener('pointerup', up);
        live.remove();
        if (pts.length > 1) {
          setOf(block, key).strokes.push({ pts, color, w: PEN_WIDTH });
          store.commit();
        }
        renderAll();
      };
      layer.addEventListener('pointermove', mv);
      layer.addEventListener('pointerup', up);
    }

    function addText(e: PointerEvent): void {
      const r = layer.getBoundingClientRect();
      const tx: DrawText = {
        x: Math.max(0, Math.min(0.95, (e.clientX - r.left) / r.width)),
        y: Math.max(0, Math.min(0.95, (e.clientY - r.top) / r.height)),
        text: '',
        size: TEXT_SIZE,
        color,
      };
      setOf(block, key).texts.push(tx);
      renderAll();
      const bodies = layer.querySelectorAll<HTMLElement>('.dt-body');
      bodies[bodies.length - 1]?.focus();
    }

    layer.addEventListener('pointerdown', ((e: Event) => {
      if (!active) return;
      const pe = e as PointerEvent;
      const t = pe.target as Element;
      if (t.closest('.dtext')) return;
      if (tool === 'pen') startStroke(pe);
      else if (tool === 'text') addText(pe);
    }) as EventListener);

    function buildTb(): HTMLElement {
      const mkTool = (ico: string, title: string, t: Tool) =>
        el('button', {
          class: 'dtb' + (tool === t ? ' on' : ''),
          title,
          html: ico,
          onclick: (e: Event) => {
            e.stopPropagation();
            tool = t;
            refreshTb();
          },
        });
      const swatches = PEN_COLORS.map((c) =>
        el('button', {
          class: 'dsw' + (color === c ? ' on' : ''),
          style: `background:${c}`,
          title: '색상',
          onclick: (e: Event) => {
            e.stopPropagation();
            color = c;
            refreshTb();
          },
        }),
      );
      const bar = el('div', { class: 'draw-tb' }, [
        mkTool(Icons.pencil, '펜(자유 그리기)', 'pen'),
        mkTool(Icons.textT, '텍스트 (클릭한 곳에 입력)', 'text'),
        mkTool(Icons.eraser, '지우개 (획·텍스트 클릭)', 'erase'),
        el('span', { class: 'dtb-sep' }),
        ...swatches,
        el('span', { class: 'dtb-sep' }),
        el('button', {
          class: 'dtb done',
          title: '필기 마치기',
          html: Icons.check + '<span>완료</span>',
          onclick: (e: Event) => {
            e.stopPropagation();
            deactivate();
          },
        }),
      ]);
      bar.addEventListener('pointerdown', (e) => e.stopPropagation());
      return bar;
    }

    function refreshTb(): void {
      if (!tb) return;
      const fresh = buildTb();
      tb.replaceWith(fresh);
      tb = fresh;
      layer.classList.toggle('erase', tool === 'erase');
      layer.classList.toggle('text-mode', tool === 'text');
    }

    function activate(): void {
      active = true;
      tool = 'pen';
      panel.classList.add('drawing');
      tb = buildTb();
      (tbHost ?? panel).appendChild(tb);
      layer.classList.remove('erase', 'text-mode');
      btn.classList.add('on');
    }

    function deactivate(): void {
      active = false;
      panel.classList.remove('drawing');
      tb?.remove();
      tb = null;
      layer.classList.remove('erase', 'text-mode');
      btn.classList.remove('on');
    }

    const btn = el('button', {
      class: 'minibtn',
      html: Icons.pencil + '<span>필기</span>',
      title: '그리기 · 텍스트 입력 모드',
      onclick: (e: Event) => {
        e.stopPropagation();
        if (active) deactivate();
        else activate();
      },
    }) as HTMLButtonElement;

    requestAnimationFrame(renderAll);
    return btn;
  }

  return { attach };
}

export type DrawService = ReturnType<typeof createDrawService>;
