/**
 * 초안(빌더 상태)에서 캡처를 모으고, vision 모델로 **충실히 전사**해 내용 모델을 만든다.
 *
 * 원칙: 만들어 내지 않는다. 캡처에 있는 글만 옮겨 적고, 그림은 전사하지 않고
 * 위치(bbox)만 받아 나중에 잘라 붙인다. 실패한 캡처는 통째 이미지로 싣는다 —
 * 구멍이 남는 일은 없다.
 *
 * 전사 단위는 **칸(블록)**이다. 교사가 한 칸에 붙인 조각들은 초안 배치 그대로
 * 한 장으로 합쳐 보낸다 — 그래야 조각난 지문이 토막나지 않고 한 문제로 읽힌다.
 */

import { complete, parseJsonLoose, type AiSettings } from '../lib/aiClient';
import { loadImage } from '../lib/imageProcessing';
import type { AppState, Block, ImageObj } from '../types';
import { clampLines, validateItems, type WorksheetItem } from './schema';

/** 한 번의 vision 요청 단위 — 초안 한 칸(블록)의 스냅숏 한 장 */
export interface CaptureUnit {
  /** `blockId:cell` — 칸 하나가 캡처 하나다 */
  id: string;
  blockId: number;
  /** 모델에게 보여줄 이미지 dataURL */
  src: string;
  /** 교사가 직접 친 텍스트 — 문맥으로만 준다 */
  contextText: string;
  /** 초안에서 잰 풀이칸 줄 수 */
  answerLines: number;
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

/** 한 줄 높이(px) — 초안 풀이칸 높이를 줄 수로 환산할 때 쓴다 */
const DRAFT_LINE_PX = 34;

function plainText(html: string): string {
  const d = document.createElement('div');
  d.innerHTML = html;
  return (d.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function blockImages(b: Block): ImageObj[] {
  return 'imgs' in b ? b.imgs : [];
}

function blockText(b: Block): string {
  const parts: string[] = [];
  if (b.title) parts.push(b.title);
  if ('probHtml' in b) parts.push(plainText(b.probHtml));
  if ('exHtml' in b) parts.push(plainText(b.exHtml));
  if ('imgHtml' in b) parts.push(plainText(b.imgHtml));
  if ('html' in b) parts.push(plainText(b.html));
  return parts.filter(Boolean).join('\n');
}

/** 초안 풀이칸 높이에서 줄 수를 짐작한다 */
function answerLinesOf(b: Block): number {
  if ('ratio' in b && typeof b.ratio === 'number') {
    const solPx = b.h * (1 - b.ratio);
    return clampLines(Math.round(solPx / DRAFT_LINE_PX), 4);
  }
  return 4;
}

function tagOf(b: Block, idx: number): string {
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

/** 화질 보정을 켠 이미지는 보정본으로 — 초안에서 교사가 보는 그대로다. */
function srcOf(im: ImageObj): string {
  return im.sharpened && im.sharpSrc ? im.sharpSrc : im.src;
}

/** 합성 캔버스의 최대 변 길이(px) — 화질과 요청 크기의 균형점 */
const CELL_MAX_SIDE = 2600;

/**
 * 한 칸에 붙은 조각들을 흰 캔버스 위에 **초안 배치 그대로** 합성한다.
 * 교사가 한 칸에 붙였다는 건 "이게 한 덩어리"라는 뜻이다 — 조각을 따로따로
 * 보여 주면 문제가 토막나므로, 그 칸을 통째로 찍은 것처럼 한 장으로 만든다.
 */
async function compositeCell(imgs: ImageObj[], blockId: number): Promise<string> {
  const loaded = await Promise.all(imgs.map(async (im) => ({ im, el: await loadImage(srcOf(im)) })));

  // 배치는 칸 폭 비율(x, w)과 칸 높이 비율(y)이다. 실제 칸의 치수로 편다.
  const layer = document.querySelector<HTMLElement>(`.block[data-id="${blockId}"] .img-layer`);
  const pw = layer?.clientWidth || 1000;
  const ph = layer?.clientHeight || pw;

  const boxes = loaded.map(({ im, el }) => {
    const w = Math.max(1, im.w * pw);
    const h = w * (im.ar || el.naturalHeight / Math.max(1, el.naturalWidth));
    return { el, x: im.x * pw, y: im.y * ph, w, h };
  });
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));

  const pad = 12;
  const cw = Math.max(1, maxX - minX + pad * 2);
  const ch = Math.max(1, maxY - minY + pad * 2);

  // 화면 치수 그대로 그리면 원본보다 작아져 글씨가 뭉갠다 — 가장 촘촘한
  // 조각이 원본 해상도를 지키는 배율로 키우되, 캔버스가 너무 커지지 않게 막는다.
  let scale = 1;
  for (const b of boxes) scale = Math.max(scale, b.el.naturalWidth / b.w);
  scale = Math.min(scale, 3, CELL_MAX_SIDE / Math.max(cw, ch));
  scale = Math.max(scale, 0.2);

  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(cw * scale));
  c.height = Math.max(1, Math.round(ch * scale));
  const g = c.getContext('2d');
  if (!g) return srcOf(imgs[0]);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = 'high';
  for (const b of boxes) {
    g.drawImage(b.el, (b.x - minX + pad) * scale, (b.y - minY + pad) * scale, b.w * scale, b.h * scale);
  }
  return c.toDataURL('image/png');
}

/**
 * 초안을 훑어 캡처 단위를 만든다 — 칸 하나가 캡처 하나다. 이미지가 없는 칸은
 * AI를 부르지 않는다. 교사가 직접 친 글은 이미 정확하므로 그대로 옮긴다.
 */
export async function collectCaptures(
  state: AppState,
): Promise<{ units: CaptureUnit[]; textOnly: CaptureResult[] }> {
  const units: CaptureUnit[] = [];
  const textOnly: CaptureResult[] = [];

  for (const [idx, b] of state.blocks.entries()) {
    const imgs = blockImages(b);
    const text = blockText(b);
    const lines = answerLinesOf(b);
    const tag = tagOf(b, idx);

    if (!imgs.length) {
      if (!text) continue;
      const unit: CaptureUnit = {
        id: `${b.id}:text`,
        blockId: b.id,
        src: '',
        contextText: text,
        answerLines: lines,
        tagLabel: tag,
        blockType: b.type,
      };
      textOnly.push({ unit, items: itemsFromText(b, text, lines), failed: false });
      continue;
    }

    // 한 칸의 조각들은 전부 한 장으로 합친다 — 칸이 곧 문제 단위다.
    // 조각을 따로 보내면 이어지는 지문이 토막나 딴 문제로 읽히기 때문에,
    // 초안 배치 그대로 합성한 "칸 스냅숏" 하나만 모델에게 보여 준다.
    const src = imgs.length > 1 ? await compositeCell(imgs, b.id) : srcOf(imgs[0]);
    units.push({
      id: `${b.id}:cell`,
      blockId: b.id,
      src,
      contextText: text,
      answerLines: lines,
      tagLabel: tag,
      blockType: b.type,
    });
  }

  return { units, textOnly };
}

/** 교사가 친 글만 있는 칸 — AI 없이 바로 아이템으로 만든다 */
function itemsFromText(b: Block, text: string, lines: number): WorksheetItem[] {
  if (b.type === 'concept') {
    return [{ kind: 'concept', title: b.title || undefined, body: [{ t: 'text', s: text }] }];
  }
  return [
    {
      kind: 'problem',
      stem: [{ t: 'text', s: text }],
      answerLines: lines,
    },
  ];
}

export const EXTRACT_SYSTEM = `당신은 교과서 캡처 이미지를 학습지로 옮겨 적는 편집자다.

이미지는 학습지 한 칸을 통째로 찍은 것이다. 교사가 여러 캡처 조각을 이어 붙여
만든 칸일 수 있다 — 조각 경계는 무시하고, 배치 순서(위→아래, 왼쪽→오른쪽)대로
읽어 **이어지는 글은 한 문제로 합쳐** 전사한다. 조각 하나를 문제 하나로 착각하지 마라.

절대 규칙
- 이미지에 보이는 글을 **그대로 전사**한다. 요약·의역·문제 창작·정답 추가는 절대 금지다.
- 확신이 서지 않는 어절도 보이는 대로 적고, 그 어절을 uncertain 배열에 넣는다.
- 수식은 {"t":"math","latex":"..."} 런으로, 나머지 글은 {"t":"text","s":"..."} 런으로 쓴다.
- **그림·그래프·표는 글로 옮기지 않는다.** 대신 그 영역을 figures 의 bbox 로만 알려 준다.
  bbox 는 [x, y, w, h] 이고 이미지 크기 대비 0~1 비율이다.
- ①②③④⑤ 같은 선택지는 choices 로, (1) (2) 같은 소문항은 subqs 로 분리한다.
- 캡처에 문제가 여러 개면 items 를 여러 개로 나눈다.
- 문제 본문 없이 그림뿐이면 [{"kind":"image"}] 하나만 돌려준다.
- 머리말·쪽번호·출처 표시 같은 교과서 부속물은 옮기지 않는다.

출력은 아래 모양의 JSON 객체 하나뿐이다. 설명이나 코드펜스를 붙이지 마라.
{"items":[
  {"kind":"problem","no":"12","stem":[런...],"choices":[[런...],...],
   "subqs":[[런...],...],"figures":[{"bbox":[0,0,1,1],"caption":"..."}],
   "answerLines":4,"uncertain":["..."],"tagLabel":"서술형"},
  {"kind":"concept","title":"...","body":[런...]},
  {"kind":"image"}
]}`;

function userPrompt(unit: CaptureUnit): string {
  const ctx = unit.contextText
    ? `\n\n참고 — 교사가 이 칸에 직접 적어 둔 글(전사 대상 아님, 문맥용):\n${unit.contextText}`
    : '';
  return `학습지 한 칸을 통째로 찍은 캡처입니다. 배치 순서대로 읽어 문제 단위로 전사하세요. 풀이칸은 약 ${unit.answerLines}줄로 잡습니다.${ctx}`;
}

/** 캡처 한 장을 전사한다. 실패하면 이미지 폴백을 돌려준다. */
export async function extractOne(
  settings: AiSettings,
  unit: CaptureUnit,
  signal?: AbortSignal,
): Promise<CaptureResult> {
  const fallback = (error: string): CaptureResult => ({
    unit,
    items: [{ kind: 'image', from: unit.id }],
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
    const items = validateItems(raw, unit.id, unit.answerLines);
    if (!items) return fallback('전사 내용이 비었거나 형식이 어긋납니다. 이미지로 넣었습니다.');
    return { unit, items, failed: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fallback(`전사에 실패했습니다 — ${msg}`);
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
