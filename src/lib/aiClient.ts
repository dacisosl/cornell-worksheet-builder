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
  openrouter: 'google/gemini-2.5-flash',
  gemini: 'gemini-2.5-flash',
};

export interface CuratedModel {
  id: string;
  label: string;
  note: string;
}

/**
 * 바로 고를 수 있는 추천 모델.
 * 목록은 참고용 — '전체 모델 불러오기'로 제공자의 실시간 목록을 받아 고를 수도 있다.
 */
export const CURATED_MODELS: Record<Provider, CuratedModel[]> = {
  openrouter: [
    { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', note: '빠르고 저렴 — 기본값' },
    { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', note: '구글 고성능' },
    { id: 'google/gemini-3-pro-preview', label: 'Gemini 3 Pro', note: '구글 최신 고성능' },
    { id: 'openai/gpt-4o', label: 'GPT-4o', note: '오픈AI 범용' },
    { id: 'openai/gpt-5.1', label: 'GPT-5.1', note: '오픈AI 고성능' },
    { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5', note: '앤트로픽 균형형' },
    { id: 'anthropic/claude-opus-4.5', label: 'Claude Opus 4.5', note: '앤트로픽 고성능 — 비쌈' },
  ],
  gemini: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', note: '빠르고 저렴 — 기본값' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', note: '고성능' },
    { id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro', note: '최신 고성능' },
  ],
};

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
  signal?: AbortSignal;
}

/** 고른 제공자에게 한 번 물어보고 텍스트를 받는다. */
export async function complete(s: AiSettings, opts: CompleteOpts): Promise<string> {
  const key = activeKey(s);
  const model = activeModel(s);
  if (!key) throw new Error(`${PROVIDER_LABEL[s.provider]} API 키를 먼저 입력하세요.`);

  if (s.provider === 'openrouter') {
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
          { role: 'user', content: opts.user },
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
        contents: [{ role: 'user', parts: [{ text: opts.user }] }],
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
