import { CONTENT_H, DEFAULTS, TITLE_SIZE_DEFAULT, TITLE_SIZE_MAX, TITLE_SIZE_MIN, TITLE_SIZE_STEP } from '../constants';
import { makeBlock, sizeLabel } from './blocks';
import type { ImageService } from './images';
import type { Interactions } from './interactions';
import type { PageBook } from './pagination';
import type { Store } from '../state/store';
import type { BgMode, Block, ConceptBlock, MockBlock, ProblemBlock } from '../types';
import { $, $$, el } from '../utils/dom';
import { Icons } from '../utils/icons';

export interface RenderContext {
  store: Store;
  images: ImageService;
  interactions: Interactions;
  pageBook: PageBook;
  paginateSoon: () => void;
}

export function createRenderer(ctx: RenderContext) {
  const { store, images, interactions, pageBook, paginateSoon } = ctx;

  function syncFromDOM(): void {
    const book = $('#sheetBook');
    const pages = book ? ($$('.sheet-page', book) as HTMLElement[]) : [];
    const nodes = pages.length
      ? pages.flatMap((page) => $$('.block', page) as HTMLElement[])
      : ($$('.block') as HTMLElement[]);

    nodes.forEach((node) => {
      const id = +node.getAttribute('data-id')!;
      const b = store.findBlock(id);
      if (!b) return;
      const prob = $('.field.f-prob', node);
      const sol = $('.field.f-sol', node);
      const ex = $('.field.f-ex', node);
      const cimg = $('.field.f-cimg', node);
      const titleI = $('.btitle-input', node) as HTMLInputElement | null;
      if (prob && (b.type === 'problem' || b.type === 'mock')) b.probHtml = prob.innerHTML;
      if (sol && (b.type === 'problem' || b.type === 'mock')) b.solHtml = sol.innerHTML;
      if (ex && b.type === 'concept') b.exHtml = ex.innerHTML;
      if (cimg && b.type === 'concept') b.imgHtml = cimg.innerHTML;
      if (titleI) b.title = titleI.value;
    });
  }

  function syncOne(node: HTMLElement): void {
    const block = node.closest('.block');
    if (!block) return;
    const b = store.findBlock(+block.getAttribute('data-id')!);
    if (!b) return;
    if (node.classList.contains('f-prob') && (b.type === 'problem' || b.type === 'mock'))
      b.probHtml = node.innerHTML;
    else if (node.classList.contains('f-sol') && (b.type === 'problem' || b.type === 'mock'))
      b.solHtml = node.innerHTML;
    else if (node.classList.contains('f-ex') && b.type === 'concept') b.exHtml = node.innerHTML;
    else if (node.classList.contains('f-cimg') && b.type === 'concept') b.imgHtml = node.innerHTML;
  }

  function field(cls: string, _ph: string, html: string): HTMLElement {
    const f = el('div', {
      class: 'field ' + cls,
      contenteditable: 'true',
      spellcheck: 'false',
    });
    f.innerHTML = html || '';
    f.addEventListener('input', () => {
      syncOne(f);
      store.scheduleSave();
    });
    return f;
  }

  function iconBtn(
    svg: string,
    title: string,
    fn: () => void,
    disabled = false,
    extra = '',
  ): HTMLButtonElement {
    return el('button', {
      class: 'icbtn' + (extra ? ' ' + extra : ''),
      title,
      html: svg,
      disabled: disabled ? 'disabled' : undefined,
      onclick: fn,
    });
  }

  // 인쇄 품질을 위해 줄/격자를 실제 border 요소로 그린다 (gradient는 인쇄 시 흐려짐).
  const LINE_ROWS = 40;

  function panelLines(mode: string, tint = false): HTMLElement {
    const wrap = el('div', {
      class: 'panel-lines' + (mode === 'grid' ? ' is-grid' : '') + (tint ? ' tint' : ''),
    });

    if (mode === 'lines' || mode === 'grid') {
      const h = el('div', { class: 'pl-h' });
      for (let i = 0; i < LINE_ROWS; i++) h.appendChild(el('div', { class: 'pl-row' }));
      wrap.appendChild(h);
    }
    if (mode === 'grid') {
      const v = el('div', { class: 'pl-v' });
      for (let i = 0; i < LINE_ROWS; i++) v.appendChild(el('div', { class: 'pl-col' }));
      wrap.appendChild(v);
    }

    return wrap;
  }

  function linesForField(fieldEl: Element | null): HTMLElement | null {
    return (fieldEl?.closest('.panel')?.querySelector('.panel-lines') as HTMLElement) ?? null;
  }

  function applyBg(node: HTMLElement, sel: string, val: BgMode): void {
    const old = linesForField($(sel, node));
    if (!old) return;
    const tint = old.classList.contains('tint');
    old.replaceWith(panelLines(val, tint));
  }

  function refreshSeg(pop: HTMLElement, segIdx: number, val: BgMode): void {
    const segs = $$('.seg', pop);
    const labels: Record<BgMode, string> = { blank: '무지', lines: '줄글', grid: '격자' };
    [...segs[segIdx].children].forEach((c) =>
      c.classList.toggle('on', c.textContent?.trim().endsWith(labels[val]) ?? false),
    );
  }

  function makeOptions(b: Block, node: HTMLElement): HTMLElement {
    const wrap = el('div', { class: 'opt-wrap' });
    const pop = el('div', { class: 'popover' });
    const btn = el('button', {
      class: 'icbtn',
      title: '옵션',
      html: Icons.gear,
      onclick: (e: Event) => {
        e.stopPropagation();
        closePops(pop);
        pop.classList.toggle('open');
      },
    });

    function seg(
      opts: { val: BgMode; label: string; ico?: string }[],
      current: BgMode,
      onPick: (v: BgMode) => void,
    ): HTMLElement {
      const row = el('div', { class: 'seg' });
      opts.forEach((o) => {
        row.appendChild(
          el('button', { class: current === o.val ? 'on' : '', onclick: () => onPick(o.val) }, [
            el('span', { class: 'ico ' + (o.ico || '') }),
            o.label,
          ]),
        );
      });
      return row;
    }

    const bgOpts = [
      { val: 'blank' as BgMode, label: '무지' },
      { val: 'lines' as BgMode, label: '줄글', ico: 'lines' },
      { val: 'grid' as BgMode, label: '격자', ico: 'grid' },
    ];

    // 공통 옵션: 제목행(제목 입력) 숨김
    pop.appendChild(el('div', { class: 'pop-h', text: '표시' }));
    pop.appendChild(
      el('button', {
        class: 'pop-btn',
        html: `<span>${b.titleHidden ? '✓ ' : ''}제목행 숨김</span>`,
        onclick: () => {
          b.titleHidden = !b.titleHidden;
          store.commit();
          const fresh = makeOptions(b, node);
          wrap.replaceWith(fresh);
          // 현재 블록 DOM을 갱신하려면 전체 렌더가 가장 안전하다.
          render();
          paginateSoon();
          if ('imgs' in b) images.reLayer(b as unknown as ProblemBlock | MockBlock | ConceptBlock);
        },
      }),
    );

    if (b.type === 'concept') {
      const concept = b as ConceptBlock;
      pop.appendChild(el('div', { class: 'pop-h', text: '설명 배경' }));
      pop.appendChild(
        seg(bgOpts, concept.exBg, (v) => {
          concept.exBg = v;
          applyBg(node, '.f-ex', v);
          refreshSeg(pop, 0, v);
          store.commit();
        }),
      );
      pop.appendChild(el('div', { class: 'pop-h', text: '연한 배경' }));
      const tintRow = el('div', { class: 'seg' }, [
        el('button', { class: !concept.tint ? 'on' : '', onclick: () => setTint(false) }, [
          el('span', { class: 'ico' }),
          '무배경',
        ]),
        el('button', { class: concept.tint ? 'on' : '', onclick: () => setTint(true) }, [
          el('span', { class: 'ico tint' }),
          '연한 배경',
        ]),
      ]);
      function setTint(v: boolean) {
        concept.tint = v;
        linesForField($('.f-ex', node))?.classList.toggle('tint', v);
        [...tintRow.children].forEach((c, i) => c.classList.toggle('on', (i === 1) === v));
        store.commit();
      }
      pop.appendChild(tintRow);
    } else if (b.type === 'problem' || b.type === 'mock') {
      pop.appendChild(el('div', { class: 'pop-h', text: '문제 배경' }));
      pop.appendChild(
        seg(bgOpts, b.probBg, (v) => {
          b.probBg = v;
          applyBg(node, '.f-prob', v);
          refreshSeg(pop, 0, v);
          store.commit();
        }),
      );
      pop.appendChild(el('div', { class: 'pop-h', text: '풀이 배경' }));
      pop.appendChild(
        seg(bgOpts, b.solBg, (v) => {
          b.solBg = v;
          applyBg(node, '.f-sol', v);
          refreshSeg(pop, 1, v);
          store.commit();
        }),
      );
      pop.appendChild(el('div', { class: 'pop-h', text: '이미지' }));
      pop.appendChild(
        el('button', {
          class: 'pop-btn',
          html: Icons.grid2 + '<span>이미지 오·열 정돈</span>',
          onclick: () => images.arrangeImgs(b),
        }),
      );
    } else {
      // 이미지 전용 블록
      pop.appendChild(el('div', { class: 'pop-h', text: '이미지' }));
      pop.appendChild(
        el('button', {
          class: 'pop-btn',
          html: Icons.grid2 + '<span>이미지 오·열 정돈</span>',
          onclick: () => images.arrangeImgs(b),
        }),
      );
    }

    wrap.append(btn, pop);
    return wrap;
  }

  function closePops(except: HTMLElement | null): void {
    $$('.popover.open').forEach((p) => {
      if (p !== except) p.classList.remove('open');
    });
  }

  document.addEventListener('click', () => closePops(null));

  function buildTag(
    b: Block,
    node: HTMLElement,
    defaultLabel: string,
    isMock: boolean,
  ): HTMLElement {
    // 칩이 삭제된 상태면 복원용 작은 버튼만 노출
    if (b.tagHidden) {
      return el('button', {
        class: 'btag-restore',
        title: '칩 다시 표시',
        text: '+ 칩',
        onclick: () => {
          b.tagHidden = false;
          store.save();
          const fresh = buildTag(b, node, defaultLabel, isMock);
          const cur = $('.btag, .btag-restore', node);
          cur?.replaceWith(fresh);
        },
      });
    }

    const label = el('span', {
      class: 'btag-label',
      contenteditable: 'true',
      spellcheck: 'false',
      text: b.tagLabel ?? defaultLabel,
    });
    label.addEventListener('input', () => {
      b.tagLabel = label.textContent ?? '';
      store.scheduleSave();
    });
    label.addEventListener('pointerdown', (e) => e.stopPropagation());
    label.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        (label as HTMLElement).blur();
      }
    });

    const close = el('button', {
      class: 'btag-x',
      title: '칩 삭제',
      html: '&times;',
      onclick: (e: Event) => {
        e.stopPropagation();
        b.tagHidden = true;
        store.save();
        const fresh = buildTag(b, node, defaultLabel, isMock);
        const cur = $('.btag, .btag-restore', node);
        cur?.replaceWith(fresh);
      },
    });

    return el('div', { class: 'btag' + (isMock ? ' alt' : '') }, [label, close]);
  }

  function renderBlock(b: Block, idx: number, typeNum: number): HTMLElement {
    const isHalf = b.type === 'mock' || (b.type === 'image' && b.width === 'half');
    const isImageOnly = b.type === 'image';
    const node = el('div', {
      class: 'block' + (isHalf ? ' half' : '') + (isImageOnly ? ' image-only' : ''),
      data: { id: String(b.id) },
    });
    node.style.height = b.h + 'px';

    const isMock = b.type === 'mock';
    const baseText =
      b.type === 'problem'
        ? '문제'
        : b.type === 'concept'
          ? '개념'
          : b.type === 'image'
            ? '이미지'
            : '모의고사';
    const defaultLabel = b.type === 'concept' || b.type === 'image' ? baseText : `${baseText} ${typeNum}`;

    const tag = buildTag(b, node, defaultLabel, isMock);

    const titleField = buildTitleField(b);

    const ctrlKids: HTMLElement[] = [makeOptions(b, node)];

    if (b.type === 'concept') {
      const concept = b;
      ctrlKids.push(
        iconBtn(
          Icons.landscape,
          '가로 이미지 칸 (상단)',
          () => toggleConceptImg(concept, 'top'),
          false,
          concept.imgMode === 'top' ? 'active' : '',
        ),
        iconBtn(
          Icons.portrait,
          '세로 이미지 칸 (좌측 2열)',
          () => toggleConceptImg(concept, 'left'),
          false,
          concept.imgMode === 'left' ? 'active' : '',
        ),
      );
    }

    if (b.type === 'image') {
      ctrlKids.push(
        iconBtn(
          Icons.portrait,
          '반절 폭(½)로 전환',
          () => {
            b.width = 'half';
            store.commit();
            render();
            paginateSoon();
          },
          false,
          b.width === 'half' ? 'active' : '',
        ),
        iconBtn(
          Icons.landscape,
          '전체 폭으로 전환',
          () => {
            b.width = 'full';
            store.commit();
            render();
            paginateSoon();
          },
          false,
          b.width === 'full' ? 'active' : '',
        ),
      );
    }

    ctrlKids.push(
      iconBtn(Icons.up, '위로', () => interactions.move(b.id, -1), idx === 0),
      iconBtn(
        Icons.down,
        '아래로',
        () => interactions.move(b.id, +1),
        idx === store.state.blocks.length - 1,
      ),
      iconBtn(Icons.trash, '삭제', () => interactions.del(b.id), false, 'danger'),
    );

    const ctrl = el('div', { class: 'bctrl' }, ctrlKids);

    const grip = el('span', {
      class: 'icbtn',
      title: '드래그하여 이동',
      html: Icons.grip,
      style: 'cursor:grab',
    });
    interactions.attachDrag(grip, node, b);
    const bheadKids = b.titleHidden ? [ctrl] : [grip, tag, titleField, ctrl];
    const bhead = el('div', { class: 'bhead' + (b.titleHidden ? ' compact' : '') }, bheadKids);
    node.appendChild(bhead);

    const badge = el('span', { class: 'size-badge', text: sizeLabel(b.h, CONTENT_H) });

    if (isImageOnly) {
      // 블록이 페이지보다 클 때도 잡을 수 있도록 상단에 높이 조절 핸들 추가
      const topRh = el('div', {
        class: 'resize-h resize-h-top prominent',
        title: '드래그하여 블록 높이 조절',
      });
      interactions.enableResize(topRh, node, b, badge);
      node.appendChild(topRh);
    }

    if (b.type === 'problem' || b.type === 'mock') {
      renderProblemBody(node, b);
    } else if (b.type === 'concept') {
      renderConceptBody(node, b);
    } else {
      renderImageOnlyBody(node, b);
    }

    const rh = el('div', {
      class: 'resize-h' + (isImageOnly ? ' prominent' : ''),
      title: '드래그하여 블록 높이 조절',
    });
    interactions.enableResize(rh, node, b, badge);
    node.appendChild(rh);
    node.appendChild(badge);

    return node;
  }

  function renderProblemBody(node: HTMLElement, b: ProblemBlock | MockBlock): void {
    const prob = field('f-prob', '', b.probHtml);
    const sol = field('f-sol', '', b.solHtml);
    const layer = el('div', { class: 'img-layer' });

    const probPanel = el('div', { class: 'panel imgpanel', style: 'flex:1' }, [
      panelLines(b.probBg),
      images.imgTools(b),
      prob,
      layer,
    ]);

    images.attachPaste(prob, b);
    images.enableImageDrop(probPanel, b);

    const solPanel = el('div', { class: 'panel', style: 'flex:1' }, [
      panelLines(b.solBg),
      sol,
    ]);

    if (b.type === 'problem') {
      probPanel.style.flex = String(b.ratio);
      solPanel.style.flex = String(1 - b.ratio);
      const vdiv = el('div', { class: 'vdiv', title: '드래그하여 비율 조절' });
      interactions.enableSplit(vdiv, b);
      node.appendChild(el('div', { class: 'bbody' }, [probPanel, vdiv, solPanel]));
    } else {
      if (b.ratio == null) b.ratio = DEFAULTS.mock.ratio!;
      probPanel.style.flex = String(b.ratio);
      solPanel.style.flex = String(1 - b.ratio);
      const hdiv = el('div', { class: 'hdiv adjustable', title: '드래그하여 문제·풀이 비율 조절' });
      interactions.enableVSplit(hdiv, b);
      node.appendChild(el('div', { class: 'bbody col' }, [probPanel, hdiv, solPanel]));
    }

    requestAnimationFrame(() => images.renderImages(b, layer));
  }

  function titleSizeOf(b: Block): number {
    const s = b.titleSize ?? TITLE_SIZE_DEFAULT;
    return Math.min(TITLE_SIZE_MAX, Math.max(TITLE_SIZE_MIN, s));
  }

  function applyTitleSize(input: HTMLInputElement, size: number): void {
    input.style.fontSize = size + 'px';
    input.style.letterSpacing = '0';
  }

  function buildTitleField(b: Block): HTMLElement {
    const size = titleSizeOf(b);
    const titleInput = el('input', {
      class: 'btitle-input',
      value: b.title || '',
      oninput: (e: Event) => {
        b.title = (e.target as HTMLInputElement).value;
        store.scheduleSave();
      },
    }) as HTMLInputElement;
    applyTitleSize(titleInput, size);

    function bump(delta: number): void {
      const next = Math.min(TITLE_SIZE_MAX, Math.max(TITLE_SIZE_MIN, titleSizeOf(b) + delta));
      b.titleSize = next;
      applyTitleSize(titleInput, next);
      upBtn.disabled = next >= TITLE_SIZE_MAX;
      downBtn.disabled = next <= TITLE_SIZE_MIN;
      store.commit();
    }

    const upBtn = el('button', {
      class: 'tsz-btn',
      title: '제목 글씨 크게',
      html: '▲',
      disabled: size >= TITLE_SIZE_MAX ? 'disabled' : undefined,
      onclick: (e: Event) => {
        e.stopPropagation();
        bump(TITLE_SIZE_STEP);
      },
    }) as HTMLButtonElement;

    const downBtn = el('button', {
      class: 'tsz-btn',
      title: '제목 글씨 작게',
      html: '▼',
      disabled: size <= TITLE_SIZE_MIN ? 'disabled' : undefined,
      onclick: (e: Event) => {
        e.stopPropagation();
        bump(-TITLE_SIZE_STEP);
      },
    }) as HTMLButtonElement;

    const sizeCtrl = el('div', { class: 'btitle-size-ctrl' }, [upBtn, downBtn]);

    return el('div', { class: 'btitle-wrap' }, [titleInput, sizeCtrl]);
  }

  function conceptImagePanel(b: ConceptBlock): { panel: HTMLElement; layer: HTMLElement } {
    const fld = field('f-cimg', '', b.imgHtml);
    const layer = el('div', { class: 'img-layer' });
    const panel = el('div', { class: 'panel imgpanel', style: 'flex:1' }, [
      images.imgTools(b),
      fld,
      layer,
    ]);
    images.attachPaste(fld, b);
    images.enableImageDrop(panel, b);
    return { panel, layer };
  }

  function renderConceptBody(node: HTMLElement, b: ConceptBlock): void {
    const ex = field('f-ex', '', b.exHtml);
    const exPanel = el('div', { class: 'panel', style: 'flex:1' }, [panelLines(b.exBg, b.tint), ex]);

    if (b.imgMode === 'none') {
      node.appendChild(el('div', { class: 'bbody col' }, [exPanel]));
      return;
    }

    if (b.ratio == null) b.ratio = 0.5;
    const { panel: imgPanel, layer } = conceptImagePanel(b);
    imgPanel.style.flex = String(b.ratio);
    exPanel.style.flex = String(1 - b.ratio);

    if (b.imgMode === 'top') {
      const hdiv = el('div', { class: 'hdiv adjustable', title: '드래그하여 이미지·설명 비율 조절' });
      interactions.enableVSplit(hdiv, b);
      node.appendChild(el('div', { class: 'bbody col' }, [imgPanel, hdiv, exPanel]));
    } else {
      const vdiv = el('div', { class: 'vdiv', title: '드래그하여 이미지·설명 비율 조절' });
      interactions.enableSplit(vdiv, b);
      node.appendChild(el('div', { class: 'bbody' }, [imgPanel, vdiv, exPanel]));
    }

    requestAnimationFrame(() => images.renderImages(b, layer));
  }

  function renderImageOnlyBody(node: HTMLElement, b: Extract<Block, { type: 'image' }>): void {
    const layer = el('div', { class: 'img-layer' });
    const drop = el('div', { class: 'imgonly-drop', tabindex: '0' });

    const panel = el('div', { class: 'panel imgpanel imgonly', style: 'flex:1' }, [
      images.imgTools(b),
      drop,
      layer,
    ]);

    images.attachPaste(drop, b);
    images.enableImageDrop(panel, b);

    if (b.titleHidden == null) b.titleHidden = true;

    node.appendChild(el('div', { class: 'bbody col' }, [panel]));
    requestAnimationFrame(() => images.renderImages(b, layer));
  }

  function toggleConceptImg(b: ConceptBlock, mode: 'top' | 'left'): void {
    syncFromDOM();
    b.imgMode = b.imgMode === mode ? 'none' : mode;
    if (b.ratio == null) b.ratio = 0.5;
    store.save();
    render();
  }

  function render(): void {
    pageBook.clearBlockNodes();
    const stack = pageBook.getPrimaryStack();
    stack.innerHTML = '';

    if (!store.state.blocks.length) {
      stack.appendChild(
        el('div', { class: 'empty' }, [
          el('div', { class: 'big', text: '학습지가 비어 있어요' }),
          el('p', {
            html: '왼쪽에서 블록을 골라 추가하세요.<br>문제풀이 · 개념설명 · 모의고사 블록을 자유롭게 조합할 수 있습니다.',
          }),
        ]),
      );
    } else {
      const n = { problem: 0, concept: 0, mock: 0, image: 0 };
      store.state.blocks.forEach((b, i) => {
        n[b.type]++;
        stack.appendChild(renderBlock(b, i, n[b.type]));
      });
    }

    requestAnimationFrame(() => pageBook.paginate());
  }

  function renderHead(): void {
    const head = pageBook.getSheetHead();
    if (!head) return;
    head.innerHTML = '';
    head.style.display = store.state.meta.showHead ? '' : 'none';
    if (!store.state.meta.showHead) {
      paginateSoon();
      return;
    }

    const title = el('div', {
      class: 'sheet-title',
      contenteditable: 'true',
      spellcheck: 'false',
    });
    title.textContent = store.state.meta.title || '';
    title.addEventListener('input', () => {
      store.state.meta.title = title.textContent ?? '';
      store.scheduleSave();
      pageBook.onContTitleChange();
      paginateSoon();
    });
    head.appendChild(title);
    head.appendChild(
      el('div', { class: 'sheet-meta' }, [
        metaField('이름'),
        metaField('학년 · 반'),
        metaField('날짜'),
      ]),
    );
  }

  function metaField(label: string): HTMLElement {
    return el('div', { class: 'meta-field' }, [
      el('span', { text: label }),
      el('span', { class: 'meta-line' }),
    ]);
  }

  function addBlock(type: Block['type']): void {
    syncFromDOM();
    store.state.blocks.push(makeBlock(store, type));
    store.commit();
    render();
  }

  return { render, renderHead, syncFromDOM, addBlock, closePops };
}

export type Renderer = ReturnType<typeof createRenderer>;
