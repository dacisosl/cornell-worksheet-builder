/**
 * 완성본 디자인 6종.
 *
 * 마크업과 배치는 디자인과 무관하게 똑같다 — 칸(.ws-cell)·칸 머리(.ws-cellhead)·
 * 문제칸/풀이칸(.ws-box)·문항 마크(.ws-no)가 어느 디자인에서나 같은 자리에 선다.
 * 디자인이 바꾸는 건 그 위에 덧입히는 CSS 한 겹뿐이다: 종이 색과 질감, 선의 색과
 * 굵기, 모서리, 라벨 모양, 장식.
 *
 * 공통 원칙 — **가독성이 먼저다.** 본문 글씨는 모든 디자인에서 진한 잉크색·같은
 * 크기이고, 색은 테두리·라벨·배경·번호에만 쓴다. 흰 글씨는 라벨(굵게, 10pt 이상)에만.
 */

import pastelCss from './designs/pastel.css?raw';
import gridCss from './designs/grid.css?raw';
import stickerCss from './designs/sticker.css?raw';
import ruledCss from './designs/ruled.css?raw';
import spiralCss from './designs/spiral.css?raw';

export type DesignName = 'mono' | 'pastel' | 'grid' | 'sticker' | 'ruled' | 'spiral';

export interface Design {
  name: DesignName;
  label: string;
  blurb: string;
  /** 기본 디자인(design.css) 위에 덧입히는 CSS. 모노 미니멀은 덧입힐 것이 없다. */
  css: string;
}

export const DESIGNS: Record<DesignName, Design> = {
  mono: {
    name: 'mono',
    label: '모노 미니멀',
    blurb: '흑백 · 구조로 만든 위계 · 복사기 안전',
    css: '',
  },
  pastel: {
    name: 'pastel',
    label: '파스텔 노트',
    blurb: '크림 종이 · 둥근 검정 외곽선 · 분홍 알약 라벨',
    css: pastelCss,
  },
  grid: {
    name: 'grid',
    label: '모눈 메모',
    blurb: '5mm 모눈 · 굵은 검정 표 머리말 · 무채색',
    css: gridCss,
  },
  sticker: {
    name: 'sticker',
    label: '스티커 활동지',
    blurb: '연노랑 종이 · 컬러 오프셋 그림자 · 마스킹테이프',
    css: stickerCss,
  },
  ruled: {
    name: 'ruled',
    label: '레드 룰드',
    blurb: '크림 종이 · 와인레드 단색 룰 · 세리프 소제목',
    css: ruledCss,
  },
  spiral: {
    name: 'spiral',
    label: '스파이럴 노트',
    blurb: '검정 스프링 제본 · 코랄 알약 라벨 · 체커 푸터',
    css: spiralCss,
  },
};

export const DESIGN_ORDER: DesignName[] = ['mono', 'pastel', 'grid', 'sticker', 'ruled', 'spiral'];

export function isDesignName(v: unknown): v is DesignName {
  return typeof v === 'string' && v in DESIGNS;
}
