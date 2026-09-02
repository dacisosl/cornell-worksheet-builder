/**
 * AI 제공자 클라이언트 — OpenRouter · Google Gemini 두 가지를 모두 지원한다.
 * 키는 이 브라우저(localStorage)에만 두고, 호출은 사용자가 고른 제공자에게만 나간다.
 */

export type Provider = 'openrouter' | 'gemini';

export interface AiSettings {
  provider: Provider;
  keys: Record<Provider, string>;
  models: Record<Provider, string>;
}

export const AI_KEY = 'cornell-ai-settings';

export const PROVIDER_LABEL: Record<Provider, string> = {
  openrouter: 'OpenRouter',
  gemini: 'Google Gemini',
};

/** 키를 발급받는 곳 — 설정 화면에서 안내한다. */
export const PROVIDER_KEY_URL: Record<Provider, string> = {
  openrouter: 'https://openrouter.ai/keys',
  gemini: 'https://aistudio.google.com/apikey',
};

const DEFAULT_MODELS: Record<Provider, string> = {
  openrouter: 'google/gemini-3.7-flash',
  gemini: 'gemini-3.7-flash',
};

export interface CuratedModel {
  id: string;
  label: string;
  note: string;
}

/**
 * 바로 고를 수 있는 추천 모델 — 2026-08 기준 확인본.
 * OpenRouter 쪽은 패널을 열 때 실시간 목록으로 자동 갱신되므로 (fetchLatestCurated)
 * 이 정적 목록은 네트워크가 안 될 때의 폴백이다.
 */
export const CURATED_MODELS: Record<Provider, CuratedModel[]> = {
  openrouter: [
    { id: 'google/gemini-3.7-flash', label: 'Gemini 3.7 Flash', note: '빠르고 저렴 — 기본 추천' },
    { id: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', note: '구글 고성능' },
    { id: 'openai/gpt-5.2', label: 'GPT-5.2', note: '오픈AI 고성능' },
    { id: 'openai/gpt-5.5', label: 'GPT-5.5', note: '오픈AI 최신 최상위' },
    { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', note: '앤트로픽 균형형' },
    { id: 'anthropic/claude-opus-5', label: 'Claude Opus 5', note: '앤트로픽 최상위 — 비쌈' },
    { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', note: '가장 저렴한 구형' },
  ],
  gemini: [
    { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', note: '최신 — 빠르고 저렴' },
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', note: '한 세대 전' },
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', note: '고성능' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', note: '구형 — 저렴' },
  ],
};

// v2: 배치 전용·비전 미지원 모델이 섞여 있던 캐시를 버린다.
const CURATED_CACHE_KEY = 'cornell-ai-curated-v2';
const CURATED_TTL_MS = 24 * 60 * 60 * 1000;

interface OpenRouterModel {
  id?: string;
  name?: string;
  created?: number;
  pricing?: { prompt?: string; completion?: string };
  /** 최신 형식: input_modalities, 구형: modality('text+image->text') */
  architecture?: { input_modalities?: string[]; modality?: string };
}

/**
 * 이름에 이런 말이 들어간 변형은 학습지 저작용 추천에서 뺀다.
 * batch/async 는 일반 호출이 막혀 있어(대량처리 전용) 부르면 404가 난다.
 */
const EXCLUDE = /(:free|:extended|-fast|realtime|audio|image|search|distill|exp|batch|async)/i;

/** 캡처를 읽어야 하므로 그림을 볼 수 있는 모델만 추천한다 */
function seesImages(m: OpenRouterModel): boolean {
  const mods = m.architecture?.input_modalities;
  if (Array.isArray(mods)) return mods.includes('image');
  const legacy = m.architecture?.modality;
  // 정보가 없으면 막지 않는다 — 목록이 통째로 비는 것보다 낫다.
  return typeof legacy === 'string' ? legacy.includes('image') : true;
}

/**
 * OpenRouter 공개 목록에서 주요 3사(구글·오픈AI·앤트로픽)의 **최신 모델**을 뽑아
 * 추천 목록을 만든다. 실패하면 null — 정적 CURATED_MODELS 를 그대로 쓴다.
 * 하루 캐시해서 패널을 열 때마다 다시 받지 않는다.
 */
export async function fetchLatestCurated(): Promise<CuratedModel[] | null> {
  try {
    const cached = localStorage.getItem(CURATED_CACHE_KEY);
    if (cached) {
      const { at, list } = JSON.parse(cached) as { at: number; list: CuratedModel[] };
      if (Date.now() - at < CURATED_TTL_MS && Array.isArray(list) && list.length) return list;
    }
  } catch {
    /* 캐시 파손 — 새로 받는다 */
  }

  try {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: OpenRouterModel[] };
    const models = (body.data ?? []).filter(
      (m): m is Required<Pick<OpenRouterModel, 'id'>> & OpenRouterModel =>
        !!m.id && !EXCLUDE.test(m.id) && seesImages(m),
    );

    const families: { prefix: string; take: number; note: string }[] = [
      { prefix: 'google/gemini', take: 2, note: '구글' },
      { prefix: 'openai/gpt', take: 2, note: '오픈AI' },
      { prefix: 'anthropic/claude', take: 2, note: '앤트로픽' },
    ];

    const list: CuratedModel[] = [];
    for (const f of families) {
      const hits = models
        .filter((m) => m.id.startsWith(f.prefix))
        .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
        .slice(0, f.take);
      hits.forEach((m) => {
        const out = Number(m.pricing?.completion ?? 0) * 1e6;
        const price = out > 0 ? ` · 출력 $${out < 10 ? out.toFixed(2) : Math.round(out)}/1M` : '';
        list.push({
          id: m.id,
          label: (m.name ?? m.id).replace(/^.*?:\s*/, ''),
          note: `${f.note} 최신${price}`,
        });
      });
    }
    if (!list.length) return null;
    try {
      localStorage.setItem(CURATED_CACHE_KEY, JSON.stringify({ at: Date.now(), list }));
    } catch {
      /* 저장 실패는 무시 */
    }
    return list;
  } catch {
    return null;
  }
}

export function defaultSettings(): AiSettings {
  return {
    provider: 'openrouter',
    keys: { openrouter: '', gemini: '' },
    models: { ...DEFAULT_MODELS },
  };
}

export function loadSettings(): AiSettings {
  const base = defaultSettings();
  try {
    const raw = localStorage.getItem(AI_KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<AiSettings>;
    const models = { ...base.models, ...(p.models ?? {}) };
    // 대량처리 전용 모델이 골라져 있으면 부를 때마다 404가 난다 — 기본으로 되돌린다.
    for (const k of Object.keys(models) as Provider[]) {
      if (/batch|async/i.test(models[k])) models[k] = DEFAULT_MODELS[k];
    }
    return {
      provider: p.provider === 'gemini' ? 'gemini' : 'openrouter',
      keys: { ...base.keys, ...(p.keys ?? {}) },
      models,
    };
  } catch {
    return base;
  }
}

export function saveSettings(s: AiSettings): void {
  try {
    localStorage.setItem(AI_KEY, JSON.stringify(s));
  } catch {
    /* 저장 공간 부족 — 이번 세션에서만 쓴다 */
  }
}

export function activeKey(s: AiSettings): string {
  return (s.keys[s.provider] || '').trim();
}

export function activeModel(s: AiSettings): string {
  return (s.models[s.provider] || DEFAULT_MODELS[s.provider]).trim();
}

/**
 * 모델·키 자체가 문제라 **다시 시도해도 똑같이 실패하는** 오류.
 * 캡처마다 되풀이해 부르지 않고 한 번에 멈추라는 신호다.
 */
export class ModelError extends Error {
  readonly detail: string;
  constructor(message: string, detail: string) {
    super(message);
    this.name = 'ModelError';
    this.detail = detail;
  }
}

/** 제공자 오류를 교사가 바로 알아듣는 한국어 안내로 옮긴다 */
function explain(status: number, detail: string): { message: string; fatal: boolean } {
  const d = detail.toLowerCase();
  if (d.includes('batch')) {
    return {
      message: '이 모델은 대량처리(Batch) 전용이라 학습지 전사에 쓸 수 없습니다. 다른 모델을 골라 주세요.',
      fatal: true,
    };
  }
  if (status === 404 || d.includes('no endpoints') || d.includes('not found')) {
    return { message: '고른 모델을 찾을 수 없습니다. 모델 목록에서 다른 모델을 골라 주세요.', fatal: true };
  }
  if (status === 401 || status === 403) {
    return { message: 'API 키가 거부됐습니다. 키를 다시 확인해 주세요.', fatal: true };
  }
  if (status === 402 || d.includes('credit') || d.includes('quota') || d.includes('billing')) {
    return { message: '제공자 잔액·사용량 한도에 걸렸습니다. 결제 상태를 확인해 주세요.', fatal: true };
  }
  if (d.includes('image') && (d.includes('support') || d.includes('modality'))) {
    return { message: '이 모델은 그림을 읽지 못합니다. 이미지를 볼 수 있는 모델을 골라 주세요.', fatal: true };
  }
  if (status === 429) {
    return { message: '요청이 너무 잦습니다. 잠시 뒤 다시 시도해 주세요.', fatal: false };
  }
  return { message: `요청이 거부됐습니다 (${status}).`, fatal: false };
}

/** 응답 본문에서 읽을 만한 오류 메시지를 뽑아 알맞은 오류로 만든다. */
async function errorOf(res: Response): Promise<Error> {
  let detail = '';
  try {
    const body = (await res.json()) as { error?: { message?: string } | string };
    const e = body.error;
    detail = typeof e === 'string' ? e : (e?.message ?? '');
  } catch {
    /* JSON이 아니면 상태코드만 */
  }
  const { message, fatal } = explain(res.status, detail);
  const full = detail ? `${message} (${detail})` : message;
  return fatal ? new ModelError(message, detail) : new Error(full);
}

/** 제공자가 지원하는 모델 목록 (설정 화면의 '모델 불러오기') */
export async function listModels(provider: Provider, key: string): Promise<string[]> {
  if (provider === 'openrouter') {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    if (!res.ok) throw await errorOf(res);
    const body = (await res.json()) as { data?: { id?: string }[] };
    return (body.data ?? [])
      .map((m) => m.id ?? '')
      .filter(Boolean)
      .sort();
  }

  if (!key) throw new Error('Gemini 모델 목록을 보려면 API 키가 필요합니다.');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
  );
  if (!res.ok) throw await errorOf(res);
  const body = (await res.json()) as {
    models?: { name?: string; supportedGenerationMethods?: string[] }[];
  };
  return (body.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => (m.name ?? '').replace(/^models\//, ''))
    .filter(Boolean)
    .sort();
}

export interface CompleteOpts {
  system: string;
  user: string;
  /** 모델에게 JSON만 내놓으라고 요구할지 */
  json?: boolean;
  /** 함께 보여줄 이미지 (dataURL) — 모델이 보고 답한다 */
  images?: string[];
  signal?: AbortSignal;
}

/** dataURL 을 `data:image/png;base64,....` → mime + base64 로 가른다. */
function splitDataURL(url: string): { mime: string; data: string } | null {
  const m = /^data:([^;,]+)(?:;[^,]*)*;base64,(.+)$/s.exec(url);
  return m ? { mime: m[1], data: m[2] } : null;
}

/** 고른 제공자에게 한 번 물어보고 텍스트를 받는다. */
export async function complete(s: AiSettings, opts: CompleteOpts): Promise<string> {
  const key = activeKey(s);
  const model = activeModel(s);
  if (!key) throw new Error(`${PROVIDER_LABEL[s.provider]} API 키를 먼저 입력하세요.`);

  const images = (opts.images ?? []).filter(Boolean);

  if (s.provider === 'openrouter') {
    const userContent = images.length
      ? [
          { type: 'text', text: opts.user },
          ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
        ]
      : opts.user;
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: opts.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'X-Title': 'Cornell Worksheet Builder',
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: userContent },
        ],
      }),
    });
    if (!res.ok) throw await errorOf(res);
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };
    if (body.error?.message) throw new Error(body.error.message);
    const text = body.choices?.[0]?.message?.content ?? '';
    if (!text) throw new Error('모델이 빈 응답을 보냈습니다. 다른 모델로 시도해 보세요.');
    return text;
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      signal: opts.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [
          {
            role: 'user',
            parts: [
              { text: opts.user },
              ...images
                .map(splitDataURL)
                .filter((p): p is { mime: string; data: string } => !!p)
                .map((p) => ({ inlineData: { mimeType: p.mime, data: p.data } })),
            ],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          ...(opts.json ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    },
  );
  if (!res.ok) throw await errorOf(res);
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };
  if (body.promptFeedback?.blockReason) {
    throw new Error(`요청이 차단되었습니다 (${body.promptFeedback.blockReason}).`);
  }
  const text = (body.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  if (!text) throw new Error('모델이 빈 응답을 보냈습니다. 다른 모델로 시도해 보세요.');
  return text;
}

/** 모델이 코드펜스나 잡담을 섞어 보내도 JSON 객체만 꺼낸다. */
export function parseJsonLoose<T>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  const slice = start >= 0 && end > start ? body.slice(start, end + 1) : body;
  return JSON.parse(slice) as T;
}
