function boxBlur(d: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const tmp = new Float32Array(d.length);
  const out = new Uint8ClampedArray(d.length);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let k = 0; k < 3; k++) {
        const a = d[(y * w + Math.max(0, x - 1)) * 4 + k];
        const b = d[i + k];
        const c = d[(y * w + Math.min(w - 1, x + 1)) * 4 + k];
        tmp[i + k] = (a + b + c) / 3;
      }
      tmp[i + 3] = d[i + 3];
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let k = 0; k < 3; k++) {
        const a = tmp[(Math.max(0, y - 1) * w + x) * 4 + k];
        const b = tmp[i + k];
        const c = tmp[(Math.min(h - 1, y + 1) * w + x) * 4 + k];
        out[i + k] = (a + b + c) / 3;
      }
      out[i + 3] = tmp[i + 3];
    }
  }

  return out;
}

/** 언샤프 마스크 — 캡처 글자 선명도 보정 (원본은 별도 보존) */
export function unsharp(img: HTMLImageElement, amount = 0.8): string | null {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return null;
  if (w * h > 6_000_000) return null;

  try {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0);

    const src = ctx.getImageData(0, 0, w, h);
    const blur = boxBlur(src.data, w, h);
    const out = ctx.createImageData(w, h);
    const s = src.data;
    const od = out.data;

    for (let i = 0; i < s.length; i += 4) {
      for (let k = 0; k < 3; k++) {
        let v = s[i + k] + amount * (s[i + k] - blur[i + k]);
        od[i + k] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
      od[i + 3] = s[i + 3];
    }

    ctx.putImageData(out, 0, 0);
    return c.toDataURL('image/png');
  } catch {
    return null;
  }
}

export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });
}
