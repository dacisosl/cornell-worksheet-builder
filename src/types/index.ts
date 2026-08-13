export type BlockType = 'problem' | 'concept' | 'mock' | 'image';
export type BgMode = 'blank' | 'lines' | 'grid';

export interface ImageObj {
  id: number;
  src: string;
  sharpSrc: string | null;
  sharpened: boolean;
  ar: number;
  x: number;
  y: number;
  w: number;
}

export interface BlockBase {
  id: number;
  type: BlockType;
  h: number;
  title: string;
  /** 블록 상단 제목행(그립/칩/제목/컨트롤) 간소화(제목 숨김) */
  titleHidden?: boolean;
  /** 제목 입력 글씨 크기(px) */
  titleSize?: number;
  /** 칩(태그) 라벨 직접 수정값. 없으면 기본값(문제/개념/모의고사 + 번호) 사용 */
  tagLabel?: string;
  /** 칩 자체 숨김 */
  tagHidden?: boolean;
}

export interface ProblemBlock extends BlockBase {
  type: 'problem';
  ratio: number;
  solBg: BgMode;
  probBg: BgMode;
  probHtml: string;
  solHtml: string;
  imgs: ImageObj[];
}

export interface MockBlock extends BlockBase {
  type: 'mock';
  ratio: number;
  solBg: BgMode;
  probBg: BgMode;
  probHtml: string;
  solHtml: string;
  imgs: ImageObj[];
}

/** 이미지 전용 블록: 텍스트 없이 자유배치 이미지만 */
export interface ImageOnlyBlock extends BlockBase {
  type: 'image';
  /** 가로 폭: 'full'(전체) | 'half'(반절) */
  width: 'full' | 'half';
  imgs: ImageObj[];
}

/** 개념 블록 이미지 칸 배치: none(없음) · top(상단, 상하 2단) · left(좌측, 좌우 2열) */
export type ConceptImgMode = 'none' | 'top' | 'left';

export interface ConceptBlock extends BlockBase {
  type: 'concept';
  exBg: BgMode;
  tint: boolean;
  exHtml: string;
  imgMode: ConceptImgMode;
  /** 이미지 패널 비율 (top: 높이, left: 폭) */
  ratio: number;
  /** 이미지 패널 내 텍스트(문제 필드처럼 텍스트도 입력 가능) */
  imgHtml: string;
  imgs: ImageObj[];
}

export type Block = ProblemBlock | MockBlock | ConceptBlock | ImageOnlyBlock;

/** 자유배치 이미지를 가지는 블록 */
export type ImageBlock = ProblemBlock | MockBlock | ConceptBlock | ImageOnlyBlock;

export interface AppMeta {
  title: string;
  /** 2쪽 이후 헤더에 표시할 이어서 제목 (비어 있으면 title 사용) */
  contTitle: string;
  showHead: boolean;
  grid: boolean;
  pageFit: boolean;
}

export interface AppState {
  meta: AppMeta;
  blocks: Block[];
  zoom?: number;
}

export interface ImageSelection {
  b: number;
  i: number;
}

export interface BlockDefaults {
  h: number;
  ratio?: number;
  solBg?: BgMode;
  probBg?: BgMode;
  exBg?: BgMode;
  tint?: boolean;
}

export type RenderCallback = () => void;
export type SaveCallback = () => void;
