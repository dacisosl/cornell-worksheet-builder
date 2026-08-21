/**
 * 디자인 형식을 고르기 전에 보여 줄 **예시 문서**.
 *
 * 예시도 실제 완성본과 같은 렌더러(`renderDocument`)를 그대로 타게 한다.
 * 그래야 교사가 본 예시가 곧 이 스튜디오가 뽑아 주는 결과물이 된다.
 */

import type { PolishedDoc } from './schema';

const t = (s: string) => ({ t: 'text' as const, s });
const m = (latex: string) => ({ t: 'math' as const, latex });

/** 예시 도판 — 두 점 A(−2,0), B(0,4)를 지나는 일차함수 그래프 */
const GRAPH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 128" width="600" height="512">
<rect width="150" height="128" fill="#fff"/>
<g stroke="#e8e8e6" stroke-width="1" fill="none">
<path d="M15 8v104M39 8v104M63 8v104M87 8v104M111 8v104M135 8v104"/>
<path d="M11 16h132M11 40h132M11 64h132M11 88h132M11 112h132"/></g>
<g stroke="#1b1b1b" stroke-width="1.5" fill="none">
<path d="M8 88h136M87 4v118"/></g>
<path d="M144 88l-4.5-2.6v5.2z" fill="#1b1b1b"/><path d="M87 2l-2.6 4.5h5.2z" fill="#1b1b1b"/>
<path d="M22 118L132 8" stroke="#1b1b1b" stroke-width="2" fill="none"/>
<circle cx="39" cy="88" r="2.6" fill="#fff" stroke="#1b1b1b" stroke-width="1.5"/>
<circle cx="87" cy="40" r="2.6" fill="#fff" stroke="#1b1b1b" stroke-width="1.5"/>
<g font-family="Georgia,serif" font-style="italic" font-size="8.5" fill="#1b1b1b">
<text x="30" y="100">A</text><text x="92" y="38">B</text>
<text x="79" y="99" font-size="8">O</text><text x="138" y="100">x</text><text x="92" y="10">y</text></g>
</svg>`;

const GRAPH_SRC = `data:image/svg+xml,${encodeURIComponent(GRAPH_SVG)}`;

export const SAMPLE_DOC: PolishedDoc = {
  meta: { title: '일차함수와 그래프', subtitle: '기울기와 y절편 · 그래프의 평행이동', date: '' },
  sections: [
    {
      srcBlockId: 0,
      srcType: 'sample',
      items: [
        {
          kind: 'concept',
          title: '핵심 개념',
          body: [
            t('일차함수 '),
            m('y = ax + b'),
            t(' 에서 '),
            m('a'),
            t(' 는 그래프의 기울기, '),
            m('b'),
            t(' 는 '),
            m('y'),
            t('절편이다. '),
            m('x'),
            t('의 값이 1만큼 증가할 때 '),
            m('y'),
            t('의 값은 '),
            m('a'),
            t('만큼 증가한다. '),
            m('\\text{기울기} = \\dfrac{y\\text{의 증가량}}{x\\text{의 증가량}}'),
          ],
        },
        {
          kind: 'problem',
          stem: [
            t('일차함수 '),
            m('y = 3x - 2'),
            t(' 의 그래프를 '),
            m('y'),
            t('축의 방향으로 4만큼 평행이동한 그래프가 점 '),
            m('(2,\\ k)'),
            t(' 를 지날 때, '),
            m('k'),
            t(' 의 값은?'),
          ],
          choices: [[t('4')], [t('6')], [t('8')], [t('10')], [t('12')]],
          answerLines: 2,
        },
        {
          kind: 'problem',
          stem: [
            t('오른쪽 그림과 같이 일차함수의 그래프가 두 점 '),
            m('\\mathrm{A}(-2,\\ 0)'),
            t(', '),
            m('\\mathrm{B}(0,\\ 4)'),
            t(' 를 지난다. 이 그래프의 기울기와 '),
            m('y'),
            t('절편을 각각 구하시오.'),
          ],
          figures: [{ bbox: [0, 0, 1, 1], from: 'sample', src: GRAPH_SRC, caption: '일차함수의 그래프' }],
          answerLines: 4,
        },
        {
          kind: 'problem',
          tagLabel: '서술형',
          stem: [
            t('두 일차함수 '),
            m('y = 2x + 3'),
            t(' 과 '),
            m('y = 2x - 5'),
            t(' 의 그래프 사이의 관계를 평행이동을 이용하여 설명하고, 그렇게 판단한 이유를 서술하시오.'),
          ],
          answerLines: 5,
        },
      ],
    },
  ],
};
