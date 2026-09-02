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
import {
  blockImages,
  collectCaptures,
  extractAll,
  extractOne,
  resolveFigureSources,
  tagOf,
  type CaptureResult,
  type CaptureUnit,
} from './extract';
import { DESIGN_ORDER, DESIGNS, isDesignName, type DesignName } from './designs';
import { fillFigures } from './figures';
import { redrawAll } from './redraw';
import type { FigureRef, PolishedDoc, WorksheetItem } from './schema';
import { SAMPLE_DOC } from './sampleDoc';
import { bakeDraft, thumbnailUrl, type Bake, type PrintLayout } from './snapshot';
import { renderDocument } from './typeset';

import './studio.css';

// v3: 초안을 구워 자리를 재는 방식으로 바뀌어, 격자(행·높이 비율) 저장본과 맞지 않는다.
const STORE_KEY = 'cornell-studio-v3';

export interface StudioContext {
  state: AppState;
  safeTitle: () => string;
  dateStamp: () => string;
  /** 초안을 구울 때 편집 UI를 감추고 A4 실치수로 돌려 놓는 스위치 (app.ts) */
  printLayout: PrintLayout;
}

interface Saved {
  draftHash: string;
  doc: PolishedDoc;
  overrides: Record<string, string>;
  design?: DesignName;
  savedAt: string;
}

/**
 * 초안이 그대로인지 알아보는 지문 — 캡처·글은 물론 칸 크기·비율·이미지 자리처럼
 * **배치**가 바뀌어도 값이 달라진다. 완성본은 배치를 그대로 옮기므로 배치도 내용이다.
 */
function draftHash(state: AppState): string {
  const parts: string[] = [state.meta.title, String(state.meta.showHead), String(state.meta.pageFit)];
  for (const b of state.blocks) {
    const o = b as unknown as Record<string, unknown>;
    parts.push(
      `${b.id}:${b.type}:${b.title}:${b.h}:${o.ratio ?? ''}:${o.imgMode ?? ''}:${o.width ?? ''}:${b.titleHidden ? 1 : 0}:${b.tagHidden ? 1 : 0}:${b.tagLabel ?? ''}`,
    );
    for (const im of blockImages(b)) {
      parts.push(
        `${im.id}:${im.src.length}:${im.src.slice(-24)}:${im.x.toFixed(4)}:${im.y.toFixed(4)}:${im.w.toFixed(4)}:${im.sharpened ? 1 : 0}`,
      );
    }
    for (const k of ['probHtml', 'solHtml', 'exHtml', 'imgHtml', 'html'] as const) {
      const v = o[k];
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

/** "그림을 벡터로 다시 그리기" 설정 — 기본은 켬 */
const REDRAW_KEY = 'cornell-studio-redraw';
function loadRedraw(): boolean {
  try {
    return localStorage.getItem(REDRAW_KEY) !== '0';
  } catch {
    return true;
  }
}

function createSession(ctx: StudioContext): Session {
  const settings: AiSettings = loadSettings();
  let redraw = loadRedraw();
  let design: DesignName = 'mono';
  let doc: PolishedDoc | null = null;
  let overrides: Record<string, string> = {};
  let captureSrc = new Map<string, string>();
  /** 마지막으로 구운 초안 — 자리와 쪽 그림 */
  let bake: Bake | null = null;
  /** 구운 쪽 썸네일 — 진행 상자에 보여 준다 */
  let thumbs: string[] = [];
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
      '초안을 먼저 PDF처럼 쪽 단위로 구운 뒤, 칸·문제·그림의 자리는 그대로 두고 글만 다시 조판합니다.<br>' +
      '위 디자인 이름이나 <b style="display:inline;font-size:inherit">예시 학습지</b> 버튼을 누르면 각 디자인의 예시를 미리 볼 수 있습니다.',
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

  /* 디자인 탭 — 배치는 어느 디자인이나 같고, 덧입히는 옷만 다르다 */
  const tabs = el('div', { class: 'st-tabs', role: 'tablist' });
  for (const name of DESIGN_ORDER) {
    const d = DESIGNS[name];
    tabs.appendChild(
      el('button', {
        class: 'st-tab',
        role: 'tab',
        'aria-pressed': String(name === design),
        title: d.blurb,
        data: { design: name },
        text: d.label,
        onclick: () => setDesign(name),
      }),
    );
  }
  const sampleBtn = el('button', {
    class: 'st-btn',
    text: '예시 학습지',
    title: '고른 디자인의 예시 학습지를 미리 봅니다',
    onclick: () => {
      if (showingSample && doc) {
        preview();
      } else {
        if (doc && !showingSample) harvestEdits();
        previewSample();
      }
      syncRun();
    },
  }) as HTMLButtonElement;
  const lead = el('div', { class: 'st-lead' }, [tabs, sampleBtn]);

  function markDesign(): void {
    for (const b of tabs.children) {
      b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.design === design));
    }
  }

  /** 디자인을 바꾼다 — 완성본이 있으면 그대로 다시 입히고, 없으면 예시로 보여 준다 */
  function setDesign(name: DesignName): void {
    if (doc && !showingSample) harvestEdits();
    design = name;
    markDesign();
    if (doc && !showingSample) {
      persist();
      preview();
    } else {
      previewSample();
    }
    syncRun();
  }
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
        lead,
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
    window.removeEventListener('message', onFrameMessage);
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

  const redrawInput = el('input', { type: 'checkbox' }) as HTMLInputElement;
  redrawInput.checked = redraw;
  redrawInput.addEventListener('change', () => {
    redraw = redrawInput.checked;
    try {
      localStorage.setItem(REDRAW_KEY, redraw ? '1' : '0');
    } catch {
      /* 설정을 남기지 못해도 이번 세션에서는 쓴다 */
    }
  });
  const redrawRow = el(
    'label',
    {
      class: 'st-check',
      title:
        '그래프·도형·표를 모델이 벡터(SVG)로 다시 그려 인쇄에서 또렷하게 만듭니다. 크기와 자리는 원본 그대로입니다. 그림마다 요청이 1번 더 갑니다. 미리보기에서 그림 위 「원본」 버튼으로 원본과 대조하고 되돌릴 수 있습니다.',
    },
    [redrawInput, el('span', { text: '그림을 벡터로 다시 그리기 (그림마다 요청 1번)' })],
  );

  const noteLine = el('p', { class: 'hint' });
  function note(msg: string): void {
    noteLine.textContent = msg;
  }

  rail.append(
    el('h2', { text: '완성하기 스튜디오' }),
    el('p', {
      class: 'hint',
      text: '초안을 먼저 PDF처럼 한 장으로 구운 뒤, 칸·문제·그림의 자리와 크기는 그대로 두고 글만 어절 단위로 다시 조판합니다. 그림은 같은 자리·같은 크기에 벡터로 다시 그릴 수 있습니다 — 다시 그린 그림은 원본과 꼭 대조하세요. 손필기는 옮기지 않습니다. 초안은 그대로 둡니다.',
    }),
    el('div', { class: 'st-group' }, [el('label', { text: 'AI 제공자' }), providerSel]),
    el('div', { class: 'st-group' }, [el('label', { text: 'API 키' }), keyInput, keyLink]),
    el('div', { class: 'st-group' }, [
      el('label', { text: '모델' }),
      el('div', { class: 'st-row' }, [modelSel, loadModelsBtn]),
      redrawRow,
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
    sampleBtn.textContent = doc && showingSample ? '내 완성본 보기' : '예시 학습지';
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

  /** 예시 학습지 한 장을 미리보기에 띄운다 */
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
    if (thumbs.length) {
      progressBox.appendChild(
        el(
          'div',
          { class: 'st-thumbs', title: '구운 초안 — 이 그림을 읽어 완성본을 만듭니다' },
          thumbs.map((src, i) => el('img', { src, alt: `초안 ${i + 1}쪽` })),
        ),
      );
    }
    // 모델·키 문제는 캡처마다 같은 사유다 — 한 줄로 묶어 알린다.
    const fatal = failures.find((f) => f.fatal);
    if (fatal) {
      progressBox.appendChild(
        el('div', { class: 'st-fail st-fail--model' }, [
          el('div', {
            text: `${fatal.error ?? '이 모델로는 전사할 수 없습니다.'} 캡처 ${failures.length}장이 그대로 이미지로 들어갔습니다. 모델을 바꾼 뒤 다시 만들어 주세요.`,
          }),
        ]),
      );
      return;
    }
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
      // 1) 초안을 PDF처럼 굽는다 — 쪽 그림 + 칸·패널·이미지의 자리.
      thumbs = [];
      setProgress(0, 0, '초안을 PDF처럼 굽는 중…');
      bake = await bakeDraft(
        ctx.printLayout,
        (done, total) => setProgress(done, total, `초안을 PDF처럼 굽는 중… ${done}/${total}쪽`),
        abort.signal,
      );
      thumbs = bake.pages.map((p) => thumbnailUrl(p)).filter((s): s is string => !!s);
      if (abort.signal.aborted) {
        progressBox.style.display = 'none';
        note(doc ? '중지했습니다. 이전 완성본은 그대로 남아 있습니다.' : '중지했습니다.');
        return;
      }

      // 2) 구운 쪽에서 문제칸을 잘라 캡처로 삼는다.
      setProgress(0, 0, '캡처를 잘라 내는 중…');
      const { units, textOnly, empty } = await collectCaptures(ctx.state, bake);
      captureSrc = new Map(units.map((u) => [u.id, u.src]));

      if (!units.length && !textOnly.length && !empty.length) {
        note('초안이 비어 있습니다. 먼저 캡처나 글을 넣어 주세요.');
        progressBox.style.display = 'none';
        return;
      }

      // 3) 전사한다.
      const results = units.length
        ? await extractAll(
            settings,
            units,
            (done, total, r) => {
              if (r.failed) failures = [...failures, r];
              setProgress(done, total, `칸 ${done}/${total} 전사 중…`);
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

      // 4) 초안 자리에 앉힌다.
      doc = buildDoc([...empty, ...textOnly, ...results], bake);
      overrides = {};
      setProgress(1, 1, '도판을 다듬는 중…');
      await prepareFigures();

      // 5) 그림을 벡터로 다시 그린다 — 자리·크기는 그대로, 선만 또렷하게.
      //    모델 문제로 전사가 막혔으면 같은 사유로 막힐 테니 부르지 않는다.
      let redrawNote = '';
      if (redraw && !failures.some((f) => f.fatal)) {
        const r = await redrawFigures(abort.signal);
        if (abort.signal.aborted) {
          // 그림은 원본 캡처로도 완성본이 된다 — 여기서 멈추면 그때까지 된 것을 살린다.
          redrawNote = '그림 다시 그리기를 중지했습니다. 나머지 그림은 원본 캡처로 들어갔습니다.';
        } else if (r.fatal) {
          redrawNote = `${r.fatal} 그림은 원본 캡처로 들어갔습니다.`;
        }
      }

      setProgress(
        1,
        1,
        `완성본이 준비됐습니다 · ${bake.pages.length}쪽 · 캡처 ${units.length}장${failures.length ? ` · 실패 ${failures.length}장` : ''}`,
      );
      persist();
      preview();
      const modelFail = failures.find((f) => f.fatal);
      note(
        modelFail
          ? `${modelFail.error ?? '이 모델로는 전사할 수 없습니다.'} 위 모델 목록에서 그림을 읽을 수 있는 다른 모델을 고른 뒤 다시 만들어 주세요.`
          : redrawNote
            ? redrawNote
            : bake.rasterized
              ? ''
              : '쪽 그림을 만들지 못해 이미지 조각만으로 전사했습니다. 배치는 그대로 지켰습니다.',
      );
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
    resolveFigureSources(r.items, bake?.blocks.get(unit.blockId)?.imgs[unit.panel]);
    // 성공했으면 그 캡처가 만든 아이템만 갈아 끼운다.
    for (const sec of doc.sections) {
      if (sec.srcBlockId !== unit.blockId) continue;
      const at = sec.items.findIndex((it) => it.kind === 'image' && it.from === unit.id);
      if (at >= 0) sec.items.splice(at, 1, ...r.items);
    }
    failures = failures.filter((f) => f.unit.id !== unit.id);
    await prepareFigures();
    if (redraw) await redrawFigures();
    setProgress(1, 1, '다시 전사했습니다.');
    persist();
    preview();
  }

  /**
   * 전사 결과를 초안 자리에 앉힌 문서로 만든다. 칸 하나가 섹션 하나고, 자리는 구울 때
   * 잰 그대로다 — 칸 크기·문제칸/풀이칸 분할·쪽은 교사가 정한 것이다.
   */
  function buildDoc(results: CaptureResult[], baked: Bake): PolishedDoc {
    const byBlock = new Map<number, WorksheetItem[]>();
    for (const r of results) {
      // 도판이 원본 이미지 한 장 안에 들어가면 거기서 자르게 출처를 단다.
      resolveFigureSources(r.items, baked.blocks.get(r.unit.blockId)?.imgs[r.unit.panel]);
      if (!byBlock.has(r.unit.blockId)) byBlock.set(r.unit.blockId, []);
      byBlock.get(r.unit.blockId)!.push(...r.items);
    }

    return {
      meta: {
        title: ctx.state.meta.title || '학습지',
        subtitle: ctx.state.meta.contTitle || undefined,
        date: ctx.dateStamp(),
        showHead: ctx.state.meta.showHead,
      },
      // 초안의 블록 순서를 그대로 지킨다 — 교사가 짜 둔 흐름이 곧 학습 순서다.
      sections: ctx.state.blocks
        .filter((b) => baked.blocks.has(b.id))
        .map((b, idx) => {
          const snap = baked.blocks.get(b.id)!;
          return {
            srcBlockId: b.id,
            srcType: b.type,
            title: b.titleHidden ? undefined : b.title || undefined,
            tagLabel: b.tagHidden ? undefined : tagOf(b, idx),
            geom: {
              page: snap.page,
              rect: snap.rect,
              head: snap.head,
              bare: snap.bare,
              clipped: snap.clipped,
              panels: snap.panels,
            },
            items: byBlock.get(b.id) ?? [],
          };
        }),
    };
  }

  /** 원본 이미지 dataURL — 도판을 해상도 좋게 자를 때 쓴다 (화질 보정본이 있으면 그것) */
  function imageSrc(imgId: number): string | undefined {
    for (const b of ctx.state.blocks) {
      for (const im of blockImages(b)) {
        if (im.id === imgId) return im.sharpened && im.sharpSrc ? im.sharpSrc : im.src;
      }
    }
    return undefined;
  }

  async function prepareFigures(): Promise<void> {
    if (!doc) return;
    await fillFigures(allFigures(doc), (from) => captureSrc.get(from), imageSrc);
    // 통째로 실은 캡처는 원본 그대로 쓴다.
    for (const sec of doc.sections) {
      for (const item of sec.items) {
        if (item.kind === 'image' && !item.src) item.src = captureSrc.get(item.from);
      }
    }
  }

  /**
   * 아직 다시 그리지 않은 그림을 벡터로 그린다. 크기는 typeset 이 원본 상자에 맞추므로
   * 여기서는 그림만 바꾼다. 중지 신호가 오면 남은 그림은 원본으로 둔다.
   */
  async function redrawFigures(signal?: AbortSignal): Promise<{ drawn: number; fatal?: string }> {
    if (!doc) return { drawn: 0 };
    const refs = allFigures(doc);
    const todo = refs.filter((f) => f.src && f.svg === undefined).length;
    if (!todo) return { drawn: 0 };
    setProgress(0, todo, `그림 0/${todo} 다시 그리는 중…`);
    return redrawAll(
      settings,
      refs,
      (done, total) => setProgress(done, total, `그림 ${done}/${total} 다시 그리는 중…`),
      signal,
    );
  }

  /** 미리보기의 「원본/벡터」 버튼 — 그 그림만 원본 캡처와 다시 그린 것 사이를 오간다. */
  function onFrameMessage(e: MessageEvent): void {
    if (e.source !== frame.contentWindow || !doc || showingSample) return;
    const data = e.data as { type?: unknown; path?: unknown } | null;
    if (!data || data.type !== 'ws-fig-toggle' || typeof data.path !== 'string') return;
    const m = /^s(\d+)\.i(\d+)\.f(\d+)$/.exec(data.path);
    if (!m) return;
    const item = doc.sections[Number(m[1])]?.items[Number(m[2])];
    if (!item || (item.kind !== 'problem' && item.kind !== 'concept')) return;
    // typeset 은 src·svg 가 있는 그림만 번호를 매긴다 — 같은 규칙으로 찾는다.
    const fig = (item.figures ?? []).filter((f) => f.src || f.svg)[Number(m[3])];
    if (!fig || !fig.svg) return;
    harvestEdits();
    fig.useSvg = fig.useSvg === false;
    persist();
    preview();
  }
  window.addEventListener('message', onFrameMessage);

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
      ? renderDocument(target, { editable: false, design })
      : renderDocument(target, { editable: true, overrides, design });
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
        note(`칸 ${clipped}개는 글씨와 간격을 줄여도 다 들어가지 않아 일부가 가려졌습니다. 초안에서 그 칸을 키운 뒤 다시 만들어 주세요.`);
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
      design,
      savedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(saved));
    } catch (e) {
      // 저장 공간이 모자라면 이번 세션에서만 쓴다 — 원인은 콘솔에만 남긴다.
      console.warn('완성본을 브라우저에 저장하지 못했습니다.', e);
    }
  }

  /* ── 내보내기 ─────────────────────────────────────────── */

  function finalHtml(): string {
    harvestEdits();
    persist();
    return renderDocument(doc!, { overrides, design });
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
      if (isDesignName(saved.design)) {
        design = saved.design;
        markDesign();
      }
      // 도판·통째 캡처를 되살리려면 쪽 그림이 필요하다 — 다시 굽는다 (토큰은 들지 않는다).
      note('지난 완성본을 여는 중 — 초안을 다시 굽습니다…');
      bake = await bakeDraft(ctx.printLayout, () => {});
      thumbs = bake.pages.map((p) => thumbnailUrl(p)).filter((s): s is string => !!s);
      const { units } = await collectCaptures(ctx.state, bake);
      captureSrc = new Map(units.map((u) => [u.id, u.src]));
      await prepareFigures();
      preview();
      syncRun();
      note('지난 완성본을 그대로 열었습니다.');
    } catch (e) {
      // 저장본이 깨졌으면 그냥 새로 만든다 — 원인은 콘솔에만 남긴다.
      console.warn('지난 완성본을 열지 못했습니다.', e);
      note('');
    }
  })();

  return { show, hide };
}
