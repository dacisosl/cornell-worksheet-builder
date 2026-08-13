import { LEGACY_KEYS, SAVE_DEBOUNCE_MS, STORE_KEY } from '../constants';
import type { AppMeta, AppState, Block, BlockType, ImageSelection } from '../types';
import { debounce } from '../utils/dom';

function cloneState<T>(v: T): T {
  // structuredClone가 가장 안전하지만, 일부 환경을 대비해 폴백을 둔다.
  // (이 앱의 상태는 JSON-serializable 구조만 포함)
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof structuredClone === 'function') return structuredClone(v);
  return JSON.parse(JSON.stringify(v)) as T;
}

function defaultMeta(): AppMeta {
  return { title: '', contTitle: '', showHead: true, grid: true, pageFit: true };
}

function normalizeMeta(meta: Partial<AppMeta> | undefined): AppMeta {
  return {
    title: meta?.title ?? '',
    contTitle: meta?.contTitle ?? '',
    showHead: meta?.showHead ?? true,
    grid: meta?.grid ?? true,
    pageFit: meta?.pageFit ?? true,
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
      const img = block as unknown as { width?: unknown; titleHidden?: unknown };
      if (img.width !== 'half' && img.width !== 'full') img.width = 'full';
      if (typeof img.titleHidden !== 'boolean') img.titleHidden = true;
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
  selected: ImageSelection | null = null;
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
    this.selected = null;
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
    this.selected = null;
    this.save();
    return true;
  }

  reset(): void {
    const { grid, pageFit } = this.state.meta;
    this.state = { meta: { title: '', contTitle: '', showHead: true, grid, pageFit }, blocks: [], zoom: this.state.zoom };
    this.seq = 1;
    this.imgSeq = 1;
    this.selected = null;
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
      this.selected = null;
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

  setZoom(z: number): void {
    this.state.zoom = z;
    this.save();
  }

  findBlock(id: number): Block | undefined {
    return this.state.blocks.find((b) => b.id === id);
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
