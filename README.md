# 코넬 학습지 빌더

A4 코넬 노트 스타일 학습지를 블록 조합으로 만드는 웹 앱입니다.

## 기능

- **블록 타입**: 문제풀이(가로), 개념설명(세로), 모의고사(½폭 2단)
- **이미지 객체**: Ctrl+V 붙여넣기, 드래그·리사이즈, 스냅/격자, 화질 보정, 자동 정돈
- **A4 쪽 맞춤**: 페이지 경계 가이드, 자동 쪽 넘김
- **저장/불러오기**: JSON 파일로 내보내기·가져오기
- **인쇄/PDF**: 브라우저 인쇄로 PDF 저장

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
