/**
 * 완성본을 만들기 전에 보여 줄 **예시 문서**.
 *
 * 예시도 실제 완성본과 같은 렌더러(`renderDocument`)를 그대로 타게 한다.
 * 그래야 교사가 본 예시가 곧 이 스튜디오가 뽑아 주는 결과물이 된다.
 *
 * 내용은 완성본 조판이 하는 일을 한눈에 보여 주도록 골랐다 — 한 줄을 차지하는
 * 디스플레이 수식, 테두리 상자로 묶인 풀이 과정(note), 답을 써 넣는 네모(\boxed).
 */

import type { PolishedDoc } from './schema';

const t = (s: string) => ({ t: 'text' as const, s });
const m = (latex: string) => ({ t: 'math' as const, latex });
/** 한 줄을 통째로 차지하며 가운데 크게 놓이는 수식 */
const M = (latex: string) => ({ t: 'math' as const, latex, display: true });
/** 학생이 답을 써 넣는 네모 */
const BLANK = '\\boxed{\\phantom{000}}';

/**
 * 예시 도판 — 롤의 정리 그래프.
 * f(x) = -x³ + x² + 6x 위의 실제 좌표를 계산해 그렸다: f(0) = f(3) = 0 이고
 * f'(c) = 0 인 c ≈ 1.79 에서 접선이 수평이다.
 */
const GRAPH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 108" width="600" height="432">
<rect width="150" height="108" fill="#fff"/>
<g stroke="#1A1A1A" stroke-width="1.1" fill="none"><path d="M22 92h122M30 100V16"/></g>
<path d="M147 92l-5-2.9v5.8z" fill="#1A1A1A"/><path d="M30 13l-2.9 5h5.8z" fill="#1A1A1A"/>
<g stroke="#6E6E6E" stroke-width=".7" stroke-dasharray="2.2 1.8" fill="none">
<path d="M95.6 92V30M132 92V33"/></g>
<path d="M70 30h51" stroke="#1A1A1A" stroke-width="1.1" fill="none"/>
<path d="M42.0 92.0L43.9 89.1L45.8 86.2L47.6 83.3L49.5 80.3L51.4 77.3L53.3 74.3L55.1 71.4L57.0 68.4L58.9 65.5L60.8 62.6L62.6 59.7L64.5 56.9L66.4 54.2L68.3 51.6L70.1 49.1L72.0 46.7L73.9 44.4L75.8 42.2L77.6 40.2L79.5 38.3L81.4 36.6L83.3 35.0L85.1 33.7L87.0 32.5L88.9 31.5L90.8 30.8L92.6 30.3L94.5 30.0L96.4 30.0L98.3 30.2L100.1 30.8L102.0 31.6L103.9 32.6L105.8 34.0L107.6 35.8L109.5 37.8L111.4 40.2L113.3 42.9L115.1 46.0L117.0 49.5L118.9 53.4L120.8 57.6L122.6 62.3L124.5 67.3L126.4 72.8L128.3 78.8L130.1 85.2L132.0 92.0"
  stroke="#1A1A1A" stroke-width="2.2" fill="none" stroke-linejoin="round"/>
<circle cx="42" cy="92" r="2.3" fill="#1A1A1A"/><circle cx="132" cy="92" r="2.3" fill="#1A1A1A"/>
<circle cx="95.6" cy="30" r="2.3" fill="#1A1A1A"/>
<g font-family="Georgia,serif" font-style="italic" font-size="8" fill="#1A1A1A">
<text x="39" y="101">a</text><text x="93" y="101">c</text><text x="129" y="101">b</text>
<text x="22" y="101" font-size="7.2" font-style="normal">O</text>
<text x="141" y="101">x</text><text x="22" y="22">y</text>
<text x="112" y="24" font-size="7.2">y=f(x)</text>
<text x="70" y="26" font-size="7.2">f\u2032(c)=0</text></g>
</svg>`;

const GRAPH_SRC = `data:image/svg+xml,${encodeURIComponent(GRAPH_SVG)}`;

export const SAMPLE_DOC: PolishedDoc = {
  meta: { title: '롤의 정리와 평균값 정리', subtitle: '미분가능성과 평균변화율', date: '' },
  sections: [
    {
      srcBlockId: 0,
      srcType: 'sample',
      items: [
        {
          kind: 'concept',
          title: '롤의 정리',
          body: [
            t('함수 '),
            m('f(x)'),
            t('가 닫힌구간 '),
            m('[a,\\ b]'),
            t('에서 연속이고 열린구간 '),
            m('(a,\\ b)'),
            t('에서 미분가능할 때, '),
            m('f(a)=f(b)'),
            t('이면'),
            M("f'(c)=0"),
            t('인 '),
            m('c'),
            t('가 열린구간 '),
            m('(a,\\ b)'),
            t('에 적어도 하나 존재한다.'),
          ],
          figures: [{ bbox: [0, 0, 1, 1], from: 'sample', src: GRAPH_SRC }],
        },
        {
          kind: 'concept',
          title: '평균값 정리',
          body: [
            t('함수 '),
            m('f(x)'),
            t('가 닫힌구간 '),
            m('[a,\\ b]'),
            t('에서 연속이고 열린구간 '),
            m('(a,\\ b)'),
            t('에서 미분가능하면'),
            M("\\dfrac{f(b)-f(a)}{b-a}=f'(c)"),
            t('인 '),
            m('c'),
            t('가 열린구간 '),
            m('(a,\\ b)'),
            t('에 적어도 하나 존재한다.'),
          ],
        },
        {
          kind: 'problem',
          stem: [
            t('다음은 함수 '),
            m('f(x)=x^3-9x'),
            t('에 대하여 닫힌구간 '),
            m('[0,\\ 3]'),
            t('에서 롤의 정리를 만족시키는 실수 '),
            m('c'),
            t('의 값을 구하는 과정이다. '),
            m(BLANK),
            t(' 안에 알맞은 것을 써넣으시오.'),
          ],
          note: [
            t('함수 '),
            m('f(x)=x^3-9x'),
            t('는 닫힌구간 '),
            m('[0,\\ 3]'),
            t('에서 연속이고 열린구간 '),
            m('(0,\\ 3)'),
            t('에서 미분가능하며 '),
            m('f(0)=f(3)'),
            t('이므로 롤의 정리에 의하여 '),
            m(`f'(c)=${BLANK}`),
            t('인 '),
            m('c'),
            t('가 열린구간 '),
            m('(0,\\ 3)'),
            t('에 적어도 하나 존재한다. 이때 '),
            m(`f'(x)=${BLANK}`),
            t('이므로 '),
            m(`f'(c)=${BLANK}`),
            t('에서 '),
            m(`c=-\\sqrt{3}\\ \\text{또는}\\ c=${BLANK}`),
            t(' 그런데 '),
            m('0<c<3'),
            t('이므로 '),
            m(`c=${BLANK}`),
          ],
          answerLines: 3,
        },
        {
          kind: 'problem',
          stem: [
            t('함수 '),
            m('f(x)=x^2-4x'),
            t('에 대하여 닫힌구간 '),
            m('[1,\\ 5]'),
            t('에서 평균값 정리를 만족시키는 실수 '),
            m('c'),
            t('의 값은?'),
          ],
          choices: [[m('2')], [m('3')], [m('\\dfrac{7}{2}')], [m('4')], [m('\\dfrac{9}{2}')]],
          answerLines: 2,
        },
        {
          kind: 'problem',
          tagLabel: '서술형',
          stem: [
            t('롤의 정리는 평균값 정리의 특별한 경우임을 설명하고, 두 정리가 성립하기 위해 함수 '),
            m('f(x)'),
            t('가 만족해야 하는 조건을 모두 서술하시오.'),
          ],
          answerLines: 5,
        },
      ],
    },
  ],
};
