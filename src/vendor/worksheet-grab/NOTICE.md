# worksheet-grab (vendored)

출처: https://github.com/pblsketch/worksheet-grab (MIT)
버전: 0.6.0-beta.2
가져온 날짜: 2026-08-20

이 폴더는 worksheet-grab 저장소에서 **브라우저에서 그대로 도는 순수 코어**만 옮겨 온 것입니다.
직접 고치지 마세요 — `node scripts/sync-worksheet-grab.mjs <클론 경로>` 로 다시 받습니다.

## 들어 있는 것
- `src/domain`, `src/usecases` (32개 파일) — 조립·검수·2벌 생성. node 내장 의존 0
- `blocks/`, `themes/`, `assets/*.css`, `templates/` — 블록 라이브러리·교과 테마
- `data/achievement-standards.csv` — 성취기준 원문(조회용, 필요할 때만 불러옵니다)

## 빠져 있는 것 (브라우저에서 못 돌거나 필요 없는 것)
- 파일시스템 어댑터(`FsBlockRepository` 등) → `src/lib/grabRuntime.ts` 의 브라우저 어댑터로 대체
- Chrome 헤드리스 렌더러 → 브라우저 인쇄(Ctrl+P)로 대체
- 워크스페이스·자료집·PPTX·자기업데이트, 벤더 폰트(3.7MB) → CDN 폴백 사용

MIT 라이선스 전문은 `LICENSE` 에 있습니다.
