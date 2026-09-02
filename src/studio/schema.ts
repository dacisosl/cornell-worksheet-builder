/**
 * 완성본 문서의 내용 모델.
 *
 * 빌더의 초안(Block[])과는 별개다. 초안은 "교과서 캡처를 붙여 놓은 판"이고,
 * 이 모델은 거기서 뽑아낸 **글과 그림의 구조 + 초안에서 차지하던 자리**다.
 * 조판(typeset)은 이 모델만 보고 HTML을 만든다.
 *
 * 자리는 전부 비율(0..1)이다. 아이템·도판의 bbox 는 **그 칸의 문제칸(캡처) 대비**,
 * 칸의 geom 은 **쪽 본문 영역(stack) 대비**다.
 */

/** [x, y, w, h] — 어떤 기준 사각형 대비 0..1 비율 */
export type Rect = [number, number, number, number];

/**
 * 글 조각 — 보통 텍스트이거나 수식이다.
 * 수식이 원문에서 **별도 줄 가운데**에 크게 놓여 있었으면 display 다 — 조판도 그렇게 앉힌다.
 */
export type Run = { t: 'text'; s: string } | { t: 'math'; latex: string; display?: boolean };

/** 캡처 안에서 잘라낼 그림 영역 */
export interface FigureRef {
  /** 모델이 알려 준 영역 — 캡처(문제칸) 대비 비율 */
  bbox: Rect;
  /** 실제로 잘라낸 영역 — 여유·흰 여백 정리 뒤. 없으면 bbox 를 쓴다 */
  box?: Rect;
  caption?: string;
  /** 잘라낸 결과 dataURL. 저장할 때는 비우고 열 때 다시 만든다. */
  src?: string;
  /** 어느 캡처에서 왔는지 (blockId:panel) */
  from: string;
  /**
   * 원본 이미지 한 장 안에 온전히 들어가면 거기서 자른다 — 해상도가 훨씬 좋다.
   * bbox 는 그 이미지 대비 비율, at 은 그 이미지가 캡처(문제칸)에서 차지한 자리.
   */
  source?: { imgId: number; bbox: Rect; at: Rect };
}

export interface ProblemItem {
  kind: 'problem';
  /** 원문에 있던 번호. 없으면 조판이 순번을 매긴다. */
  no?: string;
  stem: Run[];
  /** 오지선다 등 객관식 보기 */
  choices?: Run[][];
  /** (1) (2) 같은 소문항 */
  subqs?: Run[][];
  figures?: FigureRef[];
  /** 원문에서 테두리·음영 박스로 묶여 있던 글 (풀이 과정 등) — 인용 박스로 앉힌다 */
  note?: Run[];
  /** 이 문제가 캡처에서 차지한 영역 — 있으면 그 자리에 앉힌다 */
  bbox?: Rect;
  /** 풀이칸 줄 수 — 흐름 조판(예시)에서만 쓴다 */
  answerLines: number;
  /** 모델이 확신하지 못한 어절 — 화면에서 형광 표시해 교사가 확인한다. */
  uncertain?: string[];
  /** 서술형·객관식 같은 꼬리표 */
  tagLabel?: string;
}

export interface ConceptItem {
  kind: 'concept';
  title?: string;
  body: Run[];
  figures?: FigureRef[];
  /** 원문에서 테두리·음영 박스로 묶여 있던 글 */
  note?: Run[];
  bbox?: Rect;
}

/** 전사에 실패했거나 애초에 그림뿐인 캡처 — 통째로 싣는다. */
export interface ImageItem {
  kind: 'image';
  from: string;
  src?: string;
  caption?: string;
  bbox?: Rect;
}

export type WorksheetItem = ProblemItem | ConceptItem | ImageItem;

export type PanelName = 'prob' | 'sol' | 'ex' | 'cimg' | 'main';

/** 초안에서 이 칸이 놓여 있던 자리 (snapshot.ts 가 잰 값, 쪽 본문 대비 비율) */
export interface SectionGeom {
  page: number;
  rect: Rect;
  head?: Rect;
  bare: boolean;
  clipped?: boolean;
  panels: Partial<Record<PanelName, Rect>>;
}

export interface DocSection {
  /** 어느 초안 블록에서 왔는지 */
  srcBlockId: number;
  srcType: string;
  /** 블록 제목행의 글 — 칸 머리에 그대로 옮긴다 */
  title?: string;
  tagLabel?: string;
  /** 초안의 배치. 있으면 조판이 그 자리·크기를 그대로 따른다. */
  geom?: SectionGeom;
  items: WorksheetItem[];
}

export interface PolishedDoc {
  meta: { title: string; subtitle?: string; date: string; showHead?: boolean };
  sections: DocSection[];
}

/* ── 검증 ─────────────────────────────────────────────────────────
   모델 응답은 못 믿는다. 모양이 어긋나면 통째로 버리고(null) 호출부가
   ImageItem 폴백으로 넘어간다. 반쯤 망가진 아이템을 조판에 흘리지 않는다. */

const MAX_RUNS = 400;

function asRuns(raw: unknown): Run[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_RUNS) return null;
  const out: Run[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') return null;
    const o = r as Record<string, unknown>;
    if (o.t === 'text' && typeof o.s === 'string') out.push({ t: 'text', s: o.s });
    else if (o.t === 'math' && typeof o.latex === 'string')
      out.push({ t: 'math', latex: o.latex, display: o.display === true });
    else return null;
  }
  return out;
}

function asRunsList(raw: unknown): Run[][] | undefined {
  if (raw == null) return undefined;
  if (!Array.isArray(raw)) return undefined;
  const out: Run[][] = [];
  for (const item of raw) {
    const runs = asRuns(item);
    if (!runs) return undefined;
    out.push(runs);
  }
  return out.length ? out : undefined;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** [x,y,w,h] 비율 사각형 — 숫자 네 개, 폭·높이 양수여야 한다 */
export function asRect(raw: unknown): Rect | undefined {
  if (!Array.isArray(raw) || raw.length !== 4) return undefined;
  const nums = raw.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return undefined;
  const [x, y, w, h] = nums;
  if (w <= 0 || h <= 0) return undefined;
  const x0 = clamp01(x);
  const y0 = clamp01(y);
  return [x0, y0, clamp01(x + w) - x0, clamp01(y + h) - y0];
}

function asFigures(raw: unknown, from: string): FigureRef[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: FigureRef[] = [];
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue;
    const o = f as Record<string, unknown>;
    const bbox = asRect(o.bbox);
    if (!bbox || bbox[2] <= 0 || bbox[3] <= 0) continue;
    out.push({
      bbox,
      caption: typeof o.caption === 'string' ? o.caption : undefined,
      from,
    });
  }
  return out.length ? out : undefined;
}

function asStrings(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.filter((s): s is string => typeof s === 'string' && !!s.trim());
  return out.length ? out : undefined;
}

/** 풀이칸 줄 수 — 상식 범위로 묶는다. */
export function clampLines(n: unknown, fallback: number): number {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v > 0 ? Math.min(14, Math.max(2, v)) : fallback;
}

/**
 * 모델이 준 `{items:[...]}` 를 검증한다. 하나라도 모양이 어긋나면 null.
 * @param from 캡처 식별자 — 그림 출처를 채워 넣는다
 */
export function validateItems(raw: unknown, from: string): WorksheetItem[] | null {
  const box = raw as { items?: unknown } | null;
  const list = box && Array.isArray(box.items) ? box.items : null;
  if (!list || !list.length || list.length > 40) return null;

  const out: WorksheetItem[] = [];
  for (const it of list) {
    if (!it || typeof it !== 'object') return null;
    const o = it as Record<string, unknown>;
    const bbox = asRect(o.bbox);

    if (o.kind === 'image') {
      out.push({
        kind: 'image',
        from,
        caption: typeof o.caption === 'string' ? o.caption : undefined,
        bbox,
      });
      continue;
    }

    if (o.kind === 'concept') {
      const body = asRuns(o.body);
      if (!body) return null;
      out.push({
        kind: 'concept',
        title: typeof o.title === 'string' ? o.title : undefined,
        body,
        figures: asFigures(o.figures, from),
        note: asRuns(o.note) ?? undefined,
        bbox,
      });
      continue;
    }

    if (o.kind === 'problem') {
      const stem = asRuns(o.stem);
      if (!stem) return null;
      out.push({
        kind: 'problem',
        no: typeof o.no === 'string' ? o.no : undefined,
        stem,
        choices: asRunsList(o.choices),
        subqs: asRunsList(o.subqs),
        figures: asFigures(o.figures, from),
        note: asRuns(o.note) ?? undefined,
        bbox,
        answerLines: clampLines(o.answerLines, 4),
        uncertain: asStrings(o.uncertain),
        tagLabel: typeof o.tagLabel === 'string' ? o.tagLabel : undefined,
      });
      continue;
    }

    return null;
  }
  return out.length ? out : null;
}

/**
 * 아이템들을 초안 자리에 고정해도 되는지 — 전부 bbox 가 있고, 위에서 아래로
 * 늘어서며, 서로 2% 넘게 겹치지 않아야 한다. 아니면 조판이 흐름으로 되돌린다.
 */
export function anchorsUsable(items: WorksheetItem[]): boolean {
  if (!items.length || items.some((it) => !it.bbox)) return false;
  const sorted = items.map((it) => it.bbox!).sort((a, b) => a[1] - b[1]);
  for (let i = 1; i < sorted.length; i += 1) {
    const prevBottom = sorted[i - 1][1] + sorted[i - 1][3];
    if (sorted[i][1] < prevBottom - 0.02) return false;
  }
  return true;
}

/** 런들을 평문으로 — 검색·해시·툴팁용 */
export function runsToPlain(runs: Run[]): string {
  return runs.map((r) => (r.t === 'text' ? r.s : r.latex)).join('');
}
