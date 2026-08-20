/**
 * worksheet-grab 브라우저 런타임 —
 * 상류가 포트&어댑터 구조라 코어(조립·검수·2벌)는 파일시스템을 모른다.
 * 여기서 파일시스템 어댑터 자리에 **번들된 자산 맵**을 끼워 넣어 브라우저에서 그대로 돌린다.
 *
 *   FsBlockRepository   → BundledBlockRepository (Vite ?raw 글롭)
 *   GepaiCurriculum     → CsvCurriculum (성취기준 CSV, 필요할 때만 내려받음)
 *   ChromeRenderer      → 없음 (브라우저 인쇄로 대체)
 */

import {
  AssembleWorksheet,
  BuildVariants,
  ComposeWorksheet,
  ValidateWorksheet,
} from './grabCore';

/** 파일 경로 → 내용. 키는 vendor 폴더 기준 상대 경로로 정규화한다. */
type RawMap = Record<string, string>;

function normalize(map: Record<string, string>, prefix: string): RawMap {
  const out: RawMap = {};
  for (const [k, v] of Object.entries(map)) {
    const i = k.indexOf(prefix);
    out[i >= 0 ? k.slice(i + prefix.length) : k] = v;
  }
  return out;
}

const blockFiles = normalize(
  import.meta.glob('../vendor/worksheet-grab/blocks/**/*.html', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>,
  'blocks/',
);

const themeFiles = normalize(
  import.meta.glob('../vendor/worksheet-grab/themes/**/*.css', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>,
  'themes/',
);

const assetFiles = normalize(
  import.meta.glob('../vendor/worksheet-grab/assets/*.css', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>,
  'assets/',
);

const templateFiles = normalize(
  import.meta.glob('../vendor/worksheet-grab/templates/*.json', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>,
  'templates/',
);

import vocabularyRaw from '../vendor/worksheet-grab/blocks/vocabulary.json?raw';
import archetypesRaw from '../vendor/worksheet-grab/blocks/archetypes.json?raw';

const VOCABULARY = JSON.parse(vocabularyRaw) as Record<string, unknown>;
const ARCHETYPES = JSON.parse(archetypesRaw) as Record<string, unknown>;

/** 번들된 블록·테마·에셋을 파일시스템처럼 내주는 저장소. */
class BundledBlockRepository {
  async readAsset(name: string): Promise<string> {
    const v = assetFiles[name];
    if (v == null) {
      // 벤더 폰트·KaTeX 는 담지 않았다 — 코어가 CDN 경로로 되돌아간다.
      throw new Error(`에셋 없음: ${name}`);
    }
    return v;
  }

  async readAssetBytes(name: string): Promise<Uint8Array> {
    throw new Error(`바이너리 에셋은 번들에 없습니다: ${name}`);
  }

  async loadBlockHtml(file: string): Promise<string> {
    const v = blockFiles[file] ?? blockFiles[file.replace(/^.*\/(?=[^/]+\/[^/]+$)/, '')];
    if (v == null) throw new Error(`블록 없음: ${file}`);
    return v;
  }

  async listBlocks(): Promise<string[]> {
    return Object.keys(blockFiles);
  }

  async loadThemeCss(name: string): Promise<string> {
    const file = name.endsWith('.css') ? name : `${name}.css`;
    const v = themeFiles[file];
    if (v == null) throw new Error(`테마 없음: ${name}`);
    return v;
  }

  async listThemes(): Promise<string[]> {
    return Object.keys(themeFiles)
      .filter((f) => !f.startsWith('moods/'))
      .map((f) => f.replace(/\.css$/, ''));
  }

  async loadMoodCss(name: string): Promise<string> {
    const v = themeFiles[`moods/${name}.css`];
    if (v == null) throw new Error(`무드 없음: ${name}`);
    return v;
  }

  async listMoods(): Promise<string[]> {
    return Object.keys(themeFiles)
      .filter((f) => f.startsWith('moods/'))
      .map((f) => f.slice('moods/'.length).replace(/\.css$/, ''));
  }

  async readManifest(): Promise<never> {
    throw new Error('브라우저 런타임은 매니페스트를 파일에서 읽지 않습니다.');
  }

  async readTemplate(name: string): Promise<unknown> {
    const file = name.endsWith('.json') ? name : `${name}.json`;
    const v = templateFiles[file];
    if (v == null) throw new Error(`템플릿 없음: ${name}`);
    return JSON.parse(v);
  }

  async readVocabulary(): Promise<Record<string, unknown>> {
    return VOCABULARY;
  }

  async readArchetypes(): Promise<Record<string, unknown>> {
    return ARCHETYPES;
  }
}

export interface StandardRow {
  code: string;
  text: string;
  subject: string;
  school: string;
  grade: string;
}

/** 성취기준 CSV(548KB) — 처음 필요할 때 한 번만 내려받아 메모리에 둔다. */
class CsvCurriculum {
  private rows: StandardRow[] | null = null;

  private async load(): Promise<StandardRow[]> {
    if (this.rows) return this.rows;
    const mod = await import('../vendor/worksheet-grab/data/achievement-standards.csv?raw');
    this.rows = parseCsv(mod.default);
    return this.rows;
  }

  /** 전체 행 — 내용 기반 검색용 */
  async all(): Promise<StandardRow[]> {
    return this.load();
  }

  async resolve(code: string): Promise<StandardRow | null> {
    const rows = await this.load();
    const want = code.replace(/[[\]]/g, '');
    return rows.find((r) => r.code.replace(/[[\]]/g, '') === want) ?? null;
  }

  async search(query: {
    school?: string;
    subject?: string;
    grade?: string;
    keyword?: string;
    limit?: number;
  }): Promise<StandardRow[]> {
    const rows = await this.load();
    const { school, subject, keyword, limit = 6 } = query;
    const hit = rows.filter((r) => {
      if (school && !r.school.includes(school)) return false;
      if (subject && !r.subject.includes(subject)) return false;
      if (keyword && !r.text.includes(keyword) && !r.code.includes(keyword)) return false;
      return true;
    });
    return hit.slice(0, limit);
  }
}

/** 성취기준 CSV — 따옴표로 감싼 필드와 줄바꿈을 지키며 읽는다. */
function parseCsv(text: string): StandardRow[] {
  const out: StandardRow[] = [];
  const lines = splitCsvRows(text.replace(/^﻿/, ''));
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i];
    if (c.length < 5) continue;
    const [school, subject, grade, code, body] = c;
    if (!code) continue;
    out.push({ school, subject, grade, code, text: body });
  }
  return out;
}

function splitCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const blockRepository = new BundledBlockRepository();
const curriculum = new CsvCurriculum();

export interface ComposeInput {
  grade: string;
  subject: string;
  topic: string;
  archetype?: string | null;
  codes?: string[] | null;
  objectives?: string[];
}

export interface ComposeResult {
  manifest: GrabManifest;
  brief: GrabBrief;
  archetype: string;
  archetypeReason: string;
  standards: StandardRow[];
  subjectLabel: string;
}

export interface GrabBlock {
  type: string;
  html?: string;
  gen?: string;
  [k: string]: unknown;
}

export interface GrabManifest {
  id?: string;
  subject?: string;
  theme?: string;
  docTitle?: string;
  standards?: string[];
  standardsText?: Record<string, string>;
  pages: GrabBlock[][];
  [k: string]: unknown;
}

export interface GrabBriefBlock {
  role?: string;
  type: string;
  slots?: string[];
  desc?: string;
  authoring?: string;
}

export interface GrabBrief {
  archetype?: string;
  name?: string;
  subject?: string;
  pages?: GrabBriefBlock[][];
  [k: string]: unknown;
}

/** 주제에 맞는 활동 구조를 골라 "저작 대기" 매니페스트와 블록별 브리프를 만든다. */
export async function compose(input: ComposeInput): Promise<ComposeResult> {
  const usecase = new ComposeWorksheet({ blockRepository, curriculum });
  return (await usecase.execute(input)) as ComposeResult;
}

/**
 * 성취기준만 비운다 — 학습 목표 박스는 그대로 둔다.
 * (목표 박스는 standard-label 블록이 그리므로 블록 자체를 지우면 목표까지 사라진다)
 */
export function withoutStandards(manifest: GrabManifest): GrabManifest {
  return { ...manifest, standards: [], standardsText: {} };
}

/** 성취기준을 고른 것들로 갈아 끼운다. */
export function withStandards(
  manifest: GrabManifest,
  rows: { code: string; text: string }[],
): GrabManifest {
  return {
    ...manifest,
    standards: rows.map((r) => r.code),
    standardsText: Object.fromEntries(rows.map((r) => [r.code, r.text])),
  };
}

/** 매니페스트 → 활동지 HTML (MODE_TOKEN 포함) */
export async function assemble(manifest: GrabManifest): Promise<string> {
  const usecase = new AssembleWorksheet({ blockRepository, curriculum });
  const { html } = (await usecase.execute(manifest)) as { html: string };
  return html;
}

/** HTML → 학생용·교사용 2벌 (학생용은 정답을 물리적으로 제거) */
export function variants(html: string): { student: string; teacher: string } {
  return new BuildVariants().execute(html) as { student: string; teacher: string };
}

export interface ValidationResult {
  ok: boolean;
  findings: { level?: string; message?: string; [k: string]: unknown }[];
}

/** 정답 누출·인쇄 안전 검수 */
export async function validate(html: string): Promise<ValidationResult> {
  const usecase = new ValidateWorksheet();
  const res = (await usecase.execute(html)) as
    | { ok?: boolean; pass?: boolean; findings?: unknown[]; issues?: unknown[] }
    | undefined;
  const findings = (res?.findings ?? res?.issues ?? []) as ValidationResult['findings'];
  const ok = res?.ok ?? res?.pass ?? findings.length === 0;
  return { ok, findings };
}

export async function searchStandards(query: {
  school?: string;
  subject?: string;
  keyword?: string;
  limit?: number;
}): Promise<StandardRow[]> {
  return curriculum.search(query);
}

/** 검색어를 낱말로 쪼갠다 ("함수의 극한과 연속" → 함수의·극한과·연속) */
function tokenize(text: string): string[] {
  return text
    .split(/[^가-힣A-Za-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/**
 * 성취기준 원문과 낱말이 얼마나 겹치는지 점수를 낸다.
 * 조사가 붙어 있어도 되도록 뒤에서 한 글자씩 줄여 가며 가장 긴 일치를 찾는다
 * (함수의 → 함수 ✓). 긴 일치일수록 높은 점수.
 */
function scoreRow(text: string, tokens: string[]): number {
  let score = 0;
  for (const t of tokens) {
    for (let len = t.length; len >= 2; len--) {
      if (text.includes(t.slice(0, len))) {
        score += len;
        break;
      }
    }
  }
  return score;
}

export interface StandardMatch {
  rows: StandardRow[];
  /** 가장 잘 맞은 성취기준의 과목 — 고교 세부 과목(미적분Ⅰ 등)을 여기서 알아낸다 */
  subject: string;
  /** 낱말이 실제로 겹쳐서 고른 것인지 (false면 과목 대표 성취기준으로 채운 것) */
  matched: boolean;
}

/**
 * 학습지 내용에 **가장 잘 어울리는** 성취기준을 찾는다.
 * 과목을 미리 찍지 않고, 후보 과목 전체에서 낱말이 겹치는 순으로 고른다.
 * 겹치는 게 없으면 힌트 과목의 대표 성취기준으로 채워 절대 빈손으로 돌아가지 않는다.
 */
export async function findStandards(opts: {
  school?: string;
  /** 후보 과목 목록 (고교 수학이면 8개 과목 전체). 비우면 학교급 전체 */
  subjects?: string[];
  keywords: string[];
  limit?: number;
}): Promise<StandardMatch | null> {
  const { school, subjects, keywords, limit = 4 } = opts;
  const rows = await curriculum.all();
  const pool = rows.filter((r) => {
    if (school && !r.school.includes(school)) return false;
    if (subjects?.length && !subjects.some((s) => r.subject === s)) return false;
    return true;
  });
  if (!pool.length) return null;

  const tokens = tokenize(keywords.join(' '));
  const scored = pool
    .map((r) => ({ r, s: scoreRow(r.text, tokens) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);

  if (!scored.length) {
    // 겹치는 낱말이 없다 — 첫 후보 과목의 대표 성취기준으로 채운다.
    const subj = subjects?.[0] ?? pool[0].subject;
    const rep = pool.filter((r) => r.subject === subj).slice(0, limit);
    const use = rep.length ? rep : pool.slice(0, limit);
    return { rows: use, subject: use[0].subject, matched: false };
  }

  // 가장 잘 맞은 성취기준의 과목으로 통일한다 (학교급·과목 혼합 방지).
  const best = scored[0].r.subject;
  const same = scored.filter((x) => x.r.subject === best).slice(0, limit);
  return { rows: same.map((x) => x.r), subject: best, matched: true };
}

/** 아키타입 목록 (벤더 데이터가 단일 진실원천) */
export function archetypeList(): { id: string; name: string; subjects: string[]; desc: string }[] {
  const a = (ARCHETYPES.archetypes ?? {}) as Record<
    string,
    { name?: string; subjects?: string[]; desc?: string }
  >;
  return Object.entries(a).map(([id, v]) => ({
    id,
    name: v.name ?? id,
    subjects: v.subjects ?? ['*'],
    desc: v.desc ?? '',
  }));
}
