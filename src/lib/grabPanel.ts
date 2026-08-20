/**
 * "워크시트그랩으로 완성" 패널 —
 * 1차 초안 분석 → 요청문·명령 생성 → 복사·내려받기.
 */

import {
  CURATED_MODELS,
  fetchLatestCurated,
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
  normalizeCourse,
  normalizePlan,
  schoolOf,
  type GrabPlan,
} from './grabBridge';
import { AUTHOR_SYSTEM, applyAuthored, buildAuthorPrompt } from './grabAuthor';
import type { ComposeResult, GrabManifest } from './grabRuntime';
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
  let built: BuiltWorksheet | null = null;
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
    const CUSTOM = '__custom__';

    // 추천 모델은 셀렉트로 바로 고르고, '직접 입력'을 고르면 자유 입력이 열린다.
    const modelSelect = el('select', { class: 'gp-input gp-select' }) as HTMLSelectElement;
    const modelInput = el('input', {
      class: 'gp-input',
      value: settings.models[settings.provider],
      placeholder: '모델 이름 직접 입력',
      style: 'display:none',
      oninput: (e: Event) => {
        settings.models[settings.provider] = (e.target as HTMLInputElement).value;
        saveSettings(settings);
      },
    }) as HTMLInputElement;

    const modelList = el('datalist', { id: 'gpModels' }) as HTMLDataListElement;
    modelInput.setAttribute('list', 'gpModels');

    // OpenRouter 는 실시간 목록으로 갱신된 추천을 쓴다 (실패 시 정적 폴백)
    let liveCurated: typeof CURATED_MODELS.openrouter | null = null;

    function fillModelSelect(): void {
      const cur = settings.models[settings.provider];
      const curated =
        settings.provider === 'openrouter' && liveCurated?.length
          ? liveCurated
          : CURATED_MODELS[settings.provider];
      modelSelect.innerHTML = '';
      curated.forEach((m) => {
        modelSelect.appendChild(
          el('option', { value: m.id, text: `${m.label} — ${m.note}` }),
        );
      });
      modelSelect.appendChild(el('option', { value: CUSTOM, text: '직접 입력…' }));
      const inList = curated.some((m) => m.id === cur);
      modelSelect.value = inList ? cur : CUSTOM;
      modelInput.style.display = inList ? 'none' : '';
      modelInput.value = cur;
    }

    // 백그라운드로 최신 모델을 받아 추천 목록을 갈아 끼운다 — 목록이 낡지 않게.
    void fetchLatestCurated().then((list) => {
      if (!list?.length) return;
      liveCurated = list;
      if (settings.provider === 'openrouter') fillModelSelect();
    });

    modelSelect.addEventListener('change', () => {
      if (modelSelect.value === CUSTOM) {
        modelInput.style.display = '';
        modelInput.focus();
        return;
      }
      modelInput.style.display = 'none';
      settings.models[settings.provider] = modelSelect.value;
      saveSettings(settings);
    });
    fillModelSelect();

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
      fillModelSelect();
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
      text: '전체 모델 불러오기',
      onclick: async () => {
        loadBtn.disabled = true;
        const old = loadBtn.textContent;
        loadBtn.textContent = '불러오는 중…';
        try {
          const ids = await listModels(settings.provider, activeKey(settings));
          modelList.innerHTML = '';
          ids.forEach((id) => modelList.appendChild(el('option', { value: id })));
          loadBtn.textContent = `${ids.length}개`;
          // 전체 목록은 직접 입력 칸의 자동완성으로 제공한다.
          modelSelect.value = CUSTOM;
          modelInput.style.display = '';
          modelInput.focus();
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
        field(
          '모델',
          el('div', { class: 'gp-model' }, [
            el('div', { class: 'gp-inline' }, [modelSelect, loadBtn]),
            modelInput,
            modelList,
          ]),
          '본문 저작 품질이 아쉬우면 Claude·GPT·Gemini Pro 같은 상위 모델을 고르세요.',
        ),
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
  let promptBtn!: HTMLButtonElement;
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
    const blocked = busy || !hasKey || !hasBlocks;
    runBtn.disabled = blocked;
    promptBtn.disabled = blocked;
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

  /** 빌더 안에서 완성한 결과 */
  interface BuiltWorksheet {
    manifest: GrabManifest;
    student: string;
    teacher: string;
    filled: number;
    skipped: number;
    leak: boolean;
    findings: string[];
  }

  /** 학생용/교사용 HTML을 새 창에서 연다 (인쇄로 PDF 저장). */
  function openHtml(html: string, label: string): void {
    const w = window.open('', '_blank');
    if (!w) {
      setStatus('팝업이 막혀 있어요. 브라우저에서 팝업을 허용하거나 HTML을 내려받아 여세요.', true);
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.document.title = `${safeTitle()}_${label}`;
  }

  function renderBuilt(b: BuiltWorksheet): HTMLElement {
    const frame = el('iframe', { class: 'gp-preview', title: '학생용 미리보기' }) as HTMLIFrameElement;
    // srcdoc 은 별도 문서라 빌더 CSS와 섞이지 않는다.
    frame.srcdoc = b.student;

    const tab = (label: string, html: string, on = false) =>
      el('button', {
        class: 'gp-tab' + (on ? ' on' : ''),
        text: label,
        onclick: (e: Event) => {
          const bar = (e.target as HTMLElement).parentElement;
          [...(bar?.children ?? [])].forEach((c) => c.classList.remove('on'));
          (e.target as HTMLElement).classList.add('on');
          frame.srcdoc = html;
        },
      });

    return el('div', { class: 'gp-result' }, [
      section('완성된 활동지', [
        el('div', { class: 'gp-chips' }, [
          chip(`블록 ${b.filled}칸 저작`),
          b.skipped ? chip(`${b.skipped}칸은 뼈대 유지`) : null,
          b.leak ? chip('정답 누출 경고') : chip('정답 분리 확인'),
        ].filter(Boolean) as HTMLElement[]),
        b.findings.length
          ? el('ul', { class: 'gp-ul' }, b.findings.slice(0, 6).map((f) => el('li', { text: f })))
          : null,
        el('div', { class: 'gp-tabs' }, [tab('학생용', b.student, true), tab('교사용', b.teacher)]),
        frame,
        el('div', { class: 'gp-actions' }, [
          el('button', {
            class: 'gp-btn primary',
            text: '학생용 열기 · 인쇄',
            onclick: () => openHtml(b.student, '학생용'),
          }),
          el('button', {
            class: 'gp-btn ghost',
            text: '교사용 열기 · 인쇄',
            onclick: () => openHtml(b.teacher, '교사용'),
          }),
          el('button', {
            class: 'gp-btn ghost',
            text: '학생용 HTML 저장',
            onclick: () => download(`${safeTitle()}-student.html`, b.student, 'text/html'),
          }),
          el('button', {
            class: 'gp-btn ghost',
            text: '교사용 HTML 저장',
            onclick: () => download(`${safeTitle()}-teacher.html`, b.teacher, 'text/html'),
          }),
          el('button', {
            class: 'gp-btn ghost',
            text: '매니페스트 저장',
            onclick: () =>
              download(
                `${safeTitle()}.manifest.json`,
                JSON.stringify(b.manifest, null, 2),
                'application/json',
              ),
          }),
        ]),
        el('p', {
          class: 'gp-hint',
          html:
            '열린 창에서 <b>Ctrl+P</b> 로 A4 PDF로 저장합니다. 매니페스트를 저장해 두면 ' +
            'worksheet-grab 의 <code>edit</code>·<code>doc</code> 명령으로 이어서 다듬을 수 있어요.',
        }),
      ]),
    ]);
  }

  type GrabEngine = typeof import('./grabRuntime');

  /**
   * 엔진 조립을 실패 없이 통과시키는 호출 체인.
   * 교사가 세부 정보를 채우지 않아도, 분석 결과와 성취기준 CSV로 알아서 해결한다.
   *
   *  1차: AI가 정한 세부 과목(고교 수학이면 course)으로 그대로 조립
   *  2차: 세부 과목이 없거나 거부되면 — CSV에서 키워드로 성취기준을 직접 찾아 코드로 조립
   *  3차: 코드도 못 찾으면 — 학년에 맞는 기본 과목으로 조립 (고1→공통수학1, 그 외→대수)
   *  덤 : 아키타입이 그 교과에 안 맞으면 엔진 추천으로 되돌린다
   */
  async function composeResilient(engine: GrabEngine, plan: GrabPlan): Promise<ComposeResult> {
    const grade = plan.gradeBand || (plan.course ? '고1' : '중2');
    const school = schoolOf(grade);
    const baseSubject = plan.subjectLabel || '과학';
    const course = normalizeCourse(plan.course);
    const topic = plan.topic || store.state.meta.title || '활동';
    const isHighMath = school === '고등학교' && plan.subject === 'math';

    const attempt = (subject: string, codes: string[] | null, archetype: string | null) =>
      engine.compose({
        grade,
        subject,
        topic,
        archetype,
        codes,
        objectives: plan.objectives,
      });

    /** 아키타입 불일치는 어느 단계에서든 엔진 추천으로 한 번 되돌린다. */
    const withArchetypeFallback = async (
      subject: string,
      codes: string[] | null,
    ): Promise<ComposeResult> => {
      try {
        return await attempt(subject, codes, plan.archetype || null);
      } catch (err) {
        if (!(err as Error).message.includes('아키타입')) throw err;
        return attempt(subject, codes, null);
      }
    };

    // 1차 — AI가 정한 과목 그대로
    try {
      return await withArchetypeFallback(course || baseSubject, null);
    } catch (err1) {
      // 2차 — 성취기준을 CSV에서 직접 찾아 코드로 지정 (코드가 있으면 세부 과목 요구가 풀린다)
      const codes: string[] = [];
      const seen = new Set<string>();
      for (const kw of [...plan.standardsKeywords, topic]) {
        if (codes.length >= 6) break;
        const rows = await engine.searchStandards({
          school: school || undefined,
          subject: baseSubject,
          keyword: kw,
          limit: 6 - codes.length,
        });
        rows.forEach((r) => {
          if (!seen.has(r.code)) {
            seen.add(r.code);
            codes.push(r.code);
          }
        });
      }
      if (codes.length) {
        try {
          return await withArchetypeFallback(baseSubject, codes);
        } catch {
          /* 3차로 넘어간다 */
        }
      }

      // 3차 — 학년 기본 과목 (고교 수학에서만 의미가 있다)
      if (isHighMath) {
        const fallback = /고\s*1/.test(grade) ? '공통수학1' : '대수';
        return withArchetypeFallback(fallback, null);
      }
      throw err1;
    }
  }

  /** 분석 → 구조 조립 → 본문 저작 → 검수 → 2벌. 전 과정을 빌더 안에서 끝낸다. */
  async function runFull(): Promise<void> {
    if (busy) return;
    syncFromDOM();
    store.save();
    busy = true;
    refreshRunState(false);
    resultEl.innerHTML = '';
    built = null;

    try {
      // 1) 초안 분석
      setStatus('1/4 초안을 분석하는 중…');
      const analyzed = await analyze();
      plan = analyzed;

      // 2) 활동 구조 — 벤더 엔진이 결정적으로 만든다 (성취기준도 여기서 조회)
      // 엔진·블록 라이브러리·성취기준은 이 기능을 쓸 때만 내려받는다(첫 화면을 가볍게).
      setStatus('2/4 활동 구조를 짜고 성취기준을 찾는 중…');
      const engine = await import('./grabRuntime');
      const composed: ComposeResult = await composeResilient(engine, analyzed);

      // 3) 본문 저작
      setStatus('3/4 초안 내용을 살려 본문을 채우는 중…');
      const authoredText = await complete(settings, {
        system: AUTHOR_SYSTEM,
        user: buildAuthorPrompt(composed, buildDigest(store.state), analyzed.objectives, askInput.value),
        json: true,
      });
      let authored: { blocks?: { i?: number; html?: string }[] };
      try {
        authored = parseJsonLoose(authoredText);
      } catch {
        throw new Error('본문 저작 결과가 JSON이 아니었습니다. 다른 모델로 다시 시도해 보세요.');
      }
      const { manifest, filled, skipped } = applyAuthored(composed.manifest, authored);

      // 4) 조립 · 검수 · 2벌
      setStatus('4/4 활동지를 조립하고 검수하는 중…');
      const html = await engine.assemble(manifest);
      const check = await engine.validate(html);
      const { student, teacher } = engine.variants(html);

      const findings = check.findings
        .map((f) => String(f.message ?? JSON.stringify(f)))
        .filter(Boolean);

      built = { manifest, student, teacher, filled, skipped, leak: !check.ok, findings };
      resultEl.appendChild(renderBuilt(built));
      resultEl.appendChild(renderResult(analyzed));
      setStatus(
        check.ok
          ? '완성했어요. 학생용·교사용을 확인하고 인쇄하세요.'
          : '완성했지만 검수 경고가 있어요. 교사용을 확인한 뒤 배포하세요.',
        !check.ok,
      );
    } catch (err) {
      setStatus(`완성 실패: ${(err as Error).message}`, true);
    } finally {
      busy = false;
      refreshRunState(false);
    }
  }

  /** 1차 초안을 분석해 교과·주제·구조를 뽑는다. */
  async function analyze(): Promise<GrabPlan> {
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
    return normalizePlan(parsed);
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
      plan = await analyze();
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
      html: Icons.spark + '<span>이 자리에서 완성하기</span>',
      title: '분석 → 활동 구조 → 본문 저작 → 검수 → 학생용·교사용 2벌까지 빌더 안에서 끝냅니다',
      onclick: () => void runFull(),
    }) as HTMLButtonElement;

    promptBtn = el('button', {
      class: 'gp-btn ghost',
      text: '요청문만 만들기',
      title: 'worksheet-grab CLI(PDF·워크스페이스)까지 쓰고 싶을 때 붙여넣을 요청문을 만듭니다',
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
            text:
              '빌더로 만든 1차 초안을 AI가 분석하고, 내장된 worksheet-grab 엔진이 활동 구조를 짭니다. ' +
              '본문을 채워 학생용·교사용 2벌까지 이 자리에서 만듭니다.',
          }),
        ]),
        el('button', { class: 'gp-x', html: '&times;', title: '닫기', onclick: close }),
      ]),
      buildSettings(),
      field('덧붙일 요청 (선택)', askInput),
      el('div', { class: 'gp-actions' }, [runBtn, promptBtn, digestBtn]),
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
    if (built) resultEl.appendChild(renderBuilt(built));
    if (plan) resultEl.appendChild(renderResult(plan));
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay) close();
  });

  return { open, close };
}
