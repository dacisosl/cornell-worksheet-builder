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

const CURATED_CACHE_KEY = 'cornell-ai-curated-v1';
const CURATED_TTL_MS = 24 * 60 * 60 * 1000;

interface OpenRouterModel {
  id?: string;
  name?: string;
  created?: number;
  pricing?: { prompt?: string; completion?: string };
}

/** 이름에 이런 말이 들어간 변형은 학습지 저작용 추천에서 뺀다 */
const EXCLUDE = /(:free|:extended|-fast|realtime|audio|image|search|distill|exp)/i;

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
        !!m.id && !EXCLUDE.test(m.id),
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
    return {
      provider: p.provider === 'gemini' ? 'gemini' : 'openrouter',
      keys: { ...base.keys, ...(p.keys ?? {}) },
      models: { ...base.models, ...(p.models ?? {}) },
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

/** 응답 본문에서 읽을 만한 오류 메시지를 뽑아낸다. */
async function errorText(res: Response): Promise<string> {
  let detail = '';
  try {
    const body = (await res.json()) as { error?: { message?: string } | string };
    const e = body.error;
    detail = typeof e === 'string' ? e : (e?.message ?? '');
  } catch {
    /* JSON이 아니면 상태코드만 */
  }
  return `${res.status} ${res.statusText}${detail ? ' — ' + detail : ''}`;
}

/** 제공자가 지원하는 모델 목록 (설정 화면의 '모델 불러오기') */
export async function listModels(provider: Provider, key: string): Promise<string[]> {
  if (provider === 'openrouter') {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    if (!res.ok) throw new Error(await errorText(res));
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
  if (!res.ok) throw new Error(await errorText(res));
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
    if (!res.ok) throw new Error(await errorText(res));
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
  if (!res.ok) throw new Error(await errorText(res));
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
