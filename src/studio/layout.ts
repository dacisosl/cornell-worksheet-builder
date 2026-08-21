/**
 * 초안의 지면 배치를 읽어 둔다.
 *
 * 교사가 칸 크기와 자리를 정해 둔 데는 이유가 있다 — 한 쪽에 문제 여섯과 여백 여섯을
 * 놓았다면 완성본도 그래야 한다. 그래서 조판을 새로 짜지 않고, 이미 화면에 잡혀 있는
 * 배치(쪽·행·반칸 여부·높이 비율)를 그대로 옮겨 적는다.
 *
 * 값은 px가 아니라 **그 쪽 본문 높이에 대한 비율**로 적는다. 완성본 테마마다 여백이
 * 달라도 "이 칸은 한 쪽의 3분의 1" 같은 관계가 그대로 유지된다.
 */

/** 초안에서 읽어 온 한 블록의 자리 */
export interface BlockGeom {
  /** 0부터 세는 쪽 번호 */
  page: number;
  /** 그 쪽 안에서 몇 번째 행인지 */
  row: number;
  /** 한 행에 둘이 나란히 서는 반칸인지 */
  half: boolean;
  /** 행 높이 ÷ 그 쪽 본문 높이 (0..1) */
  hFrac: number;
  /** 문제칸 : 풀이칸 비율 — 초안 블록의 ratio 그대로 */
  ratio?: number;
}

export type LayoutMap = Map<number, BlockGeom>;

/**
 * 화면에 잡혀 있는 배치를 읽는다. 빌더가 이미 쪽나눔을 끝낸 뒤라 측정값이 곧 정답이다.
 * (스튜디오는 열릴 때 syncFromDOM으로 화면과 상태를 맞춘 뒤에 부른다.)
 */
export function readLayout(doc: Document = document): LayoutMap {
  const out: LayoutMap = new Map();
  const pages = Array.from(doc.querySelectorAll<HTMLElement>('.sheet-page'));

  pages.forEach((page, pi) => {
    const stack = page.querySelector<HTMLElement>('.stack');
    if (!stack) return;
    const budget = stack.clientHeight || page.clientHeight || 1017;
    const blocks = Array.from(stack.querySelectorAll<HTMLElement>('.block'));

    let row = 0;
    for (let i = 0; i < blocks.length; i += 1) {
      const b = blocks[i];
      const next = blocks[i + 1];
      const pair = b.classList.contains('half') && next?.classList.contains('half');
      const members = pair ? [b, next] : [b];
      const h = Math.max(...members.map((m) => m.offsetHeight));
      const hFrac = Math.min(1, Math.max(0.04, h / budget));

      for (const m of members) {
        const id = Number(m.getAttribute('data-id'));
        if (Number.isFinite(id)) {
          out.set(id, { page: pi, row, half: pair, hFrac });
        }
      }
      row += 1;
      if (pair) i += 1;
    }
  });

  return out;
}
