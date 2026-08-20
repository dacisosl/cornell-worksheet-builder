/**
 * 무드 테두리 손그림 레이어의 SVG 필터 정의 — 엔진 상수.
 *
 * CSS 가 아니라 마크업이라 자산 파일(assets/*.css)에 담을 수 없어 여기 둔다. 대신 이 문자열이
 * 무엇을 담을 수 있는지는 유닛 테스트가 못박는다(`<filter>` 외 금지, 외부 참조 금지) — themes/ 아래가
 * 아니라 design-lint 순회 밖이므로 그 단정이 유일한 방어선이다.
 *
 * 방출 위치 계약(실측으로 얻은 하드 제약): **`</body>` 직전, 페이지 뒤, `display:none`.**
 * body 흐름 안에 두면 인라인 박스가 생겨 조판이 밀린다(3쪽 문서가 4쪽이 됐다). display:none 컨테이너
 * 안의 필터를 Chrome 이 계속 해석한다는 것도 실측으로 확인했다(필터가 인쇄 산출물에 도달).
 *
 * 진폭·주파수의 의미: `scale` 은 최대 변위(±scale/2 px), `baseFrequency` 는 흔들림의 파장이다.
 * 용량은 진폭이 아니라 **주파수**를 따른다(파장이 짧을수록 래스터 타일이 복잡해진다) — 예산을
 * 진폭으로 잡으면 틀린다.
 *
 * 순수 모듈: FS·process 접근 없음.
 */

/** 큰 상자용 — 파장이 길어 "죽 그은 획"으로 읽힌다. */
const ROUGH = '<filter id="wg-rough" x="-4%" y="-14%" width="108%" height="128%">'
  + '<feTurbulence type="fractalNoise" baseFrequency="0.012 0.022" numOctaves="2" seed="11" result="n"/>'
  + '<feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" xChannelSelector="R" yChannelSelector="G"/>'
  + '</filter>';

/** 표 셀·밑줄·체크박스용 — 작은 대상이라 파장을 짧게, 진폭을 낮게. 영역은 헤어라인이 잘리지
 *  않도록 세로로 넉넉히 준다(잉크가 상자 하단 모서리에 놓이는 경우가 많다). */
const ROUGH_FINE = '<filter id="wg-rough-fine" x="-6%" y="-40%" width="112%" height="180%">'
  + '<feTurbulence type="fractalNoise" baseFrequency="0.02 0.05" numOctaves="2" seed="23" result="n"/>'
  + '<feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="G"/>'
  + '</filter>';

/**
 * 방출할 defs 마크업. 시드를 고정했으므로 같은 문서는 항상 같은 그림이다
 * (골든·바이트 단정과 편집==인쇄의 전제).
 */
export const MOOD_FRAMES_DEFS =
  '<svg class="wg-defs" width="0" height="0" aria-hidden="true" focusable="false" style="display:none">'
  + `<defs>${ROUGH}${ROUGH_FINE}</defs></svg>`;

/** 이 defs 가 방출하는 조각 id 의 닫힌 집합 — CSS 가 참조할 수 있는 유일한 이름들. */
export const MOOD_FRAMES_FRAGMENT_IDS = Object.freeze(['wg-rough', 'wg-rough-fine']);
