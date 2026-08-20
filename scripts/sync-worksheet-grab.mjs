#!/usr/bin/env node
/**
 * worksheet-grab(MIT, pblsketch/worksheet-grab)의 **브라우저에서 도는 순수 코어**만
 * src/vendor/worksheet-grab/ 으로 옮겨 온다.
 *
 *   node scripts/sync-worksheet-grab.mjs <clone-경로>
 *
 * 가져오는 것 : domain·usecases 중 node 내장 의존이 없는 파일 + 블록/테마/CSS/템플릿/성취기준
 * 빼는 것     : 파일시스템 어댑터, Chrome 렌더러, 워크스페이스·자료집, 벤더 폰트(3.7MB)
 *
 * 코어가 순수한 이유는 상류가 포트&어댑터 구조이기 때문이다. 이 스크립트는 옮겨온 파일에
 * node 내장 import 가 섞여 있으면 실패한다(브라우저에서 깨지는 것을 미리 막는다).
 */
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEST = join(HERE, '..', 'src', 'vendor', 'worksheet-grab');

/** 이 진입점들에서 도달하는 파일만 가져온다. */
const ENTRIES = [
  'src/usecases/AssembleWorksheet.js',
  'src/usecases/BuildVariants.js',
  'src/usecases/ComposeWorksheet.js',
  'src/usecases/EditWorksheet.js',
  'src/usecases/ValidateWorksheet.js',
  'src/usecases/ArchetypeLibrary.js',
  'src/usecases/PresetLibrary.js',
];

/** 통째로 복사할 자산 디렉터리·파일 */
const ASSETS = [
  'blocks',
  'themes',
  'templates',
  'assets/blocks.css',
  'assets/paper.css',
  'assets/sketch-frames.css',
  'data/achievement-standards.csv',
  'LICENSE',
];

const NODE_BUILTIN = /from\s+'(node:[^']+|fs|path|url|os|child_process|vm)'/;

async function graph(root) {
  const seen = new Set();
  async function walk(rel) {
    rel = normalize(rel);
    if (seen.has(rel)) return;
    seen.add(rel);
    const src = await readFile(join(root, rel), 'utf8');
    if (NODE_BUILTIN.test(src)) {
      throw new Error(`${rel} 이 node 내장 모듈을 씁니다 — 브라우저 코어에 넣을 수 없습니다.`);
    }
    for (const m of src.matchAll(/from\s+'(\.[^']+)'|import\(\s*'(\.[^']+)'/g)) {
      await walk(join(dirname(rel), m[1] ?? m[2]));
    }
  }
  for (const e of ENTRIES) await walk(e);
  return [...seen].sort();
}

async function main() {
  const root = process.argv[2];
  if (!root || !existsSync(join(root, 'package.json'))) {
    console.error('사용법: node scripts/sync-worksheet-grab.mjs <worksheet-grab 클론 경로>');
    process.exit(1);
  }

  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const files = await graph(root);

  await rm(DEST, { recursive: true, force: true });
  await mkdir(DEST, { recursive: true });

  for (const rel of files) {
    const to = join(DEST, rel);
    await mkdir(dirname(to), { recursive: true });
    await cp(join(root, rel), to);
  }
  for (const rel of ASSETS) {
    const from = join(root, rel);
    if (!existsSync(from)) continue;
    const to = join(DEST, rel);
    await mkdir(dirname(to), { recursive: true });
    await cp(from, to, { recursive: (await stat(from)).isDirectory() });
  }

  let bytes = 0;
  const count = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await count(p);
      else bytes += (await stat(p)).size;
    }
  };
  await count(DEST);

  await writeFile(
    join(DEST, 'NOTICE.md'),
    `# worksheet-grab (vendored)

출처: https://github.com/pblsketch/worksheet-grab (MIT)
버전: ${pkg.version}
가져온 날짜: ${new Date().toISOString().slice(0, 10)}

이 폴더는 worksheet-grab 저장소에서 **브라우저에서 그대로 도는 순수 코어**만 옮겨 온 것입니다.
직접 고치지 마세요 — \`node scripts/sync-worksheet-grab.mjs <클론 경로>\` 로 다시 받습니다.

## 들어 있는 것
- \`src/domain\`, \`src/usecases\` (${files.length}개 파일) — 조립·검수·2벌 생성. node 내장 의존 0
- \`blocks/\`, \`themes/\`, \`assets/*.css\`, \`templates/\` — 블록 라이브러리·교과 테마
- \`data/achievement-standards.csv\` — 성취기준 원문(조회용, 필요할 때만 불러옵니다)

## 빠져 있는 것 (브라우저에서 못 돌거나 필요 없는 것)
- 파일시스템 어댑터(\`FsBlockRepository\` 등) → \`src/lib/grabRuntime.ts\` 의 브라우저 어댑터로 대체
- Chrome 헤드리스 렌더러 → 브라우저 인쇄(Ctrl+P)로 대체
- 워크스페이스·자료집·PPTX·자기업데이트, 벤더 폰트(3.7MB) → CDN 폴백 사용

MIT 라이선스 전문은 \`LICENSE\` 에 있습니다.
`,
    'utf8',
  );

  console.log(`소스 ${files.length}개 + 자산 복사 완료 → ${relative(process.cwd(), DEST)}`);
  console.log(`총 ${(bytes / 1024 / 1024).toFixed(2)} MB`);
}

await main();
