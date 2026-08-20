/**
 * "워크시트그랩으로 완성" 패널 —
 * 1차 초안 분석 → 요청문·명령 생성 → 복사·내려받기.
 */

import {
  PROVIDER_KEY_URL,
  PROVIDER_LABEL,
  activeKey,
  complete,
  listModels,
  loadSettings,
  parseJsonLoose,
  saveSettings,
  type AiSettings,
  type Provider,
} from './aiClient';
import {
  GRAB_ARCHETYPES,
  SYSTEM_PROMPT,
  buildDigest,
  buildUserPrompt,
  finalPrompt,
  normalizePlan,
  type GrabPlan,
} from './grabBridge';
import type { Store } from '../state/store';
import { $, el } from '../utils/dom';
import { Icons } from '../utils/icons';

export interface GrabPanelContext {
  store: Store;
  /** 화면의 편집 내용을 상태로 먼저 내려 받는다 */
  syncFromDOM: () => void;
  /** 제목 기준 파일 이름 (확장자 제외) */
  safeTitle: () => string;
}

export function createGrabPanel(ctx: GrabPanelContext) {
  const { store, syncFromDOM, safeTitle } = ctx;
  let settings: AiSettings = loadSettings();
  let plan: GrabPlan | null = null;
  let busy = false;
  let overlay: HTMLElement | null = null;

  function download(name: string, text: string, type = 'text/plain'): void {
    const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 0);
  }

  async function copy(text: string, btn: HTMLButtonElement): Promise<void> {
    const done = () => {
      const old = btn.textContent;
      btn.textContent = '복사됨';
      btn.classList.add('ok');
      setTimeout(() => {
        btn.textContent = old;
        btn.classList.remove('ok');
      }, 1400);
    };
    try {
      await navigator.clipboard.writeText(text);
      done();
    } catch {
      // 클립보드가 막힌 환경 — 텍스트를 골라 주면 Ctrl+C로 복사할 수 있다.
      const ta = $('#grabPromptBox') as HTMLTextAreaElement | null;
      if (ta) {
        ta.focus();
        ta.select();
      }
      btn.textContent = 'Ctrl+C 를 누르세요';
      setTimeout(() => (btn.textContent = '복사'), 2200);
    }
  }

  function attachName(): string {
    return `${safeTitle()}.cornell.json`;
  }

  function field(label: string, node: HTMLElement, hint?: string): HTMLElement {
    return el('label', { class: 'gp-field' }, [
      el('span', { class: 'gp-lab', text: label }),
      node,
      hint ? el('span', { class: 'gp-hint', html: hint }) : null,
    ]);
  }

  function buildSettings(): HTMLElement {
    const modelInput = el('input', {
      class: 'gp-input',
      value: settings.models[settings.provider],
      placeholder: '모델 이름',
      oninput: (e: Event) => {
        settings.models[settings.provider] = (e.target as HTMLInputElement).value;
        saveSettings(settings);
      },
    }) as HTMLInputElement;

    const modelList = el('datalist', { id: 'gpModels' }) as HTMLDataListElement;
    modelInput.setAttribute('list', 'gpModels');

    const keyInput = el('input', {
      class: 'gp-input',
      type: 'password',
      value: settings.keys[settings.provider],
      placeholder: 'API 키',
      oninput: (e: Event) => {
        settings.keys[settings.provider] = (e.target as HTMLInputElement).value;
        saveSettings(settings);
        refreshRunState();
      },
    }) as HTMLInputElement;

    const seg = el('div', { class: 'gp-seg' });
    const pick = (p: Provider): void => {
      settings.provider = p;
      saveSettings(settings);
      keyInput.value = settings.keys[p];
      modelInput.value = settings.models[p];
      modelList.innerHTML = '';
      [...seg.children].forEach((c) => c.classList.toggle('on', c.getAttribute('data-p') === p));
      keyHint.innerHTML = `키 발급: <a href="${PROVIDER_KEY_URL[p]}" target="_blank" rel="noreferrer">${PROVIDER_KEY_URL[p]}</a>`;
      refreshRunState();
    };
    (['openrouter', 'gemini'] as Provider[]).forEach((p) => {
      seg.appendChild(
        el('button', {
          class: settings.provider === p ? 'on' : '',
          data: { p },
          text: PROVIDER_LABEL[p],
          onclick: () => pick(p),
        }),
      );
    });

    const keyHint = el('span', {
      class: 'gp-hint',
      html: `키 발급: <a href="${PROVIDER_KEY_URL[settings.provider]}" target="_blank" rel="noreferrer">${PROVIDER_KEY_URL[settings.provider]}</a>`,
    });

    const loadBtn = el('button', {
      class: 'gp-btn ghost',
      text: '모델 불러오기',
      onclick: async () => {
        loadBtn.disabled = true;
        const old = loadBtn.textContent;
        loadBtn.textContent = '불러오는 중…';
        try {
          const ids = await listModels(settings.provider, activeKey(settings));
          modelList.innerHTML = '';
          ids.forEach((id) => modelList.appendChild(el('option', { value: id })));
          loadBtn.textContent = `${ids.length}개`;
        } catch (err) {
          setStatus(`모델 목록 실패: ${(err as Error).message}`, true);
          loadBtn.textContent = old;
        } finally {
          loadBtn.disabled = false;
          setTimeout(() => (loadBtn.textContent = '모델 불러오기'), 1800);
        }
      },
    }) as HTMLButtonElement;

    return el('div', { class: 'gp-settings' }, [
      field('AI 제공자', seg, '둘 다 지원합니다. 쓰실 쪽을 고르고 키를 넣으세요.'),
      el('div', { class: 'gp-row' }, [
        field('API 키', keyInput),
        field('모델', el('div', { class: 'gp-inline' }, [modelInput, modelList, loadBtn])),
      ]),
      keyHint,
      el('p', {
        class: 'gp-note',
        text: '키는 이 브라우저에만 저장되고, 고른 제공자에게만 전송됩니다. 초안의 글자와 배치 정보만 보내고 이미지 파일은 보내지 않습니다.',
      }),
    ]);
  }

  let statusEl!: HTMLElement;
  let runBtn!: HTMLButtonElement;
  let resultEl!: HTMLElement;
  let askInput!: HTMLTextAreaElement;

  function setStatus(msg: string, bad = false): void {
    statusEl.textContent = msg;
    statusEl.classList.toggle('bad', bad);
  }

  /**
   * 실행 버튼 상태를 맞춘다.
   * withHint=false 면 상태줄은 건드리지 않는다 (오류·완료 메시지를 덮어쓰지 않도록).
   */
  function refreshRunState(withHint = true): void {
    const hasKey = !!activeKey(settings);
    const hasBlocks = store.state.blocks.length > 0;
    runBtn.disabled = busy || !hasKey || !hasBlocks;
    if (!withHint) return;
    if (!hasBlocks) setStatus('먼저 빌더에서 학습지를 1차로 만들어 주세요.');
    else if (!hasKey) setStatus(`${PROVIDER_LABEL[settings.provider]} API 키를 넣으면 분석할 수 있어요.`);
    else if (!busy) setStatus('준비됐어요. 초안을 분석해 워크시트그랩 요청문을 만듭니다.');
  }

  function chip(text: string): HTMLElement {
    return el('span', { class: 'gp-chip', text });
  }

  function section(title: string, kids: (HTMLElement | null)[]): HTMLElement {
    return el('div', { class: 'gp-sec' }, [el('h4', { text: title }), ...kids.filter(Boolean)]);
  }

  function renderResult(p: GrabPlan): HTMLElement {
    const promptText = finalPrompt(p, attachName());
    const arche = GRAB_ARCHETYPES.find((a) => a.id === p.archetype);

    const box = el('textarea', {
      class: 'gp-prompt',
      id: 'grabPromptBox',
      spellcheck: 'false',
      rows: '14',
    }) as HTMLTextAreaElement;
    box.value = promptText;

    const copyBtn = el('button', {
      class: 'gp-btn primary',
      text: '복사',
      onclick: () => void copy(box.value, copyBtn),
    }) as HTMLButtonElement;

    const cliBtn = el('button', {
      class: 'gp-btn ghost',
      text: '명령 복사',
      onclick: () => void copy(p.cliCommand, cliBtn),
    }) as HTMLButtonElement;
    if (!p.cliCommand) cliBtn.style.display = 'none';

    return el('div', { class: 'gp-result' }, [
      section('분석 결과', [
        el('div', { class: 'gp-chips' }, [
          p.gradeBand ? chip(p.gradeBand) : null,
          p.subjectLabel ? chip(p.subjectLabel) : null,
          p.topic ? chip(p.topic) : null,
          arche ? chip(`${arche.name} (${arche.id})`) : null,
        ].filter(Boolean) as HTMLElement[]),
        p.summary ? el('p', { class: 'gp-p', text: p.summary }) : null,
        p.archetypeReason ? el('p', { class: 'gp-p dim', text: `구조 선택 이유 — ${p.archetypeReason}` }) : null,
      ]),
      p.objectives.length
        ? section('학습 목표', [
            el('ul', { class: 'gp-ul' }, p.objectives.map((o) => el('li', { text: o }))),
          ])
        : null,
      p.gaps.length
        ? section('완성하려면 채울 것', [
            el('ul', { class: 'gp-ul' }, p.gaps.map((g) => el('li', { text: g }))),
          ])
        : null,
      section('워크시트그랩에 붙여넣을 요청문', [
        el('p', {
          class: 'gp-hint',
          html: `아래 <b>요청문</b>을 복사해, worksheet-grab 폴더를 연 AI 도구(클로드 코드·코덱스 등)에 붙여넣으세요. 같은 폴더에 <b>${attachName()}</b> 도 함께 두세요.`,
        }),
        box,
        el('div', { class: 'gp-actions' }, [
          copyBtn,
          cliBtn,
          el('button', {
            class: 'gp-btn ghost',
            text: '요청문 .md 저장',
            onclick: () => download(`${safeTitle()}_worksheet-grab.md`, box.value, 'text/markdown'),
          }),
          el('button', {
            class: 'gp-btn ghost',
            text: '초안 JSON 저장',
            onclick: () => download(attachName(), store.exportJSON(), 'application/json'),
          }),
        ].filter(Boolean) as HTMLElement[]),
        p.cliCommand ? el('pre', { class: 'gp-cli', text: p.cliCommand }) : null,
      ]),
      p.blockNotes.length
        ? section('블록별 지시', [
            el('ol', { class: 'gp-ul' }, p.blockNotes.map((b) => el('li', { text: `${b.n}. ${b.note}` }))),
          ])
        : null,
    ].filter(Boolean) as HTMLElement[]);
  }

  async function run(): Promise<void> {
    if (busy) return;
    syncFromDOM();
    store.save();
    busy = true;
    refreshRunState(false);
    setStatus(`${PROVIDER_LABEL[settings.provider]} 로 초안을 분석하는 중…`);
    resultEl.innerHTML = '';
    try {
      const text = await complete(settings, {
        system: SYSTEM_PROMPT,
        user: buildUserPrompt(store.state, askInput.value),
        json: true,
      });
      let parsed: unknown;
      try {
        parsed = parseJsonLoose(text);
      } catch {
        throw new Error('모델이 JSON 형식으로 답하지 않았습니다. 다른 모델로 다시 시도해 보세요.');
      }
      plan = normalizePlan(parsed);
      resultEl.appendChild(renderResult(plan));
      setStatus('요청문이 준비됐어요.');
    } catch (err) {
      const msg = (err as Error).message;
      setStatus(`분석 실패: ${msg}`, true);
      resultEl.appendChild(
        el('p', {
          class: 'gp-p dim',
          text: '키·모델 이름을 확인하거나 다른 모델로 다시 시도해 보세요. 모델이 JSON이 아닌 답을 보내면 실패할 수 있습니다.',
        }),
      );
    } finally {
      busy = false;
      // 결과·오류 메시지를 지우지 않도록 버튼 상태만 되돌린다.
      refreshRunState(false);
    }
  }

  function close(): void {
    overlay?.remove();
    overlay = null;
  }

  function open(): void {
    if (overlay) return;
    syncFromDOM();
    settings = loadSettings();

    askInput = el('textarea', {
      class: 'gp-ask',
      rows: '2',
      placeholder: '예) 실험 대신 자료 해석 중심으로, 성찰 질문 2개 추가해 줘 (선택)',
      spellcheck: 'false',
    }) as HTMLTextAreaElement;

    statusEl = el('div', { class: 'gp-status' });
    resultEl = el('div', { class: 'gp-out' });

    runBtn = el('button', {
      class: 'gp-btn primary big',
      html: Icons.spark + '<span>초안 분석 → 요청문 만들기</span>',
      onclick: () => void run(),
    }) as HTMLButtonElement;

    const digestBtn = el('button', {
      class: 'gp-btn ghost',
      text: '보낼 내용 미리보기',
      onclick: () => {
        const pre = $('#gpDigest') as HTMLElement | null;
        if (pre) pre.classList.toggle('open');
      },
    });

    const digest = el('pre', {
      class: 'gp-digest',
      id: 'gpDigest',
      text: JSON.stringify(buildDigest(store.state), null, 1),
    });

    const card = el('div', { class: 'gp-card' }, [
      el('div', { class: 'gp-head' }, [
        el('div', {}, [
          el('h3', { text: '워크시트그랩으로 완성' }),
          el('p', {
            class: 'gp-sub',
            text: '빌더로 만든 1차 초안을 AI가 분석해, worksheet-grab에 그대로 넣을 요청문을 만듭니다.',
          }),
        ]),
        el('button', { class: 'gp-x', html: '&times;', title: '닫기', onclick: close }),
      ]),
      buildSettings(),
      field('덧붙일 요청 (선택)', askInput),
      el('div', { class: 'gp-actions' }, [runBtn, digestBtn]),
      digest,
      statusEl,
      resultEl,
    ]);

    overlay = el('div', {
      class: 'gp-overlay',
      onclick: (e: Event) => {
        if (e.target === overlay) close();
      },
    }, [card]);

    document.body.appendChild(overlay);
    refreshRunState();
    if (plan) resultEl.appendChild(renderResult(plan));
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay) close();
  });

  return { open, close };
}
