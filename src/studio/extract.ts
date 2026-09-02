/**
 * 구운 초안(snapshot)에서 캡처를 모으고, vision 모델로 **충실히 전사**해 내용 모델을 만든다.
 *
 * 원칙: 만들어 내지 않는다. 캡처에 있는 글만 옮겨 적고, 그림은 전사하지 않고
 * 위치(bbox)만 받아 나중에 잘라 붙인다. 실패한 캡처는 통째 이미지로 싣는다 —
 * 구멍이 남는 일은 없다.
 *
 * 캡처 단위는 **칸의 문제칸(패널) 그 자체**다. 구운 쪽에서 패널을 그대로 잘라 보내므로,
 * 모델이 돌려주는 bbox(0~1)가 곧 패널 안 자리가 된다 — 완성본은 그 자리에 그대로 앉힌다.
 */

import { complete, parseJsonLoose, type AiSettings } from '../lib/aiClient';
import type { AppState, Block, ImageObj } from '../types';
import { validateItems, type Rect, type WorksheetItem } from './schema';
import { compositePanel, cropPanel, within, type Bake, type ImgBox, type PanelKey } from './snapshot';

/** 한 번의 vision 요청 단위 — 한 칸의 문제칸을 그대로 잘라낸 그림 한 장 */
export interface CaptureUnit {
  /** `blockId:panel` — 패널 하나가 캡처 하나다 */
  id: string;
  blockId: number;
  panel: PanelKey;
  /** 모델에게 보여줄 이미지 dataURL (글만 있는 칸은 빈 문자열) */
  src: string;
  /** 교사가 직접 친 텍스트 — 참고 원문으로 준다 */
  contextText: string;
  tagLabel: string;
  blockType: Block['type'];
}

export interface CaptureResult {
  unit: CaptureUnit;
  items: WorksheetItem[];
  /** 전사에 실패해 이미지로 폴백했는지 */
  failed: boolean;
  error?: string;
}

function plainText(html: string): string {
  const d = document.createElement('div');
  d.innerHTML = html;
  return (d.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function blockImages(b: Block): ImageObj[] {
  return 'imgs' in b ? b.imgs : [];
}

/** 칸에 타이핑된 글(제목 제외) */
function typedText(b: Block): string {
  const parts: string[] = [];
  if ('probHtml' in b) parts.push(plainText(b.probHtml));
  if ('exHtml' in b) parts.push(plainText(b.exHtml));
  if ('imgHtml' in b) parts.push(plainText(b.imgHtml));
  if ('html' in b) parts.push(plainText(b.html));
  return parts.filter(Boolean).join('\n');
}

export function tagOf(b: Block, idx: number): string {
  if (b.tagLabel) return b.tagLabel;
  const base =
    b.type === 'concept'
      ? '개념'
      : b.type === 'mock'
        ? '모의고사'
        : b.type === 'image'
          ? '이미지'
          : '문제';
  return `${base} ${idx + 1}`;
}

/** 이 블록에서 캡처(그림)가 놓이는 패널 */
export function imagePanelOf(b: Block): PanelKey | null {
  if (b.type === 'problem' || b.type === 'mock') return 'prob';
  if (b.type === 'image') return 'main';
  if (b.type === 'concept') return b.imgMode === 'none' ? null : 'cimg';
  return null;
}

/**
 * 구운 초안을 훑어 캡처 단위를 만든다 — 이미지가 있는 칸만 AI를 부른다.
 * 글만 있는 칸은 이미 정확하므로 그대로 옮기고, 빈 칸도 자리를 지키게 남긴다.
 */
export async function collectCaptures(
  state: AppState,
  bake: Bake,
): Promise<{ units: CaptureUnit[]; textOnly: CaptureResult[]; empty: CaptureResult[] }> {
  const units: CaptureUnit[] = [];
  const textOnly: CaptureResult[] = [];
  const empty: CaptureResult[] = [];

  for (const [idx, b] of state.blocks.entries()) {
    if (!bake.blocks.has(b.id)) continue; // 화면에 없는 블록은 완성본에도 없다
    const imgs = blockImages(b);
    const text = typedText(b);
    const tag = tagOf(b, idx);
    const panel = imagePanelOf(b);

    if (imgs.length && panel) {
      const src = cropPanel(bake, b.id, panel) ?? (await compositePanel(bake, b.id, panel, imgs));
      if (src) {
        units.push({ id: `${b.id}:${panel}`, blockId: b.id, panel, src, contextText: text, tagLabel: tag, blockType: b.type });
        continue;
      }
    }

    const unit: CaptureUnit = {
      id: `${b.id}:text`,
      blockId: b.id,
      panel: panel ?? 'ex',
      src: '',
      contextText: text,
      tagLabel: tag,
      blockType: b.type,
    };
    if (text) textOnly.push({ unit, items: itemsFromText(b, text), failed: false });
    else empty.push({ unit, items: [], failed: false });
  }

  return { units, textOnly, empty };
}

/** 교사가 친 글만 있는 칸 — AI 없이 바로 아이템으로 만든다 */
function itemsFromText(b: Block, text: string): WorksheetItem[] {
  if (b.type === 'concept') {
    return [{ kind: 'concept', body: [{ t: 'text', s: text }] }];
  }
  return [{ kind: 'problem', stem: [{ t: 'text', s: text }], answerLines: 4 }];
}

export const EXTRACT_SYSTEM = `당신은 학습지 캡처 이미지를 새 학습지로 옮겨 적는 편집자다.

이미지는 학습지 한 칸의 **문제칸**만 그대로 찍은 것이다(풀이칸은 없다). 교사가 교과서
캡처 조각 여러 장을 이어 붙이고 글을 타이핑해 넣은 칸일 수 있다 — 조각 경계는 무시하고
배치 순서(위→아래, 왼쪽→오른쪽)대로 읽어 **이어지는 글은 한 문제로 합쳐** 전사한다.
타이핑된 글도 전사 대상이다. 참고로 준 원문과 같은 글이면 원문을 그대로 쓴다.

절대 규칙
- 이미지에 보이는 글을 **그대로 전사**한다. 요약·의역·문제 창작·정답 추가는 절대 금지다.
- 확신이 서지 않는 어절도 보이는 대로 적고, 그 어절을 uncertain 배열에 넣는다.
- 수식은 {"t":"math","latex":"..."} 런으로, 나머지 글은 {"t":"text","s":"..."} 런으로 쓴다.
- **그림·그래프·표는 글로 옮기지 않는다.** 대신 그 영역을 figures 의 bbox 로만 알려 준다.
- 손으로 쓴 필기·밑줄·동그라미, 배경의 줄·격자 선은 옮기지 않는다.
- 모든 item 에 그 문제(또는 개념)가 차지하는 영역을 bbox 로 적는다 — 번호·발문·보기·그림을
  모두 포함하는 사각형이다. bbox 는 [x, y, w, h] 이고 이미지 크기 대비 0~1 비율이다.
- ①②③④⑤ 같은 선택지는 choices 로, (1) (2) 같은 소문항은 subqs 로 분리한다.
- 캡처에 문제가 여러 개면 items 를 여러 개로 나눈다.
- 문제 본문 없이 그림뿐이면 [{"kind":"image","bbox":[...]}] 하나만 돌려준다.
- 머리말·쪽번호·출처 표시 같은 교과서 부속물은 옮기지 않는다.

출력은 아래 모양의 JSON 객체 하나뿐이다. 설명이나 코드펜스를 붙이지 마라.
{"items":[
  {"kind":"problem","no":"12","bbox":[0,0,1,0.5],"stem":[런...],"choices":[[런...],...],
   "subqs":[[런...],...],"figures":[{"bbox":[0.6,0.1,0.4,0.3],"caption":"..."}],
   "uncertain":["..."],"tagLabel":"서술형"},
  {"kind":"concept","title":"...","bbox":[0,0.5,1,0.5],"body":[런...]},
  {"kind":"image","bbox":[0,0,1,1]}
]}`;

function userPrompt(unit: CaptureUnit): string {
  const ctx = unit.contextText
    ? `\n\n참고 — 교사가 이 칸에 타이핑해 둔 원문(이미지에도 보인다. 같은 글이면 이대로 쓴다):\n${unit.contextText}`
    : '';
  return `학습지 한 칸의 문제칸을 그대로 찍은 캡처입니다. 배치 순서대로 읽어 문제 단위로 전사하고, 각 문제의 bbox 를 적어 주세요.${ctx}`;
}

/** 캡처 한 장을 전사한다. 실패하면 이미지 폴백을 돌려준다. */
export async function extractOne(
  settings: AiSettings,
  unit: CaptureUnit,
  signal?: AbortSignal,
): Promise<CaptureResult> {
  const fallback = (error: string): CaptureResult => ({
    unit,
    items: [{ kind: 'image', from: unit.id, bbox: [0, 0, 1, 1] }],
    failed: true,
    error,
  });

  try {
    const text = await complete(settings, {
      system: EXTRACT_SYSTEM,
      user: userPrompt(unit),
      images: [unit.src],
      json: true,
      signal,
    });
    let raw: unknown;
    try {
      raw = parseJsonLoose<unknown>(text);
    } catch {
      // 모델이 JSON 대신 잡담을 보냈다 — 교사에게는 원인만 짧게 알린다.
      return fallback('모델이 형식을 지키지 않았습니다. 이미지로 넣었으니 다시 시도해 보세요.');
    }
    const items = validateItems(raw, unit.id);
    if (!items) return fallback('전사 내용이 비었거나 형식이 어긋납니다. 이미지로 넣었습니다.');
    return { unit, items, failed: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fallback(`전사에 실패했습니다 — ${msg}`);
  }
}

/** 두 비율 사각형이 겹치는 넓이 */
function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * 도판이 원본 이미지 한 장 안에(90% 이상) 들어가면 그 이미지에서 자르도록 출처를 단다.
 * 구운 쪽에서 자르는 것보다 해상도가 좋고, 배경 줄이나 타이핑 글이 섞이지 않는다.
 */
export function resolveFigureSources(items: WorksheetItem[], boxes: ImgBox[] | undefined): void {
  if (!boxes?.length) return;
  for (const it of items) {
    if (it.kind === 'image') continue;
    for (const f of it.figures ?? []) {
      const area = f.bbox[2] * f.bbox[3];
      if (area <= 0) continue;
      const hit = boxes.find((b) => overlapArea(f.bbox, b.rect) / area >= 0.9);
      if (!hit) continue;
      const inner = within(f.bbox, hit.rect);
      const x0 = Math.max(0, inner[0]);
      const y0 = Math.max(0, inner[1]);
      const x1 = Math.min(1, inner[0] + inner[2]);
      const y1 = Math.min(1, inner[1] + inner[3]);
      if (x1 - x0 <= 0.01 || y1 - y0 <= 0.01) continue;
      f.source = { imgId: hit.imgId, bbox: [x0, y0, x1 - x0, y1 - y0], at: hit.rect };
    }
  }
}

/**
 * 캡처들을 최대 2개씩 동시에 전사한다. 한 장이 끝날 때마다 onProgress 가 불린다 —
 * 진행 표시가 실제 진도를 따라가게.
 */
export async function extractAll(
  settings: AiSettings,
  units: CaptureUnit[],
  onProgress: (done: number, total: number, result: CaptureResult) => void,
  signal?: AbortSignal,
): Promise<CaptureResult[]> {
  const results: CaptureResult[] = new Array(units.length);
  let next = 0;
  let done = 0;

  async function worker(): Promise<void> {
    while (next < units.length) {
      if (signal?.aborted) return;
      const i = next++;
      const r = await extractOne(settings, units[i], signal);
      results[i] = r;
      done += 1;
      onProgress(done, units.length, r);
    }
  }

  await Promise.all([worker(), worker()]);
  return results.filter(Boolean);
}
