import {
  LEGACY_KEYS,
  NOTE_MARGIN_DEFAULT,
  NOTE_MARGIN_MAX,
  NOTE_MARGIN_MIN,
  SAVE_DEBOUNCE_MS,
  STORE_KEY,
  noteScaleOf,
} from '../constants';
import type { AppMeta, AppState, Block, BlockType, ImageBlock, ImageSelection } from '../types';
import { debounce } from '../utils/dom';

function cloneState<T>(v: T): T {
  // structuredClone가 가장 안전하지만, 일부 환경을 대비해 폴백을 둔다.
  // (이 앱의 상태는 JSON-serializable 구조만 포함)
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof structuredClone === 'function') return structuredClone(v);
  return JSON.parse(JSON.stringify(v)) as T;
}

function defaultMeta(): AppMeta {
  return {
    title: '',
    contTitle: '',
    showHead: true,
    grid: true,
    pageFit: true,
    note: { on: false, margin: NOTE_MARGIN_DEFAULT },
  };
}

function normalizeMeta(meta: Partial<AppMeta> | undefined): AppMeta {
  const margin = meta?.note?.margin;
  return {
    title: meta?.title ?? '',
    contTitle: meta?.contTitle ?? '',
    showHead: meta?.showHead ?? true,
    grid: meta?.grid ?? true,
    pageFit: meta?.pageFit ?? true,
    note: {
      on: meta?.note?.on ?? false,
      margin:
        typeof margin === 'number'
          ? Math.min(NOTE_MARGIN_MAX, Math.max(NOTE_MARGIN_MIN, margin))
          : NOTE_MARGIN_DEFAULT,
    },
    draws: meta?.draws,
  };
}

function migrateLegacy(raw: unknown): AppState | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Partial<AppState>;
  if (!Array.isArray(data.blocks)) return null;

  const blocks = data.blocks.map((b) => {
    const block = { ...b } as Block;
    if ((block.type === 'problem' || block.type === 'mock') && !('imgs' in block)) {
      (block as Block & { imgs: [] }).imgs = [];
    }
    if (block.type === 'concept') {
      const c = block as unknown as Record<string, unknown> & { imgs?: unknown[] };
      if (c.imgMode == null) c.imgMode = 'none';
      if (typeof c.ratio !== 'number') c.ratio = 0.5;
      if (typeof c.imgHtml !== 'string') c.imgHtml = '';
      // 이전(슬롯) 형식의 이미지 데이터는 자유배치 이미지와 호환되지 않으므로 정리
      c.imgs = Array.isArray(c.imgs)
        ? c.imgs.filter(
            (im) =>
              im &&
              typeof (im as { w?: unknown }).w === 'number' &&
              typeof (im as { ar?: unknown }).ar === 'number',
          )
        : [];
    }
    if (block.type === 'image') {
      const img = block as unknown as { width?: unknown; titleHidden?: unknown; html?: unknown };
      if (img.width !== 'half' && img.width !== 'full') img.width = 'full';
      if (typeof img.titleHidden !== 'boolean') img.titleHidden = true;
      if (typeof img.html !== 'string') img.html = '';
    }
    return block;
  });

  return {
    meta: normalizeMeta(data.meta),
    blocks,
    zoom: data.zoom,
  };
}

function loadFromStorage(): AppState | null {
  try {
    const current = localStorage.getItem(STORE_KEY);
    if (current) return migrateLegacy(JSON.parse(current));

    for (const key of LEGACY_KEYS) {
      const legacy = localStorage.getItem(key);
      if (legacy) {
        const migrated = migrateLegacy(JSON.parse(legacy));
        if (migrated) {
          localStorage.setItem(STORE_KEY, JSON.stringify(migrated));
          return migrated;
        }
      }
    }
  } catch {
    /* ignore corrupt storage */
  }
  return null;
}

export class Store {
  state: AppState;
  seq: number;
  imgSeq: number;
  /** 기준(마지막으로 누른) 이미지 */
  selected: ImageSelection | null = null;
  /** 함께 고른 이미지 id 목록 — 항상 selected.b 블록 안의 이미지들 */
  selectedIds: number[] = [];
  private seeded: boolean;

  private history: AppState[] = [];
  private historyIdx = -1;

  readonly scheduleSave: () => void;

  constructor() {
    const loaded = loadFromStorage();
    this.seeded = !loaded;
    this.state = loaded ?? { meta: defaultMeta(), blocks: [] };
    this.state.meta = normalizeMeta(this.state.meta);

    this.seq = this.state.blocks.reduce((m, b) => Math.max(m, b.id), 0) + 1;
    this.imgSeq =
      this.state.blocks.reduce(
        (m, b) =>
          Math.max(
            m,
            'imgs' in b ? (b.imgs ?? []).reduce((mm, im) => Math.max(mm, im.id), 0) : 0,
          ),
        0,
      ) + 1;

    // 초기 상태를 히스토리에 기록 (Undo 기준점)
    this.pushHistory();
    this.scheduleSave = debounce(() => this.commit(), SAVE_DEBOUNCE_MS);
  }

  isSeeded(): boolean {
    return this.seeded;
  }

  clearSeeded(): void {
    this.seeded = false;
  }

  save(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.state));
    } catch {
      /* quota exceeded */
    }
  }

  private pushHistory(): void {
    const snap = cloneState(this.state);
    // undo 후 편집이 시작되면, 미래 히스토리를 버린다.
    if (this.historyIdx < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIdx + 1);
    }
    this.history.push(snap);
    // 너무 커지는 것 방지
    const LIMIT = 50;
    if (this.history.length > LIMIT) {
      this.history.shift();
    }
    this.historyIdx = this.history.length - 1;
  }

  commit(): void {
    this.pushHistory();
    this.save();
  }

  canUndo(): boolean {
    return this.historyIdx > 0;
  }

  canRedo(): boolean {
    return this.historyIdx < this.history.length - 1;
  }

  undo(): boolean {
    if (!this.canUndo()) return false;
    this.historyIdx -= 1;
    this.state = cloneState(this.history[this.historyIdx]);
    this.state.meta = normalizeMeta(this.state.meta);
    this.seq = this.state.blocks.reduce((m, b) => Math.max(m, b.id), 0) + 1;
    this.imgSeq =
      this.state.blocks.reduce(
        (m, b) =>
          Math.max(m, 'imgs' in b ? (b.imgs ?? []).reduce((mm, im) => Math.max(mm, im.id), 0) : 0),
        0,
      ) + 1;
    this.clearSelection();
    this.save();
    return true;
  }

  redo(): boolean {
    if (!this.canRedo()) return false;
    this.historyIdx += 1;
    this.state = cloneState(this.history[this.historyIdx]);
    this.state.meta = normalizeMeta(this.state.meta);
    this.seq = this.state.blocks.reduce((m, b) => Math.max(m, b.id), 0) + 1;
    this.imgSeq =
      this.state.blocks.reduce(
        (m, b) =>
          Math.max(m, 'imgs' in b ? (b.imgs ?? []).reduce((mm, im) => Math.max(mm, im.id), 0) : 0),
        0,
      ) + 1;
    this.clearSelection();
    this.save();
    return true;
  }

  reset(): void {
    const { grid, pageFit, note } = this.state.meta;
    this.state = {
      meta: { title: '', contTitle: '', showHead: true, grid, pageFit, note: { ...note, on: false } },
      blocks: [],
      zoom: this.state.zoom,
    };
    this.seq = 1;
    this.imgSeq = 1;
    this.clearSelection();
    this.commit();
  }

  exportJSON(): string {
    return JSON.stringify(this.state, null, 2);
  }

  importJSON(json: string): boolean {
    try {
      const parsed = migrateLegacy(JSON.parse(json));
      if (!parsed) return false;
      this.state = parsed;
      this.state.meta = normalizeMeta(this.state.meta);
      this.seq = this.state.blocks.reduce((m, b) => Math.max(m, b.id), 0) + 1;
      this.imgSeq =
        this.state.blocks.reduce(
          (m, b) =>
            Math.max(
              m,
              'imgs' in b ? (b.imgs ?? []).reduce((mm, im) => Math.max(mm, im.id), 0) : 0,
            ),
          0,
        ) + 1;
      this.clearSelection();
      this.commit();
      return true;
    } catch {
      return false;
    }
  }

  nextBlockId(): number {
    return this.seq++;
  }

  nextImgId(): number {
    return this.imgSeq++;
  }

  getZoom(): number {
    return this.state.zoom ?? 1;
  }

  /** 필기용 모드에서 본문에 적용되는 축소 비율 (모드가 꺼져 있으면 1) */
  noteScale(): number {
    const note = this.state.meta.note;
    return note.on ? noteScaleOf(note.margin) : 1;
  }

  /** 화면 좌표 → 레이아웃 좌표 변환에 쓰는 실제 배율 (줌 × 필기용 축소) */
  getEffectiveScale(): number {
    return this.getZoom() * this.noteScale();
  }

  setZoom(z: number): void {
    this.state.zoom = z;
    this.save();
  }

  findBlock(id: number): Block | undefined {
    return this.state.blocks.find((b) => b.id === id);
  }

  /** 이미지 선택을 지운다. */
  clearSelection(): void {
    this.selected = null;
    this.selectedIds = [];
  }

  /** 한 칸 안에서 고를 이미지들을 지정한다 (마지막 id가 기준). */
  setSelection(blockId: number, ids: number[]): void {
    const uniq = [...new Set(ids)];
    if (!uniq.length) {
      this.clearSelection();
      return;
    }
    this.selectedIds = uniq;
    this.selected = { b: blockId, i: uniq[uniq.length - 1] };
  }

  isImgSelected(blockId: number, imgId: number): boolean {
    return this.selected?.b === blockId && this.selectedIds.includes(imgId);
  }

  /** 아직 쓰지 않은 그룹 번호 */
  nextGroupId(): number {
    let max = 0;
    this.state.blocks.forEach((b) => {
      if (!('imgs' in b)) return;
      ((b as ImageBlock).imgs ?? []).forEach((im) => {
        if (typeof im.g === 'number') max = Math.max(max, im.g);
      });
    });
    return max + 1;
  }

  seedDemoBlocks(makeBlock: (type: BlockType) => Block): void {
    if (!this.seeded) return;
    this.state.blocks = [
      makeBlock('problem'),
      makeBlock('concept'),
      makeBlock('mock'),
      makeBlock('mock'),
    ];
    this.clearSeeded();
    this.save();
  }
}
