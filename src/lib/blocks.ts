import { DEFAULTS } from '../constants';
import type {
  Block,
  BlockType,
  ConceptBlock,
  ImageBlock,
  ImageOnlyBlock,
  MockBlock,
  ProblemBlock,
} from '../types';
import type { Store } from '../state/store';

export function makeBlock(store: Store, type: BlockType): Block {
  const d = DEFAULTS[type];
  const base = { id: store.nextBlockId(), type, h: d.h, title: '' };

  if (type === 'problem') {
    return {
      ...base,
      type: 'problem',
      ratio: d.ratio!,
      solBg: d.solBg!,
      probBg: d.probBg!,
      probHtml: '',
      solHtml: '',
      imgs: [],
    } satisfies ProblemBlock;
  }

  if (type === 'concept') {
    return {
      ...base,
      type: 'concept',
      exBg: d.exBg!,
      tint: d.tint!,
      exHtml: '',
      imgMode: 'none',
      ratio: 0.5,
      imgHtml: '',
      imgs: [],
    } satisfies ConceptBlock;
  }

  if (type === 'image') {
    return {
      ...base,
      type: 'image',
      imgs: [],
      html: '',
      titleHidden: true,
      width: 'full',
    } satisfies ImageOnlyBlock;
  }

  return {
    ...base,
    type: 'mock',
    ratio: d.ratio!,
    solBg: d.solBg!,
    probBg: d.probBg!,
    probHtml: '',
    solHtml: '',
    imgs: [],
  } satisfies MockBlock;
}

export function hasImages(block: Block): block is ImageBlock {
  return 'imgs' in block;
}

export function sizeLabel(h: number, contentH: number): string {
  const frac = h / contentH;
  let f = '';
  if (Math.abs(frac - 1 / 3) < 0.04) f = ' · A4 ⅓';
  else if (Math.abs(frac - 1 / 2) < 0.04) f = ' · A4 ½';
  else if (Math.abs(frac - 2 / 3) < 0.04) f = ' · A4 ⅔';
  else if (Math.abs(frac - 1) < 0.05) f = ' · A4 1쪽';
  return Math.round(h) + 'px' + f;
}

export function bgClass(mode: string): string {
  return mode === 'lines' ? 'bg-lines' : mode === 'grid' ? 'bg-grid' : '';
}
