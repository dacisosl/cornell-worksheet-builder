# 코넬 학습지 빌더

A4 코넬 노트 스타일 학습지를 블록 조합으로 만드는 웹 앱입니다.

## 기능

- **블록 타입**: 문제풀이(가로), 개념설명(세로), 모의고사(½폭 2단), 이미지 전용
- **이미지 객체**: Ctrl+V 붙여넣기, 파일 삽입, 드래그·리사이즈, 스냅/격자, 화질 보정, 자르기
- **여러 장 다루기**: Shift+클릭으로 여러 장 고르기, **그룹 묶기**(함께 이동·확대), **겹침 정리**(크기 유지·겹침 제거)
- **칸 도구 버튼**: 이미지 칸 오른쪽 아래에 `이미지 · 좌표평면 · 겹침 정리 · 가로 정돈 · 세로 정돈` 버튼
- **좌표평면 삽입**: 격자·축·눈금이 있는 좌표평면을 이미지로 넣기 (인쇄용 고해상도)
- **제목행 숨김**: 블록 제목행을 숨기면 블록 테두리(틀)까지 사라져 이미지만 남습니다
- **칸 크기 조절**: 크기를 바꿔도 이미지는 제자리 — 이미지가 잘리는 지점에서 더 줄어들지 않습니다
- **모의고사**: 아래 손잡이는 아래 칸만, 가운데 구분선은 위·아래 비율만 바꿉니다 (서로 영향 없음)
- **새 블록 위치**: 마지막으로 고른 칸 바로 아래에 생깁니다
- **A4 쪽 맞춤**: 페이지 경계 가이드, 자동 쪽 넘김
- **저장/불러오기**: JSON 파일로 내보내기·가져오기 — 파일명은 `제목_YYYY-MM-DD.cornell.json`
- **인쇄/PDF**: 브라우저 인쇄로 PDF 저장 (파일명은 학습지 제목)
- **워크시트그랩 연계**: 1차 초안을 AI가 분석해 [worksheet-grab](https://github.com/pblsketch/worksheet-grab) 요청문 생성 (OpenRouter · Gemini)

## 시작하기

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:5173` 을 엽니다.

## 빌드

```bash
npm run build
npm run preview
```

`dist/` 폴더를 정적 호스팅에 배포하면 됩니다.

## 프로젝트 구조

```
src/
├── app.ts              # 앱 조립·UI 셸
├── main.ts             # 진입점
├── constants/          # A4·줌·기본값 상수
├── state/store.ts      # 상태·localStorage·JSON I/O
├── lib/
│   ├── blocks.ts       # 블록 생성·유틸
│   ├── images.ts       # 이미지 객체 시스템
│   ├── imageProcessing.ts  # 언샤프 마스크
│   ├── interactions.ts # 드래그·리사이즈·분할
│   ├── pagination.ts   # A4 쪽 맞춤
│   └── render.ts       # DOM 렌더링
├── types/              # TypeScript 타입
├── utils/              # DOM 헬퍼·아이콘
└── styles/main.css
```

## 데이터

- 브라우저 `localStorage`에 자동 저장 (`cornell-worksheet-v3`)
- v1/v2 데이터는 첫 실행 시 자동 마이그레이션

## 워크시트그랩(worksheet-grab)으로 완성하기

빌더로 **레이아웃과 뼈대**를 잡고, 교육 내용·검수·학생용/교사용 2벌은
[worksheet-grab](https://github.com/pblsketch/worksheet-grab) 엔진이 맡습니다.
엔진의 **브라우저에서 도는 순수 코어를 프로젝트에 담아** 두어, 다른 도구 없이 이 자리에서 끝납니다.

```
1차 초안 제작  →  AI 분석  →  활동 구조 조립  →  본문 저작  →  검수·2벌
  (빌더)       (OpenRouter/    (내장 엔진 —      (AI)        (내장 엔진)
                 Gemini)     성취기준 조회 포함)
```

### 쓰는 법

1. 빌더에서 학습지를 1차로 만듭니다 (블록 배치·이미지·문항 뼈대).
2. 상단 **워크시트그랩** 버튼 → AI 제공자를 고르고 API 키를 넣습니다.

   | 제공자 | 키 발급 | 비고 |
   |---|---|---|
   | OpenRouter | https://openrouter.ai/keys | 한 키로 여러 모델. `모델 불러오기`로 목록 조회 |
   | Google Gemini | https://aistudio.google.com/apikey | `모델 불러오기`에 키가 필요 |

3. **이 자리에서 완성하기** — 분석 → 활동 구조 → 본문 저작 → 검수 → 학생용·교사용 2벌.
   미리보기에서 확인하고 **열기·인쇄**로 A4 PDF를 뽑습니다.
4. **요청문만 만들기** — worksheet-grab CLI의 워크스페이스·PPTX·자료집까지 쓰고 싶을 때.
   AI 도구에 붙여넣을 요청문과 초안 JSON을 내려받습니다.

### 내장 엔진 (`src/vendor/worksheet-grab/`)

worksheet-grab은 포트&어댑터 구조라 조립·검수 코어가 파일시스템을 모릅니다.
그래서 **코어(32개 파일, node 내장 의존 0)** 와 블록·테마·성취기준만 가져오고,
파일시스템 어댑터 자리에는 브라우저 어댑터(`src/lib/grabRuntime.ts`)를 끼웠습니다.

| 상류 | 이 프로젝트 |
|---|---|
| `FsBlockRepository` (파일시스템) | 번들된 블록·테마 맵 (Vite `?raw`) |
| `GepaiCurriculum` (CSV 파일) | 같은 CSV, 필요할 때만 내려받음 |
| `ChromeRenderer` (헤드리스 크롬) | 브라우저 인쇄 (Ctrl+P) |

- 라이선스: **MIT**. 원본 `LICENSE`와 출처를 `src/vendor/worksheet-grab/`에 함께 둡니다.
- 다시 받기: `node scripts/sync-worksheet-grab.mjs <worksheet-grab 클론 경로>`
  (옮겨온 파일에 node 내장 import가 섞이면 스크립트가 실패해 브라우저에서 깨지는 것을 막습니다.)
- 엔진·블록(약 266KB)과 성취기준 CSV(약 560KB)는 이 기능을 쓸 때만 내려받습니다.

### 알아두기

- API 키는 **이 브라우저(localStorage)** 에만 저장되고, 고른 제공자에게만 전송됩니다.
- 보내는 것은 **글자와 배치 정보**뿐입니다 — 이미지 파일 자체는 전송하지 않습니다
  (`보낼 내용 미리보기`로 확인).
- 성취기준은 내장 CSV에서 **조회**합니다. AI가 코드를 지어내지 않습니다.
- 정답은 `class="answer"` 안에만 넣도록 강제하고, 학생용에서는 엔진이 물리적으로 제거합니다.
- 본문 글꼴(Pretendard)·수식(KaTeX)은 CDN에서 받습니다. 오프라인이면 기본 글꼴로 대체됩니다.
  (자기완결 출력에 필요한 벤더 폰트 3.7MB는 번들 크기를 위해 담지 않았습니다.)
