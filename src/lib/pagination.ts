import { PAGE_H, PAGE_PAD_BOTTOM, PAGE_PAD_TOP, STACK_GAP } from '../constants';
import type { Store } from '../state/store';
import { $, $$, el } from '../utils/dom';

export interface PageBook {
  initBook: () => void;
  getPrimaryStack: () => HTMLElement;
  getSheetHead: () => HTMLElement | null;
  clearBlockNodes: () => void;
  paginate: () => void;
  lastPage: () => number;
  onContTitleChange: () => void;
}

export function createPagination(store: Store, onLayout?: () => void): PageBook {
  let paginating = false;
  function bookEl(): HTMLElement | null {
    return $('#sheetBook');
  }

  function getPages(): HTMLElement[] {
    const book = bookEl();
    if (!book) return [];
    return $$('.sheet-page', book) as HTMLElement[];
  }

  function ensureBook(): void {
    if (bookEl() && getPages().length) return;
    let book = bookEl();
    if (!book) {
      book = el('div', { class: 'sheet-book', id: 'sheetBook' });
      const wrap = $('#sheetWrap');
      if (wrap) wrap.appendChild(book);
    }
    if (!getPages().length) createPage(1, true);
  }

  function initBook(): void {
    let book = bookEl();
    if (!book) {
      book = el('div', { class: 'sheet-book', id: 'sheetBook' });
      const wrap = $('#sheetWrap');
      if (wrap) wrap.appendChild(book);
    }
    book.innerHTML = '';
    createPage(1, true);
  }

  function createPage(num: number, isFirst: boolean): HTMLElement {
    const book = bookEl()!;
    const page = el('div', { class: 'sheet-page', data: { page: String(num) } });

    if (isFirst) {
      page.appendChild(el('div', { class: 'sheet-head', id: 'sheetHead' }));
    } else {
      page.appendChild(buildContHead());
    }

    const stack = el('div', {
      class: 'stack',
      ...(isFirst ? { id: 'stack' } : {}),
      data: { pageStack: String(num) },
    });
    page.appendChild(stack);
    page.appendChild(el('div', { class: 'page-foot' }, el('span', { class: 'page-num' })));
    book.appendChild(page);
    return page;
  }

  function buildContHead(): HTMLElement {
    const displayTitle = (store.state.meta.contTitle || store.state.meta.title || '').trim();
    const head = el('div', { class: 'page-cont-head' }, [
      el('span', { class: 'pc-eyebrow', text: '이어서' }),
      el('span', {
        class: 'pc-name',
        contenteditable: 'true',
        spellcheck: 'false',
        text: displayTitle,
      }),
    ]);

    const nameEl = $('.pc-name', head)!;
    nameEl.addEventListener('input', () => {
      store.state.meta.contTitle = nameEl.textContent?.trim() ?? '';
      store.scheduleSave();
      syncContHeads();
    });

    return head;
  }

  function syncContHeads(): void {
    const displayTitle = (store.state.meta.contTitle || store.state.meta.title || '').trim();
    getPages().forEach((page, i) => {
      if (i === 0) return;
      const nameEl = $('.pc-name', page);
      if (nameEl && document.activeElement !== nameEl) {
        nameEl.textContent = displayTitle;
      }
    });
  }

  function getPrimaryStack(): HTMLElement {
    ensureBook();
    return $('#stack')!;
  }

  function getSheetHead(): HTMLElement | null {
    return $('#sheetHead');
  }

  function collectBlocksInOrder(): HTMLElement[] {
    const blocks: HTMLElement[] = [];
    getPages().forEach((page) => {
      $$('.block', page).forEach((b) => blocks.push(b as HTMLElement));
    });
    return blocks;
  }

  function groupIntoRows(blocks: HTMLElement[]): HTMLElement[][] {
    const rows: HTMLElement[][] = [];
    let i = 0;
    while (i < blocks.length) {
      const b = blocks[i];
      if (
        b.classList.contains('half') &&
        i + 1 < blocks.length &&
        blocks[i + 1].classList.contains('half')
      ) {
        rows.push([b, blocks[i + 1]]);
        i += 2;
      } else {
        rows.push([b]);
        i += 1;
      }
    }
    return rows;
  }

  function rowHeight(row: HTMLElement[]): number {
    return Math.max(...row.map((b) => b.offsetHeight));
  }

  function stackBudget(page: HTMLElement): number {
    const stack = $('.stack', page) as HTMLElement;
    const measured = stack.clientHeight;
    if (measured > 0) return measured;

    const head = page.querySelector('.sheet-head, .page-cont-head') as HTMLElement | null;
    const foot = page.querySelector('.page-foot') as HTMLElement | null;
    let chrome = 0;
    if (head) {
      const mb = parseFloat(getComputedStyle(head).marginBottom) || 0;
      chrome += head.offsetHeight + mb;
    }
    if (foot) {
      const mt = parseFloat(getComputedStyle(foot).marginTop) || 0;
      chrome += foot.offsetHeight + mt;
    }
    const pageH = page.clientHeight || PAGE_H;
    return Math.max(120, pageH - PAGE_PAD_TOP - PAGE_PAD_BOTTOM - chrome);
  }

  function ensurePage(num: number): HTMLElement {
    const pages = getPages();
    if (pages[num - 1]) return pages[num - 1];
    return createPage(num, false);
  }

  function trimPages(keep: number): void {
    const pages = getPages();
    for (let i = pages.length - 1; i >= keep; i--) {
      if (!pages[i].querySelector('.block')) pages[i].remove();
    }
  }

  function updatePageNumbers(total: number): void {
    getPages().forEach((page, i) => {
      const numEl = $('.page-num', page);
      if (numEl) numEl.textContent = `${i + 1} / ${total} 쪽`;
    });
  }

  function paginateSinglePage(blocks: HTMLElement[]): void {
    ensureBook();
    const pages = getPages();
    while (pages.length > 1) pages[pages.length - 1].remove();
    const stack = $('.stack', getPages()[0])! as HTMLElement;
    const frag = document.createDocumentFragment();
    blocks.forEach((b) => frag.appendChild(b));
    stack.appendChild(frag);
    updatePageNumbers(1);
    onLayout?.();
  }

  function paginateMultiPage(blocks: HTMLElement[]): void {
    ensureBook();

    if (!blocks.length) {
      while (getPages().length > 1) getPages()[getPages().length - 1].remove();
      updatePageNumbers(1);
      onLayout?.();
      return;
    }

    const page1 = getPages()[0];
    const stack1 = $('.stack', page1)! as HTMLElement;

    blocks.forEach((b) => stack1.appendChild(b));

    const rows = groupIntoRows(blocks);
    // DOM에 붙어 있을 때 높이를 미리 측정 (떼어내면 offsetHeight가 0이 됨)
    const rowMetrics = rows.map((row) => ({ row, h: rowHeight(row) }));

    while (getPages().length > 1) getPages()[getPages().length - 1].remove();

    const frag = document.createDocumentFragment();
    blocks.forEach((b) => frag.appendChild(b));

    let pageIdx = 0;
    let used = 0;
    let currentPage = getPages()[0];
    let currentStack = $('.stack', currentPage)! as HTMLElement;
    let budget = stackBudget(currentPage);

    for (const { row, h } of rowMetrics) {
      const need = used === 0 ? h : used + STACK_GAP + h;

      if (need > budget && used > 0) {
        pageIdx++;
        currentPage = ensurePage(pageIdx + 1);
        currentStack = $('.stack', currentPage)! as HTMLElement;
        budget = stackBudget(currentPage);
        used = 0;
      }

      if (h > budget && row.length === 1) row[0].classList.add('over');
      else row.forEach((b) => b.classList.remove('over'));

      row.forEach((b) => currentStack.appendChild(b));
      used = used === 0 ? h : used + STACK_GAP + h;
    }

    trimPages(pageIdx + 1);
    syncContHeads();
    updatePageNumbers(pageIdx + 1);
    onLayout?.();
  }

  function updateBookMode(): void {
    const book = bookEl();
    if (book) book.classList.toggle('scroll-mode', !store.state.meta.pageFit);
  }

  function paginate(): void {
    if (paginating) return;
    paginating = true;
    try {
      updateBookMode();
      const blocks = collectBlocksInOrder();

      if (!store.state.meta.pageFit) {
        paginateSinglePage(blocks);
        return;
      }

      if (!blocks.length) {
        ensureBook();
        while (getPages().length > 1) getPages()[getPages().length - 1].remove();
        updatePageNumbers(1);
        return;
      }

      paginateMultiPage(blocks);
    } finally {
      paginating = false;
    }
  }

  function lastPage(): number {
    return Math.max(1, getPages().length);
  }

  /** render() 전 호출 — 2쪽+에 남은 블록 DOM이 paginate에 다시 끌려오는 것 방지 */
  function clearBlockNodes(): void {
    ensureBook();
    const book = bookEl();
    if (!book) return;
    $$('.block', book).forEach((b) => b.remove());
    while (getPages().length > 1) getPages()[getPages().length - 1].remove();
  }

  return {
    initBook,
    getPrimaryStack,
    getSheetHead,
    clearBlockNodes,
    paginate,
    lastPage,
    onContTitleChange: syncContHeads,
  };
}

export type Pagination = PageBook;
