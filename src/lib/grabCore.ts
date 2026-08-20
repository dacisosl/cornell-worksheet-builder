/**
 * 벤더 코어(worksheet-grab, 무빌드 순수 ESM)에 타입을 입히는 얇은 껍데기.
 * 벤더 파일은 손대지 않는다 — 여기서만 타입을 선언하므로 재동기화해도 깨지지 않는다.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-expect-error 벤더 순수 JS — 타입 선언 없음
import { AssembleWorksheet as AssembleJs } from '../vendor/worksheet-grab/src/usecases/AssembleWorksheet.js';
// @ts-expect-error 벤더 순수 JS — 타입 선언 없음
import { BuildVariants as BuildVariantsJs } from '../vendor/worksheet-grab/src/usecases/BuildVariants.js';
// @ts-expect-error 벤더 순수 JS — 타입 선언 없음
import { ComposeWorksheet as ComposeJs } from '../vendor/worksheet-grab/src/usecases/ComposeWorksheet.js';
// @ts-expect-error 벤더 순수 JS — 타입 선언 없음
import { ValidateWorksheet as ValidateJs } from '../vendor/worksheet-grab/src/usecases/ValidateWorksheet.js';

export interface CoreDeps {
  blockRepository: unknown;
  curriculum?: unknown;
}

export const AssembleWorksheet = AssembleJs as new (deps: CoreDeps) => {
  execute(manifest: unknown, opts?: { editMode?: boolean }): Promise<{ html: string }>;
};

export const BuildVariants = BuildVariantsJs as new () => {
  execute(html: string): { student: string; teacher: string };
};

export const ComposeWorksheet = ComposeJs as new (deps: CoreDeps) => {
  execute(input: unknown): Promise<unknown>;
};

export const ValidateWorksheet = ValidateJs as new () => {
  execute(html: string): Promise<unknown>;
};
