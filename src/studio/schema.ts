/**
 * 완성본 문서의 내용 모델.
 *
 * 빌더의 초안(Block[])과는 별개다. 초안은 "교과서 캡처를 붙여 놓은 판"이고,
 * 이 모델은 거기서 뽑아낸 **글과 그림의 구조**다. 조판(typeset)은 이 모델만 보고
 * 테마별 HTML을 만든다.
 */

/** 글 조각 — 보통 텍스트이거나 수식이다. */
export type Run = { t: 'text'; s: string } | { t: 'math'; latex: string };

/** 캡처 안에서 잘라낼 그림 영역 (0..1 비율) */
export interface FigureRef {
  /** [x, y, w, h] — 캡처 이미지 기준 비율 */
  bbox: [number, number, number, number];
  caption?: string;
  /** 잘라낸 결과 dataURL. 저장할 때는 비우고 열 때 다시 만든다. */
  src?: string;
  /** 어느 캡처에서 왔는지 (blockId:imgId) */
  from: string;
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
  /** 풀이칸 줄 수 */
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
}

/** 전사에 실패했거나 애초에 그림뿐인 캡처 — 통째로 싣는다. */
export interface ImageItem {
  kind: 'image';
  from: string;
  src?: string;
  caption?: string;
}

export type WorksheetItem = ProblemItem | ConceptItem | ImageItem;

export interface DocSection {
  /** 어느 초안 블록에서 왔는지 */
  srcBlockId: number;
  srcType: string;
  items: WorksheetItem[];
}

export interface PolishedDoc {
  meta: { title: string; subtitle?: string; date: string };
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
    else if (o.t === 'math' && typeof o.latex === 'string') out.push({ t: 'math', latex: o.latex });
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

function asFigures(raw: unknown, from: string): FigureRef[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: FigureRef[] = [];
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue;
    const o = f as Record<string, unknown>;
    const bb = o.bbox;
    if (!Array.isArray(bb) || bb.length !== 4) continue;
    const nums = bb.map(Number);
    if (nums.some((n) => !Number.isFinite(n))) continue;
    const [x, y, w, h] = nums;
    if (w <= 0 || h <= 0) continue;
    out.push({
      bbox: [clamp01(x), clamp01(y), clamp01(w), clamp01(h)],
      caption: typeof o.caption === 'string' ? o.caption : undefined,
      from,
    });
  }
  return out.length ? out : undefined;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function asStrings(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.filter((s): s is string => typeof s === 'string' && !!s.trim());
  return out.length ? out : undefined;
}

/** 풀이칸 줄 수 — 모델 값보다 초안에서 잰 값을 우선하되, 상식 범위로 묶는다. */
export function clampLines(n: unknown, fallback: number): number {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v > 0 ? Math.min(14, Math.max(2, v)) : fallback;
}

/**
 * 모델이 준 `{items:[...]}` 를 검증한다. 하나라도 모양이 어긋나면 null.
 * @param from 캡처 식별자 — 그림 출처를 채워 넣는다
 * @param defaultLines 초안에서 잰 풀이칸 줄 수
 */
export function validateItems(
  raw: unknown,
  from: string,
  defaultLines: number,
): WorksheetItem[] | null {
  const box = raw as { items?: unknown } | null;
  const list = box && Array.isArray(box.items) ? box.items : null;
  if (!list || !list.length || list.length > 40) return null;

  const out: WorksheetItem[] = [];
  for (const it of list) {
    if (!it || typeof it !== 'object') return null;
    const o = it as Record<string, unknown>;

    if (o.kind === 'image') {
      out.push({
        kind: 'image',
        from,
        caption: typeof o.caption === 'string' ? o.caption : undefined,
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
        answerLines: clampLines(o.answerLines, defaultLines),
        uncertain: asStrings(o.uncertain),
        tagLabel: typeof o.tagLabel === 'string' ? o.tagLabel : undefined,
      });
      continue;
    }

    return null;
  }
  return out.length ? out : null;
}

/** 런들을 평문으로 — 검색·해시·툴팁용 */
export function runsToPlain(runs: Run[]): string {
  return runs.map((r) => (r.t === 'text' ? r.s : r.latex)).join('');
}
