/**
 * 완성하기 스튜디오 — 캡처를 붙여 만든 초안을 "소장하고 싶은 완성본"으로 편집한다.
 *
 * 빌더 상태는 읽기만 한다. 결과는 완전히 별개의 문서라 초안은 손대지 않는다.
 * 한 번 만든 문서는 브라우저에 남겨 두고, 초안이 그대로면 토큰을 한 톨도 쓰지 않고
 * 바로 다시 연다.
 *
 * 창을 접어도 작업은 계속된다. 전사는 몇 분씩 걸릴 수 있어서, 접어 둔 채 초안을
 * 계속 손보다가 다 되면 알림 알약을 눌러 돌아오면 된다.
 */

import {
  activeKey,
  CURATED_MODELS,
  fetchLatestCurated,
  listModels,
  loadSettings,
  PROVIDER_KEY_URL,
  PROVIDER_LABEL,
  saveSettings,
  type AiSettings,
  type CuratedModel,
  type Provider,
} from '../lib/aiClient';
import type { AppState } from '../types';
import { el } from '../utils/dom';
import { collectCaptures, extractAll, extractOne, type CaptureResult, type CaptureUnit } from './extract';
import { fillFigures } from './figures';
import { readLayout } from './layout';
import type { FigureRef, PolishedDoc, WorksheetItem } from './schema';
import { SAMPLE_DOC } from './sampleDoc';
import { renderDocument } from './typeset';
import { THEME_ORDER, THEMES, isThemeName, type ThemeName } from './themes';

import './studio.css';

// v2: 캡처 단위가 이미지별에서 칸별로 바뀌어 v1 저장본의 도판 출처가 맞지 않는다.
const STORE_KEY = 'cornell-studio-v2';

export interface StudioContext {
  state: AppState;
  safeTitle: () => string;
  dateStamp: () => string;
}

interface Saved {
  draftHash: string;
  doc: PolishedDoc;
  overrides: Record<string, string>;
  theme: ThemeName;
  savedAt: string;
}

/** 초안이 그대로인지 알아보는 지문 — 캡처와 글이 바뀌면 값이 달라진다. */
function draftHash(state: AppState): string {
  const parts: string[] = [state.meta.title];
  for (const b of state.blocks) {
    parts.push(`${b.id}:${b.type}:${b.title}`);
    if ('imgs' in b) for (const im of b.imgs) parts.push(`${im.id}:${im.src.length}:${im.src.slice(-24)}`);
    for (const k of ['probHtml', 'solHtml', 'exHtml', 'imgHtml', 'html'] as const) {
      const v = (b as unknown as Record<string, unknown>)[k];
      if (typeof v === 'string') parts.push(v);
    }
  }
  const s = parts.join('|');
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${h.toString(36)}.${s.length.toString(36)}`;
}

function allFigures(doc: PolishedDoc): FigureRef[] {
  const out: FigureRef[] = [];
  for (const sec of doc.sections) {
    for (const item of sec.items) {
      if (item.kind === 'problem' || item.kind === 'concept') out.push(...(item.figures ?? []));
    }
  }
  return out;
}

/** 저장할 때는 도판 dataURL을 뺀다 — 열 때 1초 안에 다시 만들 수 있고, 용량이 크다. */
function stripSrc(doc: PolishedDoc): PolishedDoc {
  const copy = JSON.parse(JSON.stringify(doc)) as PolishedDoc;
  for (const f of allFigures(copy)) delete f.src;
  for (const sec of copy.sections) {
    for (const item of sec.items) if (item.kind === 'image') delete item.src;
  }
  return copy;
}

interface Session {
  show: () => void;
  hide: () => void;
}

/** 열려 있던(또는 접어 둔) 스튜디오. 두 번째로 눌러도 하던 작업을 이어 간다. */
let session: Session | null = null;

export default function openStudio(ctx: StudioContext): void {
  if (session) {
    session.show();
    return;
  }
  session = createSession(ctx);
  session.show();
}

function createSession(ctx: StudioContext): Session {
  const settings: AiSettings = loadSettings();
  let theme: ThemeName = 'riso';
  let doc: PolishedDoc | null = null;
  let overrides: Record<string, string> = {};
  let captureSrc = new Map<string, string>();
  let failures: CaptureResult[] = [];
  let running = false;
  let abort: AbortController | null = null;
  let progress = { done: 0, total: 0, label: '' };
  /** 지금 미리보기에 띄운 것이 내 완성본이 아니라 테마 예시인지 */
  let showingSample = false;
  /** 미리보기 배율 — 기본은 A4 한 쪽이 통째로 들어오는 '맞춤' */
  let zoom: 'fit' | number = 'fit';

  /* ── 뼈대 ─────────────────────────────────────────────── */

  const frame = el('iframe', { title: '완성본 미리보기' });
  /* 예시임을 못 알아볼 수 없게 — 문서는 또렷하게 두고 은은한 워터마크만 겹친다 */
  const mark = el('div', { class: 'st-mark', 'aria-hidden': 'true' });
  for (let i = 0; i < 15; i += 1) mark.appendChild(el('span', { text: '예시 SAMPLE' }));
  /* 배율은 여기서 건다 — iframe 자체는 늘 A4 실치수(210×297mm)다 */
  const stage = el('div', { class: 'st-stage' }, [frame, mark]);
  const view = el('div', { class: 'st-view' });
  const empty = el('div', {
    class: 'st-empty',
    html:
      '<b>완성본이 아직 없습니다</b>왼쪽에서 API 키와 모델을 고르고 <b style="display:inline;font-size:inherit">완성본 만들기</b>를 누르세요.<br>' +
      '초안에 붙인 교과서 캡처를 읽어 글은 다시 조판하고, 그림은 잘라서 배치합니다.<br>' +
      '위 디자인 이름을 눌러 보면 각 형식의 예시 학습지를 미리 볼 수 있습니다.',
  });
  view.appendChild(empty);

  const sampleBadge = el('div', {
    class: 'st-badge',
    text: '예시 — 완성본을 만들면 내 학습지 내용으로 바뀝니다',
  });
  sampleBadge.style.display = 'none';

  const progressBox = el('div', { class: 'st-progress' });
  progressBox.style.display = 'none';

  const rail = el('aside', { class: 'st-rail' });
  const themeBar = el('div', { class: 'st-themes' });
  const zoomSel = el('select', {
    class: 'st-zoom',
    title: '미리보기 배율',
    onchange: () => {
      zoom = zoomSel.value === 'fit' ? 'fit' : Number(zoomSel.value);
      applyZoom();
    },
  }) as HTMLSelectElement;
  for (const [v, label] of [['fit', '한 쪽 맞춤'], ['1', '100%'], ['1.25', '125%'], ['1.5', '150%']]) {
    zoomSel.appendChild(el('option', { value: v, text: label }));
  }

  const printBtn = el('button', { class: 'st-btn', text: '인쇄 / PDF', onclick: doPrint });
  const saveBtn = el('button', { class: 'st-btn', text: 'HTML 저장', onclick: doSaveHtml });
  const minBtn = el('button', {
    class: 'st-btn',
    text: '최소화',
    title: '창만 접습니다. 만들던 작업은 계속 돌아갑니다.',
    onclick: hide,
  });
  const closeBtn = el('button', { class: 'st-btn', text: '닫기', onclick: close });

  const shell = el('div', { class: 'st-shell' }, [
    rail,
    el('div', { class: 'st-main' }, [
      el('div', { class: 'st-top' }, [
        themeBar,
        el('div', { class: 'st-actions' }, [zoomSel, printBtn, saveBtn, minBtn, closeBtn]),
      ]),
      view,
    ]),
  ]);
  const overlay = el('div', { class: 'st-overlay' }, shell);
  document.body.appendChild(overlay);

  /** 접어 둔 동안 상태를 알려 주는 알약 — 누르면 다시 펼친다. */
  const pill = el('button', { class: 'st-pill', onclick: show });
  document.body.appendChild(pill);

  function show(): void {
    overlay.style.display = '';
    pill.style.display = 'none';
    document.addEventListener('keydown', onKey);
    applyZoom();
  }

  function hide(): void {
    overlay.style.display = 'none';
    document.removeEventListener('keydown', onKey);
    syncPill();
  }

  /** 닫기 = 이 작업을 버린다. 돌아가는 중이면 접기만 해서 하던 일을 지키다. */
  function close(): void {
    if (running) {
      hide();
      return;
    }
    overlay.remove();
    pill.remove();
    document.removeEventListener('keydown', onKey);
    session = null;
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') hide();
  }

  function syncPill(): void {
    if (overlay.style.display !== 'none') {
      pill.style.display = 'none';
      return;
    }
    if (!running && !doc) {
      pill.style.display = 'none';
      return;
    }
    // CSS 기본값이 none 이므로 빈 문자열로 되돌리면 안 보인다.
    pill.style.display = 'block';
    pill.classList.toggle('busy', running);
    pill.textContent = running ? progress.label : '완성본 준비됨 — 열기';
  }

  /* ── 설정 레일 ────────────────────────────────────────── */

  const providerSel = el('select', {
    onchange: () => {
      settings.provider = providerSel.value as Provider;
      saveSettings(settings);
      syncProvider();
    },
  }) as HTMLSelectElement;
  for (const p of ['openrouter', 'gemini'] as Provider[]) {
    providerSel.appendChild(el('option', { value: p, text: PROVIDER_LABEL[p] }));
  }

  const keyInput = el('input', {
    type: 'password',
    placeholder: 'sk-...',
    oninput: () => {
      settings.keys[settings.provider] = keyInput.value.trim();
      saveSettings(settings);
      syncRun();
    },
  }) as HTMLInputElement;

  const keyLink = el('a', { class: 'st-link', target: '_blank', rel: 'noopener', text: '키 발급받기 ↗' }) as HTMLAnchorElement;

  const modelSel = el('select', {
    onchange: () => {
      settings.models[settings.provider] = modelSel.value;
      saveSettings(settings);
    },
  }) as HTMLSelectElement;

  const loadModelsBtn = el('button', {
    class: 'st-btn',
    text: '전체',
    title: '제공자가 가진 모든 모델을 불러옵니다',
    onclick: async () => {
      loadModelsBtn.disabled = true;
      loadModelsBtn.textContent = '…';
      try {
        const ids = await listModels(settings.provider, activeKey(settings));
        fillModels(ids.map((id) => ({ id, label: id, note: '' })));
      } catch (e) {
        note(e instanceof Error ? e.message : String(e));
      } finally {
        loadModelsBtn.disabled = false;
        loadModelsBtn.textContent = '전체';
      }
    },
  }) as HTMLButtonElement;

  function fillModels(list: CuratedModel[]): void {
    const chosen = settings.models[settings.provider];
    modelSel.textContent = '';
    for (const m of list) {
      modelSel.appendChild(
        el('option', { value: m.id, text: m.note ? `${m.label} — ${m.note}` : m.label }),
      );
    }
    if (chosen && !list.some((m) => m.id === chosen)) {
      modelSel.appendChild(el('option', { value: chosen, text: `${chosen} (직접 지정)` }));
    }
    modelSel.value = chosen;
  }

  const runBtn = el('button', {
    class: 'st-btn primary wide',
    text: '완성본 만들기',
    onclick: () => void run(),
  }) as HTMLButtonElement;

  const stopBtn = el('button', {
    class: 'st-btn wide',
    text: '중지',
    title: '만들기를 멈춥니다. 이미 만들어 둔 완성본이 있으면 그대로 남습니다.',
    onclick: () => {
      if (!abort) return;
      stopBtn.disabled = true;
      stopBtn.textContent = '멈추는 중…';
      abort.abort();
    },
  }) as HTMLButtonElement;
  stopBtn.style.display = 'none';

  const noteLine = el('p', { class: 'hint' });
  function note(msg: string): void {
    noteLine.textContent = msg;
  }

  rail.append(
    el('h2', { text: '완성하기 스튜디오' }),
    el('p', {
      class: 'hint',
      text: '초안의 교과서 캡처를 읽어, 글은 어절 단위로 다시 조판하고 그림은 잘라 배치합니다. 초안은 그대로 둡니다.',
    }),
    el('div', { class: 'st-group' }, [el('label', { text: 'AI 제공자' }), providerSel]),
    el('div', { class: 'st-group' }, [el('label', { text: 'API 키' }), keyInput, keyLink]),
    el('div', { class: 'st-group' }, [
      el('label', { text: '모델' }),
      el('div', { class: 'st-row' }, [modelSel, loadModelsBtn]),
      runBtn,
      stopBtn,
      noteLine,
    ]),
    progressBox,
  );

  function syncProvider(): void {
    providerSel.value = settings.provider;
    keyInput.value = settings.keys[settings.provider] ?? '';
    keyLink.href = PROVIDER_KEY_URL[settings.provider];
    fillModels(CURATED_MODELS[settings.provider]);
    syncRun();
  }
  function syncRun(): void {
    runBtn.disabled = running || !activeKey(settings);
    runBtn.textContent = running ? '만드는 중…' : doc ? '다시 만들기' : '완성본 만들기';
    stopBtn.style.display = running ? '' : 'none';
    if (!running) {
      stopBtn.disabled = false;
      stopBtn.textContent = '중지';
    }
    printBtn.disabled = !doc || showingSample;
    saveBtn.disabled = !doc || showingSample;
    closeBtn.textContent = running ? '접어 두기' : '닫기';
    syncPill();
  }
  syncProvider();

  // 추천 목록은 열어 둔 채로 최신 것이 오면 조용히 갈아 끼운다.
  if (settings.provider === 'openrouter') {
    void fetchLatestCurated().then((list) => {
      if (list && settings.provider === 'openrouter') fillModels(list);
    });
  }

  /* ── 테마 탭 ──────────────────────────────────────────── */

  for (const name of THEME_ORDER) {
    const t = THEMES[name];
    themeBar.appendChild(
      el(
        'button',
        {
          class: 'st-theme',
          'aria-pressed': String(name === theme),
          data: { theme: name },
          onclick: () => setTheme(name),
        },
        [
          el('span', { class: 'st-theme-name', text: t.label }),
          // 이름만 보고는 어떤 디자인인지 모른다 — 올려 두면 실물 한 장이 뜬다.
          el('span', { class: 'st-peek' }, [
            el('img', { src: `${import.meta.env.BASE_URL}samples/thumb-${name}.jpg`, alt: '', loading: 'lazy' }),
            el('b', { text: t.label }),
            el('i', { text: t.blurb }),
          ]),
        ],
      ),
    );
  }

  function markTheme(name: ThemeName): void {
    for (const b of themeBar.children) {
      b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.theme === name));
    }
  }

  function setTheme(name: ThemeName): void {
    if (doc) harvestEdits();
    theme = name;
    markTheme(name);
    if (doc) {
      persist();
      preview();
    } else {
      // 아직 만들기 전이라면 이 형식의 예시 학습지를 펼쳐 보여 준다.
      previewSample();
    }
  }

  /** 완성본이 없을 때 고른 형식의 예시 한 장을 미리보기에 띄운다 */
  function previewSample(): void {
    render(SAMPLE_DOC, true);
  }

  /* ── 실행 ─────────────────────────────────────────────── */

  function setProgress(done: number, total: number, label: string): void {
    progress = { done, total, label };
    syncPill();
    progressBox.style.display = '';
    progressBox.textContent = '';
    progressBox.append(
      el('div', { text: label }),
      el('div', { class: 'st-bar' }, el('i', { style: `width:${total ? (done / total) * 100 : 0}%` })),
    );
    for (const f of failures) {
      progressBox.appendChild(
        el('div', { class: 'st-fail' }, [
          el('img', { src: f.unit.src, alt: '' }),
          el('div', { text: f.error ?? '전사에 실패했습니다.' }),
          el('button', {
            class: 'st-btn',
            text: '다시',
            onclick: (e: Event) => void retry(f.unit, (e.currentTarget as HTMLButtonElement)),
          }),
        ]),
      );
    }
  }

  async function run(): Promise<void> {
    if (running) return;
    running = true;
    failures = [];
    syncRun();
    abort = new AbortController();

    try {
      setProgress(0, 0, '캡처를 모으는 중…');
      const { units, textOnly } = await collectCaptures(ctx.state);
      captureSrc = new Map(units.map((u) => [u.id, u.src]));

      if (!units.length && !textOnly.length) {
        note('초안이 비어 있습니다. 먼저 캡처나 글을 넣어 주세요.');
        progressBox.style.display = 'none';
        return;
      }

      const results = units.length
        ? await extractAll(
            settings,
            units,
            (done, total, r) => {
              if (r.failed) failures = [...failures, r];
              setProgress(done, total, `캡처 ${done}/${total} 전사 중…`);
            },
            abort.signal,
          )
        : [];

      // 교사가 중지를 눌렀다 — 반쯤 된 결과는 버리고, 있던 완성본은 그대로 지킨다.
      if (abort.signal.aborted) {
        failures = [];
        progressBox.style.display = 'none';
        note(doc ? '중지했습니다. 이전 완성본은 그대로 남아 있습니다.' : '중지했습니다.');
        return;
      }

      doc = buildDoc([...textOnly, ...results]);
      overrides = {};
      setProgress(1, 1, '도판을 다듬는 중…');
      await prepareFigures();
      setProgress(1, 1, `완성본이 준비됐습니다 · 캡처 ${units.length}장${failures.length ? ` · 실패 ${failures.length}장` : ''}`);
      persist();
      preview();
      note('');
    } catch (e) {
      note(e instanceof Error ? e.message : String(e));
    } finally {
      running = false;
      abort = null;
      syncRun();
    }
  }

  async function retry(unit: CaptureUnit, btn: HTMLButtonElement): Promise<void> {
    if (!doc) return;
    btn.disabled = true;
    btn.textContent = '…';
    const r = await extractOne(settings, unit);
    if (r.failed) {
      btn.disabled = false;
      btn.textContent = '다시';
      return;
    }
    // 성공했으면 그 캡처가 만든 아이템만 갈아 끼운다.
    for (const sec of doc.sections) {
      if (sec.srcBlockId !== unit.blockId) continue;
      const at = sec.items.findIndex((it) => it.kind === 'image' && it.from === unit.id);
      if (at >= 0) sec.items.splice(at, 1, ...r.items);
    }
    failures = failures.filter((f) => f.unit.id !== unit.id);
    await prepareFigures();
    setProgress(1, 1, '다시 전사했습니다.');
    persist();
    preview();
  }

  function buildDoc(results: CaptureResult[]): PolishedDoc {
    const byBlock = new Map<number, WorksheetItem[]>();
    const order: number[] = [];
    const typeOf = new Map<number, string>();

    for (const r of results) {
      const id = r.unit.blockId;
      if (!byBlock.has(id)) {
        byBlock.set(id, []);
        order.push(id);
        typeOf.set(id, r.unit.blockType);
      }
      byBlock.get(id)!.push(...r.items);
    }

    // 초안의 블록 순서를 그대로 지킨다 — 교사가 짜 둔 흐름이 곧 학습 순서다.
    const blockOrder = new Map(ctx.state.blocks.map((b, i) => [b.id, i]));
    order.sort((a, b) => (blockOrder.get(a) ?? 0) - (blockOrder.get(b) ?? 0));

    // 지면 배치도 그대로 옮긴다 — 칸 크기와 자리는 교사가 정한 것이다.
    const layout = readLayout();
    const ratioOf = new Map(
      ctx.state.blocks.map((b) => [b.id, 'ratio' in b ? (b as { ratio: number }).ratio : undefined]),
    );

    return {
      meta: {
        title: ctx.state.meta.title || '학습지',
        subtitle: ctx.state.meta.contTitle || undefined,
        date: ctx.dateStamp(),
      },
      sections: order.map((id) => {
        const g = layout.get(id);
        return {
          srcBlockId: id,
          srcType: typeOf.get(id) ?? 'problem',
          geom: g ? { ...g, ratio: ratioOf.get(id) } : undefined,
          items: byBlock.get(id) ?? [],
        };
      }),
    };
  }

  async function prepareFigures(): Promise<void> {
    if (!doc) return;
    await fillFigures(allFigures(doc), (from) => captureSrc.get(from));
    // 통째로 실은 캡처는 원본 그대로 쓴다.
    for (const sec of doc.sections) {
      for (const item of sec.items) {
        if (item.kind === 'image' && !item.src) item.src = captureSrc.get(item.from);
      }
    }
  }

  /* ── 미리보기 · 수정 수확 ─────────────────────────────── */

  function preview(): void {
    if (doc) render(doc, false);
  }

  /** 미리보기에 문서 한 편을 띄운다. 예시는 워터마크가 붙고 고칠 수 없다. */
  function render(target: PolishedDoc, sample: boolean): void {
    showingSample = sample;
    empty.remove();
    if (!stage.isConnected) {
      view.textContent = '';
      view.append(sampleBadge, stage);
    }
    sampleBadge.style.display = sample ? '' : 'none';
    stage.classList.toggle('sample', sample);
    frame.srcdoc = sample
      ? renderDocument(target, theme, { editable: false })
      : renderDocument(target, theme, { editable: true, overrides });
    applyZoom();
    if (!sample) frame.addEventListener('load', reportTightCells, { once: true });
  }

  /**
   * 초안 칸보다 글이 많아 잘린 칸이 있으면 알려 준다.
   * 초안에서 그 칸만 키우고 다시 만들면 되고, 다시 만드는 데 토큰은 들지 않는다.
   */
  function reportTightCells(): void {
    const d = frame.contentDocument;
    if (!d) return;
    window.setTimeout(() => {
      const clipped = d.querySelectorAll('.ws-clip').length;
      if (clipped > 0) {
        note(`칸 ${clipped}개는 글이 많아 일부가 가려졌습니다. 초안에서 그 칸을 키운 뒤 다시 만들어 주세요.`);
      }
    }, 400);
  }

  /** A4 한 쪽이 모달 안에 통째로 들어오도록 배율을 맞춘다 */
  function applyZoom(): void {
    if (!stage.isConnected || !view.clientHeight) return;
    const pw = frame.offsetWidth || 794;
    const ph = frame.offsetHeight || 1123;
    const pad = 36; // .st-view 좌우·상하 여백
    const badge = sampleBadge.style.display === 'none' ? 0 : sampleBadge.offsetHeight + 10;
    const availW = Math.max(160, view.clientWidth - pad);
    const availH = Math.max(160, view.clientHeight - pad - badge);
    const k = zoom === 'fit' ? Math.min(1, availW / pw, availH / ph) : zoom;
    stage.style.setProperty('--k', String(k));
    stage.style.width = `${Math.round(pw * k)}px`;
    stage.style.height = `${Math.round(ph * k)}px`;
  }

  new ResizeObserver(() => applyZoom()).observe(view);

  /** 교사가 미리보기에서 고친 글을 걷어 둔다. 경로가 문서 주소라 테마가 바뀌어도 살아남는다. */
  function harvestEdits(): void {
    const d = frame.contentDocument;
    if (!d) return;
    for (const node of d.querySelectorAll<HTMLElement>('[data-path]')) {
      const path = node.dataset.path;
      if (path) overrides[path] = node.innerHTML;
    }
  }

  function persist(): void {
    if (!doc) return;
    const saved: Saved = {
      draftHash: draftHash(ctx.state),
      doc: stripSrc(doc),
      overrides,
      theme,
      savedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(saved));
    } catch {
      /* 저장 공간이 모자라면 이번 세션에서만 쓴다 */
    }
  }

  /* ── 내보내기 ─────────────────────────────────────────── */

  function finalHtml(): string {
    harvestEdits();
    persist();
    return renderDocument(doc!, theme, { overrides });
  }

  function doPrint(): void {
    if (!doc) return;
    const html = finalHtml();
    const box = el('iframe', { style: 'position:fixed;right:0;bottom:0;width:210mm;height:297mm;opacity:0;border:0;pointer-events:none' }) as HTMLIFrameElement;
    document.body.appendChild(box);
    box.srcdoc = html;
    box.addEventListener('load', () => {
      const w = box.contentWindow;
      if (!w) return;
      const title = document.title;
      document.title = `${ctx.safeTitle()}_완성본`;
      w.focus();
      w.print();
      setTimeout(() => {
        document.title = title;
        box.remove();
      }, 800);
    });
  }

  function doSaveHtml(): void {
    if (!doc) return;
    const blob = new Blob([finalHtml()], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a', {
      href: url,
      download: `${ctx.safeTitle()}_완성본_${ctx.dateStamp()}.html`,
      style: 'display:none',
    }) as HTMLAnchorElement;
    // 문서에 붙여야 파일명이 지켜진다 (빌더의 JSON 저장과 같은 방식).
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 0);
  }

  /* ── 지난 완성본 되살리기 ─────────────────────────────── */

  void (async () => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Saved;
      if (saved.draftHash !== draftHash(ctx.state)) {
        note('초안이 바뀌었습니다. 다시 만들어 주세요.');
        return;
      }
      doc = saved.doc;
      overrides = saved.overrides ?? {};
      if (isThemeName(saved.theme)) setThemeSilently(saved.theme);
      const { units } = await collectCaptures(ctx.state);
      captureSrc = new Map(units.map((u) => [u.id, u.src]));
      await prepareFigures();
      preview();
      syncRun();
      note('지난 완성본을 그대로 열었습니다.');
    } catch {
      /* 저장본이 깨졌으면 그냥 새로 만든다 */
    }
  })();

  function setThemeSilently(name: ThemeName): void {
    theme = name;
    markTheme(name);
  }

  return { show, hide };
}
