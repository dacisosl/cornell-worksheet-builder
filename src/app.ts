import { PAGINATE_DEBOUNCE_MS, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from './constants';
import { makeBlock } from './lib/blocks';
import { hasImages } from './lib/blocks';
import { createDrawService } from './lib/draw';
import { createImageService } from './lib/images';
import { createInteractions } from './lib/interactions';
import { createPagination } from './lib/pagination';
import { createRenderer } from './lib/render';
import { Store } from './state/store';
import type { BlockType } from './types';
import { debounce, el } from './utils/dom';
import { Icons } from './utils/icons';

export function createApp(root: HTMLElement) {
  const store = new Store();

  let renderer!: ReturnType<typeof createRenderer>;
  let images!: ReturnType<typeof createImageService>;

  function applyZoom(): void {
    const book = document.getElementById('sheetBook');
    const wrap = document.getElementById('sheetWrap');
    const zlabel = document.getElementById('zlabel');
    if (!book || !wrap || !zlabel) return;

    const z = store.getZoom();
    book.style.transform = 'scale(' + z + ')';
    wrap.style.height = book.offsetHeight * z + 'px';
    zlabel.textContent = Math.round(z * 100) + '%';
  }

  const pagination = createPagination(store, () => {
    store.state.blocks.forEach((b) => {
      if (hasImages(b)) images.reLayer(b);
    });
    applyZoom();
  });

  const paginateSoon = debounce(() => pagination.paginate(), PAGINATE_DEBOUNCE_MS);

  const render = () => renderer.render();
  images = createImageService({ store, render });
  const draw = createDrawService({ store });

  const interactions = createInteractions({
    store,
    images,
    syncFromDOM: () => renderer.syncFromDOM(),
    render,
    paginate: () => pagination.paginate(),
  });

  renderer = createRenderer({ store, images, interactions, draw, pageBook: pagination, paginateSoon });

  function setZoom(z: number): void {
    store.setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)));
    applyZoom();
  }

  function resetAll(): void {
    if (!confirm('모든 블록과 내용을 지울까요?')) return;
    store.reset();
    renderer.renderHead();
    render();
    applyZoom();
  }

  function safeTitle(): string {
    return (store.state.meta.title || '학습지').replace(/[^\w가-힣\s-]/g, '').trim() || '학습지';
  }

  function dateStamp(): string {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  function exportWorksheet(): void {
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeTitle()}_${dateStamp()}.cornell.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importWorksheet(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (
          store.state.blocks.length &&
          !confirm('현재 작업 중인 학습지를 불러온 내용으로 교체할까요?')
        ) {
          return;
        }
        const ok = store.importJSON(reader.result as string);
        if (!ok) {
          alert('학습지 파일을 불러올 수 없습니다. 형식을 확인해 주세요.');
          return;
        }
        renderer.renderHead();
        render();
        applyZoom();
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function buildShell(): void {
    root.appendChild(
      el('div', { class: 'brand' }, [
        el('div', { class: 'mark' }),
        el('h1', { html: '코넬 학습지 <span>빌더</span>' }),
      ]),
    );

    const zoomGroup = el('div', { class: 'toolgroup' }, [
      el('button', { class: 'zbtn', text: '−', onclick: () => setZoom(store.getZoom() - ZOOM_STEP) }),
      el('span', { class: 'zlabel', id: 'zlabel', text: '100%' }),
      el('button', { class: 'zbtn', text: '+', onclick: () => setZoom(store.getZoom() + ZOOM_STEP) }),
    ]);

    root.appendChild(
      el('div', { class: 'topbar' }, [
        zoomGroup,
        el('div', { class: 'spacer' }),
        el('button', {
          class: 'tbtn ghost',
          title: 'JSON 파일에서 학습지 불러오기',
          html: Icons.upload + '<span>불러오기</span>',
          onclick: importWorksheet,
        }),
        el('button', {
          class: 'tbtn ghost',
          title: '현재 학습지를 JSON 파일로 저장',
          html: Icons.download + '<span>저장</span>',
          onclick: exportWorksheet,
        }),
        el('button', { class: 'tbtn ghost', text: '전체 비우기', onclick: resetAll }),
        el('button', {
          class: 'tbtn primary',
          html: Icons.print + '<span>인쇄 / PDF</span>',
          onclick: () => window.print(),
        }),
      ]),
    );

    const sidebar = el('aside', { class: 'sidebar' });

    // 간결모드: 사이드바를 접어 블록 팔레트를 아이콘(썸네일)만 표시
    const SIDE_KEY = 'cornell-side-collapsed';
    if (localStorage.getItem(SIDE_KEY) === '1') root.classList.add('side-collapsed');
    const sideToggle = el('button', {
      class: 'side-toggle',
      title: '사이드바 접기/펼치기',
      onclick: () => {
        const on = root.classList.toggle('side-collapsed');
        try {
          localStorage.setItem(SIDE_KEY, on ? '1' : '0');
        } catch {
          /* ignore */
        }
        refreshSideToggle();
      },
    });
    function refreshSideToggle(): void {
      const on = root.classList.contains('side-collapsed');
      sideToggle.innerHTML = on ? '&raquo;' : '<span>간결모드</span>&laquo;';
    }
    refreshSideToggle();
    sidebar.appendChild(sideToggle);

    sidebar.appendChild(
      el('div', { class: 'side-section' }, [
        el('div', { class: 'side-h', text: '블록 추가' }),
        el('div', { class: 'palette' }, [
          paletteCard('problem', '문제풀이', '문제 · 풀이 가로 배열. 문제칸에 캡처를 Ctrl+V로 삽입. 기본 A4 ⅓.', thumbProblem()),
          paletteCard('concept', '개념설명', '개념 이름 · 설명 세로 배열. 줄글/격자, 연한 배경 선택.', thumbConcept()),
          paletteCard('mock', '모의고사', '가로 A4 ½ 폭 · 세로 2단. 문제 위, 긴 풀이 아래. 두 개가 나란히.', thumbMock()),
          paletteCard('image', '이미지 전용', '텍스트 없이 이미지만 자유 배치. 높이·폭(½/전체) 조절 가능.', thumbImageOnly()),
          paletteCard('image', '이미지 전용 (반칸)', '가로 ½ 폭 이미지 블록. 두 개가 나란히 배치됩니다.', thumbImageHalf(), { width: 'half' }),
        ]),
      ]),
    );

    sidebar.appendChild(
      el('div', { class: 'side-section' }, [
        el('div', { class: 'side-h', text: '학습지 옵션' }),
        el('div', {}, [
          optRow('헤더(제목·이름칸) 표시', store.state.meta.showHead, (v) => {
            store.state.meta.showHead = v;
            store.save();
            renderer.renderHead();
            paginateSoon();
          }),
          optRow('이미지 격자 스냅', store.state.meta.grid, (v) => {
            store.state.meta.grid = v;
            store.save();
          }),
          optRow('A4 쪽 경계 맞춤', store.state.meta.pageFit, (v) => {
            store.state.meta.pageFit = v;
            store.save();
            pagination.paginate();
          }),
        ]),
      ]),
    );

    sidebar.appendChild(
      el('div', { class: 'side-section' }, [
        el('div', {
          class: 'side-note',
          html: '<b>쪽 나누기</b> · 블록이 A4 한 쪽을 넘으면 다음 쪽이 자동으로 생깁니다. 2쪽부터 <b>이어서</b> + 제목(수정 가능)이 헤더에, 쪽번호가 하단에 표시됩니다.',
        }),
        el('div', {
          class: 'side-note',
          style: 'margin-top:10px',
          html: '<b>이미지</b> · 문제 칸에서 <b>Ctrl+V</b>로 캡처 붙여넣기. 드래그·리사이즈·화질 보정·정돈 버튼을 활용하세요.',
        }),
      ]),
    );

    root.appendChild(sidebar);

    root.appendChild(
      el('main', { class: 'canvas', id: 'canvas' }, el('div', { class: 'sheet-wrap', id: 'sheetWrap' })),
    );
  }

  function paletteCard(
    type: BlockType,
    title: string,
    desc: string,
    thumb: HTMLElement,
    opts?: { width?: 'full' | 'half' },
  ) {
    return el('button', { class: 'pcard', title, onclick: () => renderer.addBlock(type, opts) }, [
      el('div', { class: 'pthumb' }, thumb),
      el('div', {}, [el('p', { class: 'ptitle', text: title }), el('p', { class: 'pdesc', text: desc })]),
    ]);
  }

  function thumbProblem() {
    return el('div', { class: 'th-row' }, [
      el('div', { class: 'th-box', style: 'flex:1' }),
      el('div', { class: 'th-box th-lines', style: 'flex:1' }),
    ]);
  }

  function thumbConcept() {
    return el('div', { class: 'th-col' }, [
      el('div', { class: 'th-box fill th-bar' }),
      el('div', { class: 'th-box th-lines', style: 'flex:1' }),
    ]);
  }

  function thumbMock() {
    return el('div', { class: 'th-row' }, [
      el('div', { class: 'th-col', style: 'position:relative;inset:auto;flex:1' }, [
        el('div', { class: 'th-box', style: 'flex:.4' }),
        el('div', { class: 'th-box th-lines', style: 'flex:1' }),
      ]),
      el('div', { style: 'flex:1' }),
    ]);
  }

  function thumbImageOnly() {
    return el('div', { class: 'th-col' }, [el('div', { class: 'th-box fill', style: 'flex:1' })]);
  }

  function thumbImageHalf() {
    return el('div', { class: 'th-row' }, [
      el('div', { class: 'th-box fill', style: 'flex:1' }),
      el('div', { style: 'flex:1' }),
    ]);
  }

  function optRow(label: string, val: boolean, fn: (v: boolean) => void) {
    const input = el('input', { type: 'checkbox', onchange: (e: Event) => fn((e.target as HTMLInputElement).checked) });
    if (val) input.checked = true;
    return el('div', { class: 'opt-row' }, [
      el('label', { text: label }),
      el('label', { class: 'switch' }, [input, el('span', { class: 'track' })]),
    ]);
  }

  function init(): void {
    store.seedDemoBlocks((type: BlockType) => makeBlock(store, type));
    buildShell();
    pagination.initBook();
    renderer.renderHead();
    renderer.render();
    applyZoom();

    document.addEventListener('keydown', (e) => {
      // 텍스트 편집(입력/텍스트영역/contenteditable) 중에는 브라우저 기본 undo를 우선한다.
      const a = document.activeElement as HTMLElement | null;
      const isTextEditing =
        !!a &&
        (a.tagName === 'INPUT' ||
          a.tagName === 'TEXTAREA' ||
          a.isContentEditable ||
          !!a.closest('[contenteditable="true"]'));

      const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z');
      const isRedo =
        (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z');
      if ((!isUndo && !isRedo) || isTextEditing) return;

      const ok = isUndo ? store.undo() : store.redo();
      if (ok) {
        e.preventDefault();
        renderer.renderHead();
        renderer.render();
        pagination.paginate();
        applyZoom();
      }
    });

    document.addEventListener('pointerdown', (e) => {
      if (!(e.target as Element).closest('.imgobj') && !(e.target as Element).closest('.img-tb')) {
        images.deselectImage();
      }
    });

    // 인쇄/PDF 저장 시 파일명이 학습지 제목이 되도록 문서 제목을 바꾼다.
    const baseDocTitle = document.title;
    window.addEventListener('beforeprint', () => {
      document.title = safeTitle();
      const book = document.getElementById('sheetBook');
      const wrap = document.getElementById('sheetWrap');
      if (book) book.style.transform = 'none';
      if (wrap) wrap.style.height = 'auto';
      document.body.classList.add('is-printing');
      pagination.paginate();
    });
    window.addEventListener('afterprint', () => {
      document.title = baseDocTitle;
      document.body.classList.remove('is-printing');
      applyZoom();
    });
  }

  return { init };
}
