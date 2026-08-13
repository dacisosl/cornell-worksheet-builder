export const $ = <T extends Element = Element>(s: string, r: ParentNode = document): T | null =>
  r.querySelector<T>(s);

export const $$ = <T extends Element = Element>(s: string, r: ParentNode = document): T[] =>
  [...r.querySelectorAll<T>(s)];

type ElProps = Record<string, unknown> & {
  class?: string;
  html?: string;
  text?: string;
  data?: Record<string, string>;
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  kids: (Node | string | null | undefined) | (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);

  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v as string;
    else if (k === 'html') e.innerHTML = v as string;
    else if (k === 'text') e.textContent = v as string;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'data') {
      for (const [d, val] of Object.entries(v as Record<string, string>)) {
        e.dataset[d] = val;
      }
    } else if (v != null) e.setAttribute(k, String(v));
  }

  const list = Array.isArray(kids) ? kids : [kids];
  for (const c of list) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }

  return e;
}

export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout>;
  return ((...args: Parameters<T>) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}
