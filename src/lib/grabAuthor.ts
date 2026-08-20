/**
 * 저작 단계 — worksheet-grab 이 만든 "저작 대기" 스캐폴드의 각 블록을
 * 1차 초안 내용에 맞춰 AI가 채운다.
 *
 * 엔진(벤더 코어)은 구조만 결정하고, 교육적 본문은 여기서 저작한다 — 상류 설계와 같은 분담이다.
 */

import type { ComposeResult, GrabBlock, GrabManifest, StandardRow } from './grabRuntime';

export interface AuthorSlot {
  i: number;
  type: string;
  role: string;
  authoring: string;
  html: string;
}

/** 스캐폴드를 "채워야 할 칸" 목록으로 편다. gen 블록(자동 생성)은 건너뛴다. */
export function authorSlots(res: ComposeResult): AuthorSlot[] {
  const briefBlocks = (res.brief.pages ?? []).flat();
  const slots: AuthorSlot[] = [];
  res.manifest.pages.flat().forEach((b, i) => {
    if (b.gen || typeof b.html !== 'string') return;
    const brief = briefBlocks[i];
    slots.push({
      i,
      type: b.type,
      role: brief?.role ?? '',
      authoring: brief?.authoring ?? '',
      html: b.html,
    });
  });
  return slots;
}

export const AUTHOR_SYSTEM = `당신은 한국 초·중·고 교사의 활동지 본문을 저작합니다.

worksheet-grab 엔진이 활동 구조(블록 순서와 HTML 뼈대)를 이미 정해 두었습니다.
당신의 일은 각 블록의 **자리표시 문구를 실제 수업 내용으로 바꾸는 것**입니다.

지켜야 할 규칙:
1. **태그와 class 를 절대 바꾸지 마세요.** 구조는 그대로 두고 글자만 바꿉니다.
   (class 이름·중첩 구조·빈 <span></span> 은 인쇄 레이아웃이라 건드리면 깨집니다.)
2. 새 class 나 style 속성, 색상 지정을 넣지 마세요. 교과색은 테마가 정합니다.
3. 정답·모범답안은 반드시 class="answer" 안에만 넣습니다.
   학생용에서는 이 부분이 물리적으로 제거됩니다. 밖에 쓰면 정답이 새어 학생용 출력이 막힙니다.
4. 교사가 만든 1차 초안에 이미 있는 문장·문항은 **그대로 살려** 해당 블록에 배치합니다.
   초안에 없는 사실을 지어내지 말고, 학년 수준에 맞게 다듬기만 합니다.
5. 성취기준 원문은 엔진이 넣습니다. 성취기준 코드를 새로 쓰지 마세요.
6. 실존 작품의 원문(시·소설 등)을 옮기지 말고, 필요하면 자리표시 문구를 남깁니다.
7. 학생 실명이나 개인정보를 쓰지 않습니다.

출력은 아래 형태의 **JSON 객체 하나만**. 설명이나 코드펜스를 붙이지 마세요.

{ "blocks": [ { "i": 0, "html": "<채운 HTML>" }, ... ] }

i 는 주어진 블록의 번호 그대로입니다. 채우지 않을 블록은 목록에서 빼면 원본이 유지됩니다.`;

export function buildAuthorPrompt(
  res: ComposeResult,
  digest: Record<string, unknown>,
  objectives: string[],
  extra: string,
): string {
  const std = res.standards
    .map((s: StandardRow) => `- ${s.code} ${s.text}`)
    .join('\n');

  const slots = authorSlots(res)
    .map(
      (s) =>
        `### ${s.i} · ${s.type}${s.role ? ` (${s.role})` : ''}\n${s.authoring}\n\`\`\`html\n${s.html.trim()}\n\`\`\``,
    )
    .join('\n\n');

  return [
    `## 만들 활동지`,
    `- 제목: ${res.manifest.docTitle ?? ''}`,
    `- 교과: ${res.subjectLabel} · 활동 구조: ${res.archetype}`,
    objectives.length ? `- 학습 목표:\n${objectives.map((o) => `  · ${o}`).join('\n')}` : '',
    '',
    std ? `## 근거 성취기준 (엔진이 조회한 원문 — 참고용)\n${std}` : '',
    '',
    '## 교사가 빌더로 만든 1차 초안',
    '이 내용을 살려서 아래 블록에 배치하세요.',
    '```json',
    JSON.stringify(digest, null, 1),
    '```',
    '',
    '## 채울 블록',
    slots,
    extra.trim() ? `\n## 교사가 덧붙인 요청\n${extra.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** 모델이 돌려준 블록 HTML을 스캐폴드에 덮어쓴다. 구조가 의심스러우면 원본을 유지한다. */
export function applyAuthored(
  manifest: GrabManifest,
  authored: { blocks?: { i?: number; html?: string }[] },
): { manifest: GrabManifest; filled: number; skipped: number } {
  const next: GrabManifest = JSON.parse(JSON.stringify(manifest)) as GrabManifest;
  const flat: GrabBlock[] = [];
  next.pages.forEach((page) => page.forEach((b) => flat.push(b)));

  let filled = 0;
  let skipped = 0;
  for (const item of authored.blocks ?? []) {
    const i = Number(item.i);
    const html = item.html;
    const target = flat[i];
    if (!Number.isInteger(i) || !target || typeof html !== 'string' || !html.trim()) {
      skipped++;
      continue;
    }
    if (target.gen) {
      // 자동 생성 블록은 저작 대상이 아니다.
      skipped++;
      continue;
    }
    if (!sameShape(String(target.html ?? ''), html)) {
      skipped++;
      continue;
    }
    target.html = html;
    filled++;
  }
  return { manifest: next, filled, skipped };
}

/**
 * 뼈대가 유지됐는지 확인한다 — 태그 이름 순서와 class 목록이 같아야 한다.
 * (모델이 구조를 바꿔 버리면 인쇄 레이아웃이 깨지므로 그 블록은 원본을 쓴다.)
 */
function sameShape(a: string, b: string): boolean {
  const sig = (html: string): string => {
    const tags: string[] = [];
    for (const m of html.matchAll(/<([a-zA-Z][\w-]*)([^>]*)>/g)) {
      const cls = /class\s*=\s*"([^"]*)"/.exec(m[2]);
      tags.push(cls ? `${m[1]}.${cls[1].trim().split(/\s+/).sort().join('.')}` : m[1]);
    }
    return tags.join('>');
  };
  const sa = sig(a);
  const sb = sig(b);
  if (sa === sb) return true;
  // 정답 블록을 새로 넣는 것은 허용한다 (원본에 없던 .answer 추가).
  return sb.replace(/>?[a-z]+\.answer[^>]*/g, '') === sa;
}
