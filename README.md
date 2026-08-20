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

빌더로 **레이아웃과 뼈대**를 잡고, 교육 내용·검수·학생용/교사용 2벌 출력은
[worksheet-grab](https://github.com/pblsketch/worksheet-grab)에 넘기는 흐름입니다.

```
코넬 학습지 빌더            (이 앱)            worksheet-grab
  1차 초안 제작  ──▶  AI 분석 → 요청문 생성  ──▶  내용 저작 · 검수 · PDF 2벌
                     (OpenRouter / Gemini)
```

### 쓰는 법

1. 빌더에서 학습지를 1차로 만듭니다 (블록 배치·이미지·문항 뼈대).
2. 상단 **워크시트그랩** 버튼을 누릅니다.
3. **AI 제공자**를 고르고 API 키를 넣습니다. 둘 다 지원하며, 쓰실 쪽 하나만 넣으면 됩니다.

   | 제공자 | 키 발급 | 비고 |
   |---|---|---|
   | OpenRouter | https://openrouter.ai/keys | 한 키로 여러 모델. `모델 불러오기`로 목록 조회 |
   | Google Gemini | https://aistudio.google.com/apikey | `모델 불러오기`에 키가 필요 |

4. **초안 분석 → 요청문 만들기**를 누르면 교과·학년·주제·학습목표·활동 구조(아키타입)를
   추정하고, worksheet-grab에 붙여넣을 요청문을 만듭니다.
5. **초안 JSON 저장**으로 `<제목>.cornell.json` 을 받아 worksheet-grab 폴더에 두고,
   요청문을 복사해 그 폴더를 연 AI 도구(클로드 코드·코덱스 등)에 붙여넣습니다.

### 알아두기

- API 키는 **이 브라우저(localStorage)** 에만 저장되고, 고른 제공자에게만 전송됩니다.
- 보내는 것은 **글자와 배치 정보**뿐입니다 — 이미지 파일 자체는 전송하지 않습니다.
  (`보낼 내용 미리보기`로 확인할 수 있습니다.)
- 성취기준은 worksheet-grab이 자체 자료에서 조회합니다. 분석 단계는 **코드를 지어내지 않고**
  조회용 키워드만 만듭니다.
- worksheet-grab 실행에는 Node.js 24 이상이 필요하고, PDF·PNG 출력에는 Chrome이 필요합니다.
