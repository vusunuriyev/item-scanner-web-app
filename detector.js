/** Detect every window and every glass pane in the frame — rows or columns. */

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

function rangeContrast(gray, w, h, axis) {
  const n = axis === "y" ? h : w;
  const out = new Float32Array(n);
  if (axis === "y") {
    for (let y = 0; y < h; y += 1) {
      let min = 255;
      let max = 0;
      for (let x = 0; x < w; x += 1) {
        const v = gray[y * w + x];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      out[y] = max - min;
    }
  } else {
    for (let x = 0; x < w; x += 1) {
      let min = 255;
      let max = 0;
      for (let y = 0; y < h; y += 1) {
        const v = gray[y * w + x];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      out[x] = max - min;
    }
  }
  return out;
}

function smooth1d(arr, k) {
  const out = new Float32Array(arr.length);
  const r = Math.max(1, k >> 1);
  for (let i = 0; i < arr.length; i += 1) {
    let s = 0;
    let n = 0;
    for (let j = i - r; j <= i + r; j += 1) {
      if (j < 0 || j >= arr.length) continue;
      s += arr[j];
      n += 1;
    }
    out[i] = s / n;
  }
  return out;
}

function highBands(values, minLen, frac) {
  let max = 0;
  for (let i = 0; i < values.length; i += 1) if (values[i] > max) max = values[i];
  const t = max * frac;
  const bands = [];
  let start = -1;
  for (let i = 0; i <= values.length; i += 1) {
    const on = i < values.length && values[i] >= t;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      if (i - start >= minLen) bands.push({ a: start, b: i });
      start = -1;
    }
  }
  return bands;
}

function mergeBands(bands, gap) {
  if (!bands.length) return [];
  const sorted = [...bands].sort((p, q) => p.a - q.a);
  const out = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = out[out.length - 1];
    if (sorted[i].a - prev.b <= gap) prev.b = Math.max(prev.b, sorted[i].b);
    else out.push({ ...sorted[i] });
  }
  return out;
}

function profileMean(gray, w, h, box, axis) {
  const n = axis === "x" ? box.w : box.h;
  const hist = new Float32Array(n);
  if (axis === "x") {
    for (let x = 0; x < box.w; x += 1) {
      let s = 0;
      for (let y = 0; y < box.h; y += 1) s += gray[(box.y + y) * w + (box.x + x)];
      hist[x] = s / box.h;
    }
  } else {
    for (let y = 0; y < box.h; y += 1) {
      let s = 0;
      for (let x = 0; x < box.w; x += 1) s += gray[(box.y + y) * w + (box.x + x)];
      hist[y] = s / box.w;
    }
  }
  return hist;
}

function darkRuns(profile, minWidth) {
  let min = 255;
  let max = 0;
  for (let i = 0; i < profile.length; i += 1) {
    if (profile[i] < min) min = profile[i];
    if (profile[i] > max) max = profile[i];
  }
  if (max - min < 16) return [];
  const t = min + (max - min) * 0.38;
  const runs = [];
  let start = -1;
  for (let i = 0; i <= profile.length; i += 1) {
    const dark = i < profile.length && profile[i] <= t;
    if (dark && start < 0) start = i;
    if (!dark && start >= 0) {
      if (i - start >= minWidth) runs.push({ a: start, b: i });
      start = -1;
    }
  }
  return runs;
}

function consistentRuns(runs, axisLen) {
  const minW = Math.max(10, (axisLen * 0.07) | 0);
  let kept = runs.filter((r) => r.b - r.a >= minW);
  if (kept.length > 6) {
    kept = [...kept]
      .sort((a, b) => b.b - b.a - (a.b - a.a))
      .slice(0, 6)
      .sort((a, b) => a.a - b.a);
  }
  if (kept.length <= 1) return kept;
  const widths = kept.map((r) => r.b - r.a).sort((a, b) => a - b);
  const med = widths[(widths.length / 2) | 0];
  const similar = kept.filter((r) => {
    const w = r.b - r.a;
    return w > med * 0.42 && w < med * 2.4;
  });
  return similar.length ? similar : kept;
}

function scoredBands(values, minLen, frac) {
  const bands = mergeBands(highBands(values, minLen, frac), 10);
  const scored = bands.map((b) => {
    let s = 0;
    for (let i = b.a; i < b.b; i += 1) s += values[i];
    return { ...b, score: s };
  });
  if (!scored.length) return [];
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0].score;
  return scored.filter((b) => b.score > best * 0.48).sort((a, b) => a.a - b.a);
}

function panesFromGrid(box, xRuns, yRuns) {
  const rows = yRuns.length ? yRuns : [{ a: 0, b: box.h }];
  const cols = xRuns.length ? xRuns : [{ a: 0, b: box.w }];
  const panes = [];
  for (const row of rows) {
    for (const col of cols) {
      const pw = col.b - col.a;
      const ph = row.b - row.a;
      if (pw < 12 || ph < 12) continue;
      const aspect = pw / ph;
      if (aspect < 0.18 || aspect > 5.5) continue;
      panes.push({
        x: box.x + col.a,
        y: box.y + row.a,
        w: pw,
        h: ph,
        area: pw * ph,
      });
    }
  }
  return panes;
}

function splitBoxToPanes(gray, w, h, box, allowWhole) {
  const minX = Math.max(4, (box.w * 0.04) | 0);
  const minY = Math.max(4, (box.h * 0.04) | 0);
  const xProf = smooth1d(profileMean(gray, w, h, box, "x"), Math.max(3, (box.w * 0.03) | 0));
  const yProf = smooth1d(profileMean(gray, w, h, box, "y"), Math.max(3, (box.h * 0.03) | 0));
  const xRuns = consistentRuns(darkRuns(xProf, minX), box.w);
  const yRuns = consistentRuns(darkRuns(yProf, minY), box.h);
  const panes = panesFromGrid(box, xRuns, yRuns);
  if (panes.length) return panes;
  if (allowWhole) return [{ ...box, area: box.w * box.h }];
  return [];
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
      if (area < minArea || area > maxArea || bw < 6 || bh < 6) continue;
      const fill = area / (bw * bh);
      const aspect = bw / bh;
      if (fill < 0.35 || aspect < 0.15 || aspect > 6.5) continue;
      out.push({ x: minX, y: minY, w: bw, h: bh, area, fill });
    }
  }
  return out;
}

function iou(a, b) {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const ua = a.w * a.h + b.w * b.h - inter;
  return ua ? inter / ua : 0;
}

function nms(boxes, thresh) {
  const sorted = [...boxes].sort((a, b) => b.area - a.area);
  const kept = [];
  for (const box of sorted) {
    if (kept.some((k) => iou(k, box) > thresh)) continue;
    kept.push(box);
  }
  return kept;
}

function overlap1d(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function sameWindow(a, b) {
  const gapX = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const gapY = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
  const ovY = overlap1d(a.y, a.y + a.h, b.y, b.y + b.h);
  const ovX = overlap1d(a.x, a.x + a.w, b.x, b.x + b.w);
  const nearX = gapX < Math.min(a.w, b.w) * 0.42 && ovY > Math.min(a.h, b.h) * 0.28;
  const nearY = gapY < Math.min(a.h, b.h) * 0.42 && ovX > Math.min(a.w, b.w) * 0.28;
  return nearX || nearY;
}

function clusterPanes(panes) {
  const parent = panes.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < panes.length; i += 1) {
    for (let j = i + 1; j < panes.length; j += 1) {
      if (sameWindow(panes[i], panes[j])) {
        parent[find(j)] = find(i);
      }
    }
  }
  const groups = new Map();
  panes.forEach((pane, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(pane);
  });
  return [...groups.values()];
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

function sortPanes(panes) {
  const medH = panes.reduce((s, p) => s + p.h, 0) / panes.length;
  return [...panes].sort((a, b) => (Math.abs(a.y - b.y) > medH * 0.4 ? a.y - b.y : a.x - b.x));
}

export function detectWindowGlasses(imageData) {
  const { gray, width, height } = toGray(imageData);
  const smooth = blur3(gray, width, height);
  const pad = Math.max(4, (Math.min(width, height) * 0.02) | 0);

  const yContrast = smooth1d(rangeContrast(smooth, width, height, "y"), 5);
  const yBands = scoredBands(yContrast, Math.max(10, (height * 0.05) | 0), 0.34);
  const bands = yBands.length
    ? yBands
    : [{ a: (height * 0.06) | 0, b: (height * 0.72) | 0 }];

  let paneCandidates = [];
  for (const yb of bands) {
    const box = {
      x: (width * 0.02) | 0,
      y: yb.a,
      w: (width * 0.96) | 0,
      h: Math.max(12, yb.b - yb.a),
    };
    paneCandidates = paneCandidates.concat(splitBoxToPanes(smooth, width, height, box, false));
  }

  const t = percentile(smooth, 0.4);
  const bin = new Uint8Array(width * height);
  for (let i = 0; i < smooth.length; i += 1) bin[i] = smooth[i] < t ? 1 : 0;
  const blobs = components(bin, width, height, width * height * 0.008, width * height * 0.34);
  paneCandidates = paneCandidates.concat(blobs);

  const panes = nms(
    paneCandidates.filter((p) => {
      const aspect = p.w / p.h;
      return p.w >= 12 && p.h >= 12 && aspect >= 0.18 && aspect <= 5.5 && p.area > width * height * 0.007;
    }),
    0.45
  );

  if (!panes.length) {
    return { windows: 0, glasses: 0, window: null, windowBoxes: [], panes: [] };
  }

  const groups = clusterPanes(panes)
    .map((group) => {
      const areas = group.map((p) => p.area).sort((a, b) => a - b);
      const med = areas[(areas.length / 2) | 0];
      return group.filter((p) => p.area > med * 0.28 && p.area < med * 3.5);
    })
    .filter((group) => group.length)
    .map((group) => {
    const win = unionBox(group, pad, width, height);
    const refined = nms(splitBoxToPanes(smooth, width, height, win, true), 0.4);
    const use = refined.length >= group.length ? refined : group;
    return { window: unionBox(use, pad, width, height), panes: sortPanes(use) };
  });

  groups.sort((a, b) => a.window.y - b.window.y || a.window.x - b.window.x);

  const allPanes = [];
  for (const g of groups) {
    for (const p of g.panes) allPanes.push(p);
  }

  return {
    windows: groups.length,
    glasses: allPanes.length,
    window: groups[0].window,
    windowBoxes: groups.map((g) => g.window),
    panes: allPanes,
  };
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

export function describeDetection(result) {
  if (!result || !result.windows || !result.glasses) return "No window yet";
  const windowWord = result.windows === 1 ? "1 window" : `${result.windows} windows`;
  const n = result.glasses;
  const word = n < WORDS.length ? WORDS[n] : String(n);
  return `${windowWord} with ${word} glass`;
}
