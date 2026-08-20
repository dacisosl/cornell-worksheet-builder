/**
 * 워크시트그랩(worksheet-grab) 연계 — 빌더에서 만든 1차 학습지를 분석해
 * 워크시트그랩에 그대로 넣을 수 있는 요청문·명령을 만든다.
 *
 * 흐름:  빌더에서 1차 제작  →  (여기) AI 분석  →  워크시트그랩이 완성
 *
 * 아키타입·교과 목록은 worksheet-grab(MIT) 저장소의 blocks/archetypes.json 을 옮겨 온 것이다.
 * https://github.com/pblsketch/worksheet-grab
 */

import { CONTENT_H } from '../constants';
import type { AppState, Block } from '../types';

/** worksheet-grab 교과 코드 → 사람이 읽는 이름 */
export const GRAB_SUBJECTS: Record<string, string> = {
  korean: '국어',
  english: '영어',
  math: '수학',
  science: '과학',
  social: '사회',
};

/** worksheet-grab 활동 구조(아키타입) 카탈로그 */
export const GRAB_ARCHETYPES: { id: string; name: string; subjects: string[]; desc: string }[] = [
  { id: 'experimental-inquiry', name: '실험탐구', subjects: ['science', 'social'], desc: '문제 → 예상 → 조건·변인 설계 → 관찰·측정·기록 → 시각화 → 해석 → 정리' },
  { id: 'data-interpretation', name: '자료해석', subjects: ['social', 'science'], desc: '자료 제시 → 관찰 → 정리·비교 → 시간/공간 시각화 → 해석 → 정리' },
  { id: 'reading-comprehension', name: '읽기·독해', subjects: ['korean', 'english'], desc: '지문/대화 제시 → 내용 이해 → 어휘·표현 정리 → 추론·적용 → 정리' },
  { id: 'discussion-decision', name: '토론·의사결정', subjects: ['korean', 'social'], desc: '논제 확인 → 찬반 근거 → 상호 반박 → 합의·의사결정 → 성찰' },
  { id: 'concept-structuring', name: '개념구조화', subjects: ['science', 'social', 'korean'], desc: '핵심 개념 확인 → 비교·분류 → 관계 구조화 → 적용 → 정리' },
  { id: 'project-making', name: '프로젝트·제작', subjects: ['*'], desc: '목표 → 계획 → 자료 수집·제작 → 발표·평가 → 성찰' },
  { id: 'vocabulary-concept', name: '어휘·개념 정리', subjects: ['*'], desc: '개념 확인 → 프레이어 → 5W1H 분석 → 핵심 아이디어 정리 → 성찰' },
  { id: 'kwl-inquiry', name: 'KWL 탐구', subjects: ['*'], desc: '배경지식 활성화(KWL) → 자료 제시 → 탐구 문항 → 처음·중간·끝 정리 → 점검' },
  { id: 'writing-plan', name: '글쓰기·성찰', subjects: ['*'], desc: '자료·생각 정리 → 관점 비교 → 문단 쓰기 계획 → 성찰' },
  { id: 'concept-visual', name: '개념 시각화', subjects: ['*'], desc: '벤다이어그램 → 개념 지도 → 피시본(원인·결과) → 성찰' },
  { id: 'process-structure', name: '과정·구조', subjects: ['*'], desc: '순서 흐름도 → 위계 트리 → 적용 문항 → 성찰' },
  { id: 'literary-response', name: '독서·문학 반응', subjects: ['*'], desc: '북 리뷰 → 인물 분석 → 인용 저널 → 에세이 계획' },
  { id: 'landscape-organizer', name: '가로 한 장 조직자', subjects: ['*'], desc: '가로 용지 한 장에 시각 조직자 하나를 크게' },
  { id: 'concept-example-practice', name: '개념·예제·연습', subjects: ['math'], desc: '핵심 개념 → 예제 풀이 따라가기 → 쌍둥이 문제 → 연습 → 좌표평면 그래프' },
];

/** AI가 돌려줄 분석 결과 */
export interface GrabPlan {
  subject: string;
  subjectLabel: string;
  gradeBand: string;
  topic: string;
  archetype: string;
  archetypeReason: string;
  objectives: string[];
  standardsKeywords: string[];
  summary: string;
  gaps: string[];
  grabPrompt: string;
  cliCommand: string;
  blockNotes: { n: number; note: string }[];
}

const MAX_FIELD_CHARS = 700;

function plain(html: string): string {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  const t = (d.textContent ?? '').replace(/\s+/g, ' ').trim();
  return t.length > MAX_FIELD_CHARS ? t.slice(0, MAX_FIELD_CHARS) + '…' : t;
}

function a4Fraction(h: number): string {
  return (h / CONTENT_H).toFixed(2);
}

function blockDigest(b: Block, i: number): Record<string, unknown> {
  const imgs = 'imgs' in b ? (b.imgs ?? []) : [];
  const d: Record<string, unknown> = {
    n: i + 1,
    type: b.type,
    a4비율: a4Fraction(b.h),
    제목: b.title || '',
    칩: b.tagHidden ? '(숨김)' : (b.tagLabel ?? ''),
    제목행숨김: !!b.titleHidden,
    이미지: imgs.length
      ? imgs.map((im) => ({
          폭비율: +im.w.toFixed(2),
          가로세로비: +im.ar.toFixed(2),
          위치: [+im.x.toFixed(2), +im.y.toFixed(2)],
          그룹: im.g ?? null,
        }))
      : [],
  };

  if (b.type === 'problem' || b.type === 'mock') {
    d.문제칸 = plain(b.probHtml);
    d.풀이칸 = plain(b.solHtml);
    d.문제풀이비율 = +b.ratio.toFixed(2);
    d.배경 = { 문제: b.probBg, 풀이: b.solBg };
  } else if (b.type === 'concept') {
    d.설명칸 = plain(b.exHtml);
    d.이미지칸텍스트 = plain(b.imgHtml);
    d.이미지칸배치 = b.imgMode;
    d.배경 = b.exBg;
  } else {
    d.텍스트 = plain(b.html ?? '');
    d.폭 = b.width;
  }
  return d;
}

/** 1차 제작본을 AI가 읽을 수 있는 구조 요약으로 만든다 (이미지 자체는 보내지 않는다). */
export function buildDigest(state: AppState): Record<string, unknown> {
  const totalH = state.blocks.reduce((a, b) => a + b.h, 0);
  return {
    제목: state.meta.title || '(제목 없음)',
    이어서제목: state.meta.contTitle || '',
    헤더표시: state.meta.showHead,
    필기용여백: state.meta.note.on ? `${state.meta.note.margin}mm` : '끔',
    블록수: state.blocks.length,
    대략쪽수: Math.max(1, Math.ceil(totalH / CONTENT_H)),
    블록: state.blocks.map(blockDigest),
  };
}

export const SYSTEM_PROMPT = `당신은 한국 초·중·고 교사의 활동지 제작을 돕는 조력자입니다.

교사는 "코넬 학습지 빌더"라는 웹 도구로 활동지 **1차 초안**(레이아웃·문항 뼈대·이미지 배치)을 만들었습니다.
이제 그 초안을 **worksheet-grab**(로컬 Node CLI + AI 도구 오케스트레이션)으로 넘겨 완성하려 합니다.

worksheet-grab에 대해 알아야 할 것:
- 교사가 AI 도구(클로드 코드·코덱스 등)에게 자연어로 요청하면, AI가 worksheet-grab CLI를 돌려
  학생용·교사용 활동지 HTML/PDF 2벌을 만듭니다.
- 성취기준은 worksheet-grab이 자체 CSV에서 **조회**합니다. 따라서 성취기준 코드를 절대 지어내지 마세요.
  대신 조회에 쓸 주제 키워드만 주세요.
- 교과 코드: korean(국어) · english(영어) · math(수학) · science(과학) · social(사회)
- 활동 구조(아키타입)는 아래 목록 중에서만 고릅니다.
- 주요 명령:
  · node bin/worksheet-grab.js pipeline <학년교과> <주제> --out out/       (표준 주제 한 번에)
  · node bin/worksheet-grab.js compose <학년교과> <주제> --archetype <id> --out out/   (맞춤 구조)
  · node bin/worksheet-grab.js generate <학년교과> <주제> --objectives "목표1|목표2" --pdf
  · node bin/worksheet-grab.js edit <manifest.json> "<수정 지시>" --out out/
  <학년교과>는 "중2과학"처럼 붙여 쓰거나 "중2 과학"처럼 띄어 씁니다.

원칙:
- 초안에 실제로 있는 내용만 근거로 삼습니다. 없는 문항 내용을 지어내 채우지 마세요.
- 초안이 비어 있으면 비어 있다고 말하고, 무엇을 채워야 하는지 gaps에 적습니다.
- 학생 실명·개인정보는 다루지 않습니다.

반드시 아래 형태의 **JSON 객체 하나만** 출력하세요. 설명 문장이나 코드펜스를 덧붙이지 마세요.

{
  "subject": "교과 코드",
  "subjectLabel": "교과 한글 이름",
  "gradeBand": "예: 중2 (초안에서 알 수 없으면 빈 문자열)",
  "topic": "핵심 주제 (짧은 명사구)",
  "archetype": "아키타입 id",
  "archetypeReason": "그 구조를 고른 이유 한 문장",
  "objectives": ["학습목표 문장", "..."],
  "standardsKeywords": ["성취기준 조회용 키워드", "..."],
  "summary": "1차 초안이 어떤 활동지인지 2~3문장 요약",
  "gaps": ["완성하려면 채워야 할 것", "..."],
  "grabPrompt": "worksheet-grab 폴더를 연 AI 도구에 교사가 그대로 붙여넣을 요청문. 초안의 구조(블록 순서·칸 배치·이미지 자리)를 지키라는 지시와 채울 내용을 구체적으로 담을 것. 여러 줄 가능.",
  "cliCommand": "가장 알맞은 worksheet-grab 명령 한 줄",
  "blockNotes": [{ "n": 1, "note": "그 블록을 어떻게 채우거나 고칠지" }]
}`;

export function archetypeCatalog(): string {
  return GRAB_ARCHETYPES.map(
    (a) => `- ${a.id} (${a.name}) · 교과: ${a.subjects.join(',')} · ${a.desc}`,
  ).join('\n');
}

export function buildUserPrompt(state: AppState, extra: string): string {
  return [
    '## 고를 수 있는 활동 구조(아키타입)',
    archetypeCatalog(),
    '',
    '## 교사가 빌더로 만든 1차 초안 (구조 요약)',
    '```json',
    JSON.stringify(buildDigest(state), null, 1),
    '```',
    '',
    '블록 타입 뜻: problem=문제·풀이 가로 2단, mock=모의고사(½폭·세로 2단), concept=개념 설명,',
    'image=이미지 전용 칸. a4비율은 A4 한 쪽 대비 높이입니다.',
    '이미지의 위치·폭비율은 그 칸 안에서의 상대값(0~1)입니다.',
    extra.trim() ? `\n## 교사가 덧붙인 요청\n${extra.trim()}` : '',
  ].join('\n');
}

/** 모델 응답을 화면에 쓸 수 있는 형태로 다듬는다. */
export function normalizePlan(raw: unknown): GrabPlan {
  const o = (raw ?? {}) as Partial<GrabPlan>;
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
  const subject = String(o.subject ?? '').trim();
  return {
    subject,
    subjectLabel: String(o.subjectLabel ?? GRAB_SUBJECTS[subject] ?? '').trim(),
    gradeBand: String(o.gradeBand ?? '').trim(),
    topic: String(o.topic ?? '').trim(),
    archetype: String(o.archetype ?? '').trim(),
    archetypeReason: String(o.archetypeReason ?? '').trim(),
    objectives: strArr(o.objectives),
    standardsKeywords: strArr(o.standardsKeywords),
    summary: String(o.summary ?? '').trim(),
    gaps: strArr(o.gaps),
    grabPrompt: String(o.grabPrompt ?? '').trim(),
    cliCommand: String(o.cliCommand ?? '').trim(),
    blockNotes: Array.isArray(o.blockNotes)
      ? o.blockNotes
          .map((b) => ({ n: Number((b as { n?: unknown }).n) || 0, note: String((b as { note?: unknown }).note ?? '') }))
          .filter((b) => b.note)
      : [],
  };
}

/** 교사가 AI 도구에 붙여넣을 최종 요청문 (분석 결과 + 첨부 안내) */
export function finalPrompt(plan: GrabPlan, attachName: string): string {
  const lines: string[] = [];
  lines.push('https://github.com/pblsketch/worksheet-grab.git 를 클론한 뒤에 아래 작업을 해줘.');
  lines.push('');
  lines.push('# 만들 활동지');
  if (plan.gradeBand || plan.subjectLabel) {
    lines.push(`- 학년·교과: ${[plan.gradeBand, plan.subjectLabel].filter(Boolean).join(' ')}`);
  }
  if (plan.topic) lines.push(`- 주제: ${plan.topic}`);
  if (plan.archetype) {
    const a = GRAB_ARCHETYPES.find((x) => x.id === plan.archetype);
    lines.push(`- 활동 구조(아키타입): ${plan.archetype}${a ? ` (${a.name})` : ''}`);
  }
  if (plan.objectives.length) {
    lines.push('- 학습 목표:');
    plan.objectives.forEach((o) => lines.push(`  · ${o}`));
  }
  if (plan.standardsKeywords.length) {
    lines.push(`- 성취기준 조회 키워드: ${plan.standardsKeywords.join(', ')}`);
    lines.push('  (성취기준은 worksheet-grab이 조회한 것만 쓰고, 코드를 지어내지 말 것)');
  }
  lines.push('');
  lines.push('# 1차 초안 (코넬 학습지 빌더로 만든 것)');
  lines.push(`같은 폴더에 둔 \`${attachName}\` 이 초안입니다. 아래 구조를 지켜 주세요.`);
  if (plan.summary) {
    lines.push('');
    lines.push(plan.summary);
  }
  if (plan.blockNotes.length) {
    lines.push('');
    lines.push('## 블록별 지시');
    plan.blockNotes.forEach((b) => lines.push(`${b.n}. ${b.note}`));
  }
  if (plan.gaps.length) {
    lines.push('');
    lines.push('## 채워야 할 것');
    plan.gaps.forEach((g) => lines.push(`- ${g}`));
  }
  lines.push('');
  lines.push('# 마무리');
  lines.push('- 학생용·교사용 2벌로 내보내 주세요. 학생용에는 정답이 남지 않아야 합니다.');
  if (plan.cliCommand) {
    lines.push(`- 참고 명령: \`${plan.cliCommand}\``);
  }
  if (plan.grabPrompt) {
    lines.push('');
    lines.push('# 세부 요청');
    lines.push(plan.grabPrompt);
  }
  return lines.join('\n');
}
