import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";
import { BROAD_LABELS, REFINE, GENERIC_LABELS } from "./labels.js?v=3";

env.allowLocalModels = false;
env.useBrowserCache = true;

const WIKI_API = "https://en.wikipedia.org/api/rest_v1/page/summary/";
const STORAGE_KEY = "openlot-lots-v1";
const NOT_FOR_SALE = new Set([
  "person",
  "man",
  "woman",
  "child",
  "cat",
  "dog",
  "bird",
  "horse",
  "sheep",
  "cow",
  "elephant",
  "bear",
  "zebra",
  "giraffe",
]);
const WIKI_ALIASES = {
  tv: "Television",
  television: "Television",
  smartphone: "Smartphone",
  "mobile phone": "Smartphone",
  "cell phone": "Smartphone",
  "computer mouse": "Computer mouse",
  "computer monitor": "Computer monitor",
  window: "Window",
  door: "Door",
  "sliding glass door": "Sliding glass door",
  "garage door": "Garage door",
  curtain: "Curtain",
  blinds: "Window blind",
};

const els = {
  home: document.getElementById("home"),
  camera: document.getElementById("camera"),
  lots: document.getElementById("lots"),
  start: document.getElementById("start-camera"),
  startLabel: document.getElementById("start-label"),
  live: document.getElementById("live"),
  still: document.getElementById("still"),
  liveChip: document.getElementById("live-chip"),
  shutter: document.getElementById("shutter"),
  closeCamera: document.getElementById("close-camera"),
  torch: document.getElementById("toggle-torch"),
  flip: document.getElementById("flip-camera"),
  resume: document.getElementById("resume-camera"),
  scanOverlay: document.getElementById("scan-overlay"),
  scanOverlayText: document.getElementById("scan-overlay-text"),
  camError: document.getElementById("cam-error"),
  camErrorText: document.getElementById("cam-error-text"),
  camRetry: document.getElementById("cam-retry"),
  sheet: document.getElementById("sheet"),
  sheetBody: document.getElementById("sheet-body"),
  sheetBackdrop: document.getElementById("sheet-backdrop"),
  toast: document.getElementById("toast"),
  lotCount: document.getElementById("lot-count"),
  lotList: document.getElementById("lot-list"),
  photo: document.getElementById("photo-input"),
  photoCam: document.getElementById("photo-input-cam"),
};

const state = {
  classifier: null,
  stream: null,
  facingMode: "environment",
  torchOn: false,
  scanning: false,
  startingCamera: false,
  frame: null,
  lastFocus: null,
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label || "timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function article(name) {
  return /^[aeiou]/i.test(name) ? "an" : "a";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pretty(name) {
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}

function wikiTitle(name) {
  return WIKI_ALIASES[name] || pretty(name);
}

function showScreen(id) {
  for (const screen of document.querySelectorAll(".screen")) {
    screen.classList.toggle("hidden", screen.id !== id);
  }
}

function toast(message) {
  els.toast.hidden = false;
  els.toast.textContent = message;
  clearTimeout(toast.tid);
  toast.tid = setTimeout(() => {
    els.toast.hidden = true;
  }, 2800);
}

function loadLots() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLots(lots) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lots));
  refreshLotCount();
}

function refreshLotCount() {
  const n = loadLots().length;
  els.lotCount.hidden = n === 0;
  els.lotCount.textContent = String(n);
}

function setStill(on, dataUrl) {
  if (on && dataUrl) els.still.src = dataUrl;
  els.still.classList.toggle("is-on", on);
  els.still.toggleAttribute("hidden", false);
  els.resume.hidden = !on;
  els.liveChip.hidden = on;
}

function showScanOverlay(text) {
  els.scanOverlay.classList.remove("hidden");
  els.scanOverlayText.textContent = text;
}

function hideScanOverlay() {
  els.scanOverlay.classList.add("hidden");
}

function showCamError(text) {
  els.camError.classList.remove("hidden");
  els.camErrorText.textContent = text;
}

function hideCamError() {
  els.camError.classList.add("hidden");
}

function tracksLive() {
  return Boolean(
    state.stream && state.stream.getVideoTracks().some((track) => track.readyState === "live")
  );
}

function prepareVideoEl() {
  const video = els.live;
  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
  video.setAttribute("muted", "");
  video.setAttribute("autoplay", "");
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.removeAttribute("hidden");
  video.style.display = "block";
}

function stopStream() {
  if (state.stream) {
    for (const track of state.stream.getTracks()) {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    }
    state.stream = null;
  }
  els.live.srcObject = null;
}

async function loadModel() {
  els.start.disabled = true;
  els.startLabel.textContent = "Loading vision… 0%";
  const onProgress = (info) => {
    if (!info) return;
    if (info.status === "progress" && typeof info.progress === "number") {
      els.startLabel.textContent = `Loading vision… ${Math.max(0, Math.min(99, Math.round(info.progress)))}%`;
    } else if (info.status === "ready" || info.status === "done") {
      els.startLabel.textContent = "Almost ready…";
    }
  };
  const modelId = "Xenova/clip-vit-base-patch32";
  const attempts = [
    { dtype: "q8" },
    { dtype: "q8", device: "wasm" },
    { device: "wasm" },
  ];
  let lastError;
  for (const extra of attempts) {
    try {
      state.classifier = await pipeline("zero-shot-image-classification", modelId, {
        progress_callback: onProgress,
        ...extra,
      });
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      console.warn(err);
    }
  }
  if (!state.classifier) throw lastError || new Error("Could not load CLIP");
  els.startLabel.textContent = "Calibrating…";
  try {
    const boot = document.createElement("canvas");
    boot.width = 224;
    boot.height = 224;
    const bootUrl = await canvasToObjectUrl(boot);
    await withTimeout(
      state.classifier(bootUrl, BROAD_LABELS, { hypothesis_template: "a photo of a {}" }),
      20000,
      "warmup"
    );
    URL.revokeObjectURL(bootUrl);
  } catch (warmErr) {
    console.warn(warmErr);
  }
  els.start.disabled = false;
  els.startLabel.textContent = "Open the camera";
}

async function openCameraStream() {
  prepareVideoEl();
  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: state.facingMode },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    if (err && err.name === "OverconstrainedError") {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: state.facingMode },
      });
    } else {
      throw err;
    }
  }
  state.stream = stream;
  els.live.srcObject = stream;
  const ready = new Promise((resolve) => {
    if (els.live.readyState >= 2) resolve();
    else els.live.onloadedmetadata = () => resolve();
  });
  await Promise.race([ready, delay(2000)]);
  await els.live.play();
  setupTorchButton();
}

async function startCamera() {
  if (state.startingCamera) return;
  state.startingCamera = true;
  hideCamError();
  showScreen("camera");
  setStill(false);
  hideScanOverlay();
  els.liveChip.hidden = false;
  els.liveChip.textContent = "Fill the frame, then tap the shutter";

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showCamError("This browser cannot open a live camera. Use a photo from your library instead.");
    state.startingCamera = false;
    return;
  }

  try {
    const hadStream = tracksLive();
    stopStream();
    if (hadStream) await delay(350);
    await openCameraStream();
    hideCamError();
  } catch (err) {
    console.error(err);
    const denied = /not allowed|permission|denied|NotAllowedError/i.test(String(err && err.name) + String(err));
    const busy = /NotReadableError|AbortError|in use|could not start/i.test(String(err && err.name) + String(err));
    if (busy) {
      stopStream();
      await delay(500);
      try {
        await openCameraStream();
        hideCamError();
        state.startingCamera = false;
        return;
      } catch (retryErr) {
        console.error(retryErr);
      }
    }
    showCamError(
      denied
        ? "Camera permission is off. In iPhone Settings, allow Camera for Safari, then tap Turn camera on."
        : "The camera did not start. Tap Turn camera on — or pick a photo from your library."
    );
  } finally {
    state.startingCamera = false;
  }
}

async function resumeLiveCamera() {
  state.scanning = false;
  els.shutter.classList.remove("busy");
  hideScanOverlay();
  closeSheet(false);
  setStill(false);
  showScreen("camera");
  hideCamError();
  if (tracksLive()) {
    prepareVideoEl();
    try {
      await els.live.play();
      els.liveChip.hidden = false;
      els.liveChip.textContent = "Fill the frame, then tap the shutter";
      return;
    } catch (err) {
      console.warn(err);
    }
  }
  await startCamera();
}

function setupTorchButton() {
  const track = state.stream && state.stream.getVideoTracks()[0];
  const caps = track && track.getCapabilities ? track.getCapabilities() : {};
  els.torch.hidden = !caps.torch;
  els.torch.setAttribute("aria-pressed", "false");
  state.torchOn = false;
}

async function toggleTorch() {
  const track = state.stream && state.stream.getVideoTracks()[0];
  if (!track || !track.getCapabilities || !track.getCapabilities().torch) return;
  state.torchOn = !state.torchOn;
  try {
    await track.applyConstraints({ advanced: [{ torch: state.torchOn }] });
    els.torch.setAttribute("aria-pressed", String(state.torchOn));
  } catch {
    state.torchOn = false;
    toast("Flashlight is not available on this camera.");
  }
}

async function flipCamera() {
  state.facingMode = state.facingMode === "environment" ? "user" : "environment";
  await startCamera();
}

function drawScaled(source, maxEdge) {
  const w = source.videoWidth || source.naturalWidth || source.width;
  const h = source.videoHeight || source.naturalHeight || source.height;
  const scale = Math.min(1, maxEdge / Math.max(w, h, 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function centerCrop(sourceCanvas, ratio) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const cw = Math.max(1, Math.round(w * ratio));
  const ch = Math.max(1, Math.round(h * ratio));
  const x = Math.round((w - cw) / 2);
  const y = Math.round((h - ch) / 2);
  const out = document.createElement("canvas");
  out.width = cw;
  out.height = ch;
  out.getContext("2d").drawImage(sourceCanvas, x, y, cw, ch, 0, 0, cw, ch);
  return out;
}

function canvasToObjectUrl(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("Could not read the photo"));
        else resolve(URL.createObjectURL(blob));
      },
      "image/jpeg",
      0.88
    );
  });
}

function preferSpecific(ranked) {
  if (!ranked.length) return ranked;
  const top = ranked[0];
  const next = ranked[1];
  if (next && GENERIC_LABELS.has(top.label) && top.score - next.score < 0.1) {
    return [next, top, ...ranked.slice(2)];
  }
  return ranked;
}

async function classifyUrl(url, labels) {
  const raw = await state.classifier(url, labels, {
    hypothesis_template: "a photo of a {}",
  });
  return (raw || []).map((row) => ({
    class: row.label,
    label: row.label,
    score: row.score,
  }));
}

async function identify(canvas) {
  const tight = centerCrop(canvas, 0.7);
  const tightUrl = await canvasToObjectUrl(tight);
  try {
    let ranked = preferSpecific(await classifyUrl(tightUrl, BROAD_LABELS));
    const head = ranked[0];
    const shouldRefine =
      head &&
      (head.label === "window" ||
        head.label === "door" ||
        head.label === "sliding glass door" ||
        head.label === "garage door");
    const refineLabels = shouldRefine ? REFINE[head.label] : null;
    if (refineLabels && refineLabels.length) {
      const refined = preferSpecific(await classifyUrl(tightUrl, refineLabels));
      if (refined[0]) {
        ranked = [
          refined[0],
          ...refined.slice(1),
          ...ranked.filter((row) => row.label !== refined[0].label),
        ];
      }
    }
    return ranked;
  } finally {
    URL.revokeObjectURL(tightUrl);
  }
}

function captureStillFromVideo() {
  const canvas = drawScaled(els.live, 960);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  setStill(true, dataUrl);
  return { canvas, dataUrl };
}

async function scanFromCanvas(canvas, dataUrl) {
  if (!state.classifier) {
    toast("The scanner is still loading. Give it a moment.");
    return;
  }
  state.scanning = true;
  els.shutter.classList.add("busy");
  showScanOverlay("Looking at this…");
  try {
    const detectCanvas = drawScaled(canvas, 384);
    const ranked = await withTimeout(identify(detectCanvas), 28000, "scan-timeout");
    state.frame = { dataUrl, predictions: ranked };
    const top = ranked[0];
    if (!top) {
      openUnknownSheet(dataUrl);
      return;
    }
    await openResultSheet(top, ranked, dataUrl);
  } catch (err) {
    console.error(err);
    openUnknownSheet(dataUrl, "I needed a bit longer. Type the name, or scan again with more light.");
  } finally {
    state.scanning = false;
    els.shutter.classList.remove("busy");
    hideScanOverlay();
  }
}

async function shutter() {
  if (state.scanning) return;
  if (!tracksLive() || els.live.readyState < 2) {
    toast("Turning the camera on…");
    await startCamera();
    return;
  }
  const { canvas, dataUrl } = captureStillFromVideo();
  await scanFromCanvas(canvas, dataUrl);
}

async function scanFile(file) {
  if (!file) return;
  let source = null;
  try {
    source = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("bad image"));
      };
      img.src = url;
    });
  }
  try {
    const canvas = drawScaled(source, 960);
    if (source.close) source.close();
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    showScreen("camera");
    setStill(true, dataUrl);
    await scanFromCanvas(canvas, dataUrl);
  } catch {
    toast("Could not read that photo.");
  }
}

async function fetchWiki(name) {
  const title = wikiTitle(name);
  try {
    const res = await fetch(WIKI_API + encodeURIComponent(title), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.type === "disambiguation") return { title, extract: data.extract };
    return {
      title: data.title || title,
      extract: data.extract || "",
      url: data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page,
    };
  } catch {
    return null;
  }
}

function marketplaceLinks(query) {
  const q = encodeURIComponent(query);
  return [
    {
      name: "See what it sells for",
      hint: "eBay sold listings",
      href: `https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1`,
    },
    {
      name: "List on eBay",
      hint: "Start a listing",
      href: `https://www.ebay.com/sl/prelist/suggest?_rdt=on&query=${q}`,
    },
    {
      name: "Facebook Marketplace",
      hint: "Search nearby",
      href: `https://www.facebook.com/marketplace/search/?query=${q}`,
    },
    {
      name: "Mercari",
      hint: "Open search",
      href: `https://www.mercari.com/search/?keyword=${q}`,
    },
    {
      name: "OfferUp",
      hint: "Local selling",
      href: `https://offerup.com/search?q=${q}`,
    },
    {
      name: "Craigslist",
      hint: "Choose your city",
      href: `https://www.craigslist.org/search/sss?query=${q}`,
    },
  ];
}

function buyLinks(query) {
  const q = encodeURIComponent(query);
  return [
    {
      name: "Amazon",
      hint: "Buy one",
      href: `https://www.amazon.com/s?k=${q}`,
    },
    {
      name: "Google Shopping",
      hint: "Compare prices",
      href: `https://www.google.com/search?tbm=shop&q=${q}`,
    },
  ];
}

function openSheet(html) {
  els.sheet.hidden = false;
  els.sheetBody.innerHTML = html;
  state.lastFocus = document.activeElement;
  const title = document.getElementById("sheet-title");
  if (title) title.focus();
}

function closeSheet(resumeAfter) {
  els.sheet.hidden = true;
  els.sheetBody.innerHTML = "";
  if (state.lastFocus && state.lastFocus.focus) state.lastFocus.focus();
  if (resumeAfter) resumeLiveCamera();
}

function resultCopy(name, score, runnerUp) {
  const item = pretty(name);
  const lead = score - (runnerUp || 0);
  if (lead >= 0.03 || score >= 0.12) {
    return `Hey, this is ${article(name)} ${item}. What do you want to do with it?`;
  }
  return `Hey, this looks like ${article(name)} ${item}. What do you want to do with it?`;
}

async function openResultSheet(top, all, dataUrl) {
  const wiki = await fetchWiki(top.class || top.label);
  const name = top.class || top.label;
  const runnerUp = all && all[1] ? all[1].score : 0;
  const intro = resultCopy(name, top.score || 0, runnerUp);
  const canSell = !NOT_FOR_SALE.has(name) && !NOT_FOR_SALE.has(name.split(" ")[0]);
  const others = (all || []).filter((p) => (p.class || p.label) !== name).slice(0, 4);
  const extract = wiki && wiki.extract ? wiki.extract : "";
  openSheet(`
      <div class="result-hero">
        <img src="${dataUrl}" alt="Scanned ${escapeHtml(pretty(name))}" />
        <div>
          <p class="sheet-kicker">Scanned</p>
          <h2 id="sheet-title" tabindex="-1">${escapeHtml(intro)}</h2>
          <p class="confidence">${Math.round((top.score || 0) * 100)}% match${wiki && wiki.title ? ` · ${escapeHtml(wiki.title)}` : ""}</p>
        </div>
      </div>
      ${extract ? `<p class="sheet-extract">${escapeHtml(extract)}</p>` : ""}
      <div class="choices">
        ${
          canSell
            ? `<button class="choice" data-act="sell" type="button">
                <span>Sell it<div><small>See prices and open marketplaces</small></div></span>
                <span class="choice-mark" aria-hidden="true">→</span>
              </button>`
            : `<p class="sheet-extract">I won’t list ${escapeHtml(pretty(name).toLowerCase())} for sale.</p>`
        }
        ${
          wiki && wiki.url
            ? `<button class="choice" data-act="learn" type="button">
                <span>Learn more<div><small>Open the Wikipedia page</small></div></span>
                <span class="choice-mark" aria-hidden="true">→</span>
              </button>`
            : ""
        }
        <button class="choice" data-act="buy" type="button">
          <span>Find one to buy<div><small>Amazon and Google Shopping</small></div></span>
          <span class="choice-mark" aria-hidden="true">→</span>
        </button>
        <button class="choice" data-act="save" type="button">
          <span>Save to my lot<div><small>Keep this scan on this phone</small></div></span>
          <span class="choice-mark" aria-hidden="true">→</span>
        </button>
      </div>
      ${
        others.length
          ? `<div class="also">${others
              .map((p) => {
                const label = p.class || p.label;
                return `<button type="button" data-alt="${escapeHtml(label)}">Not that — it’s ${article(label)} ${escapeHtml(label)}</button>`;
              })
              .join("")}</div>`
          : ""
      }
      <form class="manual" id="rename-form">
        <label for="manual-name">Wrong name? Type it</label>
        <input id="manual-name" name="name" maxlength="80" placeholder="e.g. window" />
        <button class="primary" type="submit">Use this name</button>
      </form>
      <button class="primary" data-act="rescan" type="button">Turn the camera on again</button>
      <button class="quiet" data-act="rescan" type="button">Scan something else</button>
    `);

  els.sheetBody.dataset.item = name;
  els.sheetBody.dataset.score = String(top.score || 0);
  els.sheetBody.dataset.image = dataUrl;
  els.sheetBody.dataset.wiki = wiki && wiki.url ? wiki.url : "";
}

function openUnknownSheet(dataUrl, message) {
  openSheet(`
      <p class="sheet-kicker">Need a name</p>
      <h2 id="sheet-title" tabindex="-1">I still want to help. What is this?</h2>
      <p class="sheet-extract">${escapeHtml(message || "Fill the frame with the window, door, or object, add light, or type the name.")}</p>
      <form class="manual" id="manual-form">
        <label for="manual-name">Item name</label>
        <input id="manual-name" name="name" required maxlength="80" placeholder="e.g. window" />
        <button class="primary" type="submit">That’s the item</button>
      </form>
      <button class="primary" data-act="rescan" type="button">Turn the camera on again</button>
    `);
  els.sheetBody.dataset.image = dataUrl;
}

function openSellSheet(item, dataUrl) {
  const label = pretty(item);
  const links = marketplaceLinks(label);
  openSheet(`
      <p class="sheet-kicker">Put it on the stall</p>
      <h2 id="sheet-title" tabindex="-1">Where ${article(item)} ${escapeHtml(label.toLowerCase())} sells</h2>
      <p class="sheet-extract">Check recent sold prices first, then jump into a marketplace listing with this name filled in.</p>
      <div class="conditions" role="group" aria-label="Condition">
        <button type="button" data-cond="New" aria-pressed="false">New</button>
        <button type="button" data-cond="Like new" aria-pressed="true">Like new</button>
        <button type="button" data-cond="Good" aria-pressed="false">Good</button>
        <button type="button" data-cond="Fair" aria-pressed="false">Fair</button>
      </div>
      <div class="markets">
        ${links
          .map(
            (l) =>
              `<a class="market" href="${l.href}" target="_blank" rel="noopener noreferrer">${l.name}<span>${l.hint}</span></a>`
          )
          .join("")}
      </div>
      <button class="primary" data-act="save" type="button" style="margin-top:14px">Save this lot</button>
      <button class="quiet" data-act="back-result" type="button">Back</button>
    `);
  els.sheetBody.dataset.item = item;
  els.sheetBody.dataset.image = dataUrl;
  els.sheetBody.dataset.condition = "Like new";
}

function openBuySheet(item) {
  const label = pretty(item);
  const links = buyLinks(label);
  openSheet(`
      <p class="sheet-kicker">Find one</p>
      <h2 id="sheet-title" tabindex="-1">Looking for ${article(item)} ${escapeHtml(label.toLowerCase())}?</h2>
      <div class="markets">
        ${links
          .map(
            (l) =>
              `<a class="market" href="${l.href}" target="_blank" rel="noopener noreferrer">${l.name}<span>${l.hint}</span></a>`
          )
          .join("")}
      </div>
      <button class="quiet" data-act="back-result" type="button">Back</button>
    `);
  els.sheetBody.dataset.item = item;
}

function saveCurrentLot() {
  const item = els.sheetBody.dataset.item;
  const image = els.sheetBody.dataset.image;
  if (!item || !image) return;
  const lots = loadLots();
  lots.unshift({
    id: String(Date.now()),
    name: item,
    condition: els.sheetBody.dataset.condition || "Like new",
    image,
    createdAt: new Date().toISOString(),
  });
  saveLots(lots.slice(0, 24));
  toast(`Saved ${pretty(item)} to your lot.`);
}

function renderLots() {
  const lots = loadLots();
  if (!lots.length) {
    els.lotList.innerHTML = `<li class="empty">Nothing on the stall yet. Scan an object and tap Save to my lot.</li>`;
    return;
  }
  els.lotList.innerHTML = lots
    .map(
      (lot) => `
      <li>
        <button class="lot-card" type="button" data-lot="${lot.id}">
          <img src="${lot.image}" alt="" />
          <div>
            <h3>${escapeHtml(pretty(lot.name))}</h3>
            <p>${escapeHtml(lot.condition)} · ${escapeHtml(new Date(lot.createdAt).toLocaleDateString())}</p>
          </div>
        </button>
      </li>`
    )
    .join("");
}

async function reopenLot(id) {
  const lot = loadLots().find((l) => l.id === id);
  if (!lot) return;
  showScreen("camera");
  setStill(true, lot.image);
  await openResultSheet({ class: lot.name, score: 1 }, [], lot.image);
}

function closeCamera() {
  closeSheet(false);
  hideScanOverlay();
  hideCamError();
  setStill(false);
  stopStream();
  showScreen("home");
}

async function applyTypedName(form) {
  const input = form.querySelector("#manual-name");
  const name = (input && input.value ? input.value : "").trim().toLowerCase();
  if (!name) return;
  await openResultSheet({ class: name, score: 1 }, [], els.sheetBody.dataset.image);
}

els.start.addEventListener("click", startCamera);
els.closeCamera.addEventListener("click", closeCamera);
els.shutter.addEventListener("click", shutter);
els.torch.addEventListener("click", toggleTorch);
els.flip.addEventListener("click", flipCamera);
els.resume.addEventListener("click", resumeLiveCamera);
els.camRetry.addEventListener("click", startCamera);
els.sheetBackdrop.addEventListener("click", () => resumeLiveCamera());
document.getElementById("lots-open").addEventListener("click", () => {
  renderLots();
  showScreen("lots");
});
document.getElementById("lots-back").addEventListener("click", () => {
  showScreen("home");
});
els.photo.addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  scanFile(file);
});
els.photoCam.addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  scanFile(file);
});

els.sheetBody.addEventListener("click", async (event) => {
  const alt = event.target.closest("[data-alt]");
  if (alt) {
    const name = alt.getAttribute("data-alt");
    const pred =
      ((state.frame && state.frame.predictions) || []).find((p) => (p.class || p.label) === name) || {
        class: name,
        score: 0.5,
      };
    await openResultSheet(pred, (state.frame && state.frame.predictions) || [], els.sheetBody.dataset.image);
    return;
  }
  const cond = event.target.closest("[data-cond]");
  if (cond) {
    for (const btn of els.sheetBody.querySelectorAll("[data-cond]")) {
      btn.setAttribute("aria-pressed", String(btn === cond));
    }
    els.sheetBody.dataset.condition = cond.getAttribute("data-cond");
    return;
  }
  const act = event.target.closest("[data-act]");
  if (!act) return;
  const action = act.getAttribute("data-act");
  const item = els.sheetBody.dataset.item;
  const image = els.sheetBody.dataset.image;
  if (action === "sell") openSellSheet(item, image);
  if (action === "buy") openBuySheet(item);
  if (action === "learn") {
    const url = els.sheetBody.dataset.wiki;
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }
  if (action === "save") saveCurrentLot();
  if (action === "rescan") resumeLiveCamera();
  if (action === "back-result") {
    const pred = {
      class: item,
      score: Number(els.sheetBody.dataset.score || 0.9),
    };
    await openResultSheet(pred, (state.frame && state.frame.predictions) || [], image);
  }
});

els.sheetBody.addEventListener("submit", async (event) => {
  if (event.target.id !== "manual-form" && event.target.id !== "rename-form") return;
  event.preventDefault();
  await applyTypedName(event.target);
});

els.lotList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-lot]");
  if (card) reopenLot(card.getAttribute("data-lot"));
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  if (els.camera.classList.contains("hidden")) return;
  if (els.sheet.hidden && !els.still.classList.contains("is-on") && !tracksLive()) {
    startCamera();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.sheet.hidden) {
    resumeLiveCamera();
    return;
  }
  if (event.key === " " && !els.camera.classList.contains("hidden") && els.sheet.hidden) {
    if (event.target === document.body || event.target === els.shutter) {
      event.preventDefault();
      shutter();
    }
  }
});

refreshLotCount();
loadModel().catch((err) => {
  console.error(err);
  els.start.disabled = true;
  els.startLabel.textContent = "Could not load vision";
  toast("Vision model did not load. Check your connection and refresh.");
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
