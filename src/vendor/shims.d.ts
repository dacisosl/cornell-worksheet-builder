/** Vite 원문(raw) 임포트 — 벤더 자산을 문자열로 가져올 때 쓴다. */
declare module '*?raw' {
  const src: string;
  export default src;
}
