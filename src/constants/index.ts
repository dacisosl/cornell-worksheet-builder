import type { BlockDefaults, BlockType } from '../types';

export const STORE_KEY = 'cornell-worksheet-v3';
export const LEGACY_KEYS = ['cornell-worksheet-v2', 'cornell-worksheet-v1'] as const;

export const PAGE_H = 1123;
export const PAGE_PAD_TOP = 46;
export const PAGE_PAD_BOTTOM = 60;
export const PAGE_PAD_X = 52;
export const PAGE_MARGIN = 30;
export const CONT_H = 46;
export const CONTENT_H = 1017;
export const STACK_GAP = 18;
export const PAGE_FOOT_H = 28;
export const SNAP = 6;
export const GRID = 8;

export const DEFAULTS: Record<BlockType, BlockDefaults> = {
  problem: { h: 340, ratio: 0.5, solBg: 'lines', probBg: 'blank' },
  concept: { h: 250, exBg: 'lines', tint: false },
  mock: { h: 510, ratio: 0.45, solBg: 'lines', probBg: 'blank' },
  image: { h: 400 },
};

export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 1.5;
export const ZOOM_STEP = 0.1;
export const SAVE_DEBOUNCE_MS = 400;
export const PAGINATE_DEBOUNCE_MS = 60;

export const TITLE_SIZE_DEFAULT = 15.5;
export const TITLE_SIZE_MIN = 10;
export const TITLE_SIZE_MAX = 28;
export const TITLE_SIZE_STEP = 1;
