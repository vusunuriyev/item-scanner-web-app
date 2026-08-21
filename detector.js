/** Count glass panes in a window using contrast blobs + mullion gaps. No cloud model. */

function toGray(imageData) {
  const { data, width, height } = imageData;
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    gray[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
  }
  return { gray, width, height };
}

function blur3(gray, w, h) {
  const out = new Uint8Array(gray.length);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          s += gray[(y + dy) * w + (x + dx)];
        }
      }
      out[y * w + x] = (s / 9) | 0;
    }
  }
  return out;
}

function percentile(gray, q) {
  const copy = Array.from(gray).sort((a, b) => a - b);
  return copy[Math.max(0, Math.min(copy.length - 1, (copy.length * q) | 0))];
}

function binarize(gray, w, h, darkIsGlass) {
  const t = percentile(gray, darkIsGlass ? 0.42 : 0.58);
  const bin = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i += 1) {
    bin[i] = darkIsGlass ? (gray[i] < t ? 1 : 0) : (gray[i] > t ? 1 : 0);
  }
  return bin;
}

function components(bin, w, h, minArea, maxArea) {
  const seen = new Uint8Array(w * h);
  const out = [];
  const stack = new Int32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const start = y * w + x;
      if (!bin[start] || seen[start]) continue;
      let top = 0;
      stack[top++] = start;
      seen[start] = 1;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let area = 0;
      while (top) {
        const p = stack[--top];
        const px = p % w;
        const py = (p / w) | 0;
        area += 1;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        const nbs = [];
        if (px > 0) nbs.push(p - 1);
        if (px < w - 1) nbs.push(p + 1);
        if (py > 0) nbs.push(p - w);
        if (py < h - 1) nbs.push(p + w);
        for (let i = 0; i < nbs.length; i += 1) {
          const n = nbs[i];
          if (seen[n] || !bin[n]) continue;
          seen[n] = 1;
          stack[top++] = n;
        }
      }
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (area < minArea || area > maxArea || bw < 8 || bh < 8) continue;
      const fill = area / (bw * bh);
      const aspect = bw / bh;
      if (fill < 0.42 || aspect < 0.22 || aspect > 4.6) continue;
      out.push({ x: minX, y: minY, w: bw, h: bh, area, fill });
    }
  }
  return out;
}

function similarGroup(boxes) {
  if (!boxes.length) return [];
  const sorted = [...boxes].sort((a, b) => b.area - a.area);
  const seed = sorted[0];
  const group = sorted.filter(
    (b) => b.area > seed.area * 0.38 && b.area < seed.area * 2.4 && b.h > seed.h * 0.45 && b.w > seed.w * 0.28
  );
  group.sort((a, b) => (Math.abs(a.y - b.y) > seed.h * 0.35 ? a.y - b.y : a.x - b.x));
  return group.slice(0, 8);
}

function verticalMullionSplit(gray, w, h, box) {
  const x0 = box.x;
  const y0 = box.y;
  const bw = box.w;
  const bh = box.h;
  const hist = new Float32Array(bw);
  for (let x = 0; x < bw; x += 1) {
    let s = 0;
    for (let y = (bh * 0.12) | 0; y < bh * 0.88; y += 1) {
      s += gray[(y0 + y) * w + (x0 + x)];
    }
    hist[x] = s / bh;
  }
  const mid0 = (bw * 0.34) | 0;
  const mid1 = (bw * 0.66) | 0;
  let peak = hist[mid0];
  let peakX = mid0;
  for (let x = mid0; x <= mid1; x += 1) {
    if (hist[x] > peak) {
      peak = hist[x];
      peakX = x;
    }
  }
  const left = hist.slice(0, (bw * 0.28) | 0).reduce((a, b) => a + b, 0) / Math.max(1, (bw * 0.28) | 0);
  const right = hist.slice((bw * 0.72) | 0).reduce((a, b) => a + b, 0) / Math.max(1, bw - ((bw * 0.72) | 0));
  const sides = (left + right) / 2;
  if (peak - sides < 14) return null;
  const gap = Math.max(4, (bw * 0.04) | 0);
  return [
    { x: box.x, y: box.y, w: Math.max(8, peakX - gap), h: box.h },
    { x: box.x + peakX + gap, y: box.y, w: Math.max(8, box.w - peakX - gap), h: box.h },
  ];
}

function unionBox(boxes, pad, w, h) {
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = 0;
  let y1 = 0;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w, x1 + pad);
  y1 = Math.min(h, y1 + pad);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function scorePanes(panes) {
  if (!panes.length) return -1;
  const areas = panes.map((p) => p.area || p.w * p.h);
  const mean = areas.reduce((a, b) => a + b, 0) / areas.length;
  const vari = areas.reduce((s, a) => s + (a - mean) ** 2, 0) / areas.length;
  const rel = mean ? Math.sqrt(vari) / mean : 9;
  return panes.length * 8 - rel * 6 + (panes.length === 2 ? 4 : 0);
}

export function detectWindowGlasses(imageData) {
  const { gray, width, height } = toGray(imageData);
  const smooth = blur3(gray, width, height);
  const minArea = width * height * 0.035;
  const maxArea = width * height * 0.62;
  const attempts = [];

  for (const darkIsGlass of [true, false]) {
    const bin = binarize(smooth, width, height, darkIsGlass);
    const blobs = similarGroup(components(bin, width, height, minArea, maxArea));
    if (blobs.length) attempts.push(blobs);
  }

  const center = {
    x: (width * 0.18) | 0,
    y: (height * 0.2) | 0,
    w: (width * 0.64) | 0,
    h: (height * 0.52) | 0,
  };
  const split = verticalMullionSplit(smooth, width, height, center);
  if (split) attempts.push(split.map((b) => ({ ...b, area: b.w * b.h })));

  let best = [];
  let bestScore = -1;
  for (const panes of attempts) {
    const s = scorePanes(panes);
    if (s > bestScore) {
      bestScore = s;
      best = panes;
    }
  }

  if (!best.length) {
    return { windows: 0, glasses: 0, window: null, panes: [] };
  }

  const windowBox = unionBox(best, Math.max(6, (Math.min(width, height) * 0.03) | 0), width, height);
  return {
    windows: 1,
    glasses: best.length,
    window: windowBox,
    panes: best,
  };
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

export function describeDetection(result) {
  if (!result || !result.windows || !result.glasses) return "No window yet";
  const n = result.glasses;
  const word = n < WORDS.length ? WORDS[n] : String(n);
  const windowWord = result.windows === 1 ? "1 window" : `${result.windows} windows`;
  return `${windowWord} with ${word} glass`;
}
