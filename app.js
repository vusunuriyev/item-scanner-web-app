import { detectWindowGlasses, describeDetection } from "./detector.js?v=7";

const STORAGE_KEY = "openlot-windows-v1";

const els = {
  home: document.getElementById("home"),
  camera: document.getElementById("camera"),
  invoice: document.getElementById("invoice"),
  start: document.getElementById("start-camera"),
  live: document.getElementById("live"),
  overlay: document.getElementById("overlay"),
  still: document.getElementById("still"),
  closeCamera: document.getElementById("close-camera"),
  readout: document.getElementById("readout"),
  addInvoice: document.getElementById("add-invoice"),
  cartOpen: document.getElementById("cart-open"),
  cartBadge: document.getElementById("cart-badge"),
  homeCart: document.getElementById("home-cart"),
  homeCartCount: document.getElementById("home-cart-count"),
  invoiceList: document.getElementById("invoice-list"),
  invoiceBack: document.getElementById("invoice-back"),
  invoiceClear: document.getElementById("invoice-clear"),
  camError: document.getElementById("cam-error"),
  camErrorText: document.getElementById("cam-error-text"),
  camRetry: document.getElementById("cam-retry"),
  photo: document.getElementById("photo-input"),
  toast: document.getElementById("toast"),
};

const state = {
  stream: null,
  facingMode: "environment",
  starting: false,
  loop: 0,
  last: { windows: 0, glasses: 0, window: null, windowBoxes: [], panes: [] },
  work: document.createElement("canvas"),
};

function toast(message) {
  els.toast.hidden = false;
  els.toast.textContent = message;
  clearTimeout(toast.tid);
  toast.tid = setTimeout(() => {
    els.toast.hidden = true;
  }, 2200);
}

function showScreen(id) {
  for (const screen of document.querySelectorAll(".screen")) {
    screen.classList.toggle("hidden", screen.id !== id);
  }
}

function loadCart() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveCart(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  refreshCart();
}

function refreshCart() {
  const n = loadCart().length;
  els.cartBadge.hidden = n === 0;
  els.cartBadge.textContent = String(n);
  els.homeCartCount.hidden = n === 0;
  els.homeCartCount.textContent = String(n);
}

function tracksLive() {
  return Boolean(state.stream && state.stream.getVideoTracks().some((t) => t.readyState === "live"));
}

function prepareVideo() {
  const video = els.live;
  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.style.display = "block";
}

function stopStream() {
  if (state.loop) {
    cancelAnimationFrame(state.loop);
    state.loop = 0;
  }
  if (state.stream) {
    for (const track of state.stream.getTracks()) track.stop();
    state.stream = null;
  }
  els.live.srcObject = null;
}

async function openStream() {
  prepareVideo();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: state.facingMode },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });
  state.stream = stream;
  els.live.srcObject = stream;
  await Promise.race([
    new Promise((resolve) => {
      if (els.live.readyState >= 2) resolve();
      else els.live.onloadedmetadata = () => resolve();
    }),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  await els.live.play();
}

function showCamError(text) {
  els.camError.classList.remove("hidden");
  els.camErrorText.textContent = text;
}

function hideCamError() {
  els.camError.classList.add("hidden");
}

async function startCamera() {
  if (state.starting) return;
  state.starting = true;
  hideCamError();
  showScreen("camera");
  els.still.classList.remove("is-on");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showCamError("This browser cannot open the camera. Use a photo instead.");
    state.starting = false;
    return;
  }
  try {
    stopStream();
    await openStream();
    hideCamError();
    loopDetect();
  } catch (err) {
    console.error(err);
    showCamError("Allow the camera in Safari settings, then tap Turn camera on.");
  } finally {
    state.starting = false;
  }
}

function closeCamera() {
  stopStream();
  showScreen("home");
}

function mapRect(box, srcW, srcH, dstW, dstH) {
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const ox = (dstW - srcW * scale) / 2;
  const oy = (dstH - srcH * scale) / 2;
  return {
    x: box.x * scale + ox,
    y: box.y * scale + oy,
    w: box.w * scale,
    h: box.h * scale,
  };
}

function drawOverlay(result, srcW, srcH) {
  const canvas = els.overlay;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!result.panes || !result.panes.length) return;

  const boxes = result.windowBoxes && result.windowBoxes.length ? result.windowBoxes : result.window ? [result.window] : [];
  ctx.strokeStyle = "rgba(232, 197, 71, 0.95)";
  ctx.lineWidth = 3 * dpr;
  for (const windowBox of boxes) {
    const win = mapRect(windowBox, srcW, srcH, canvas.width, canvas.height);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(win.x, win.y, win.w, win.h, 10 * dpr);
    else ctx.rect(win.x, win.y, win.w, win.h);
    ctx.stroke();
  }

  result.panes.forEach((pane, i) => {
    const p = mapRect(pane, srcW, srcH, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 2 * dpr;
    ctx.strokeRect(p.x + 4 * dpr, p.y + 4 * dpr, p.w - 8 * dpr, p.h - 8 * dpr);
    const r = 12 * dpr;
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    ctx.fillStyle = "#e8c547";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1a160e";
    ctx.font = `700 ${13 * dpr}px Barlow, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), cx, cy + 0.5);
  });
}

function sampleFrame() {
  const video = els.live;
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  const maxEdge = 420;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  state.work.width = cw;
  state.work.height = ch;
  state.work.getContext("2d", { willReadFrequently: true }).drawImage(video, 0, 0, cw, ch);
  return {
    imageData: state.work.getContext("2d").getImageData(0, 0, cw, ch),
    width: cw,
    height: ch,
  };
}

function applyResult(result, srcW, srcH) {
  state.last = result;
  els.readout.textContent = describeDetection(result);
  drawOverlay(result, srcW, srcH);
}

function loopDetect() {
  let last = 0;
  const tick = (now) => {
    state.loop = requestAnimationFrame(tick);
    if (now - last < 220) return;
    last = now;
    if (!tracksLive() || els.live.readyState < 2) return;
    const frame = sampleFrame();
    if (!frame) return;
    try {
      applyResult(detectWindowGlasses(frame.imageData), frame.width, frame.height);
    } catch (err) {
      console.warn(err);
    }
  };
  state.loop = requestAnimationFrame(tick);
}

function addCurrentToInvoice() {
  const result = state.last;
  const line = describeDetection(result);
  if (!result.windows || !result.glasses) {
    toast("No window counted yet. Fill the frame with the window.");
    return;
  }
  const items = loadCart();
  items.unshift({
    id: String(Date.now()),
    line,
    windows: result.windows,
    glasses: result.glasses,
    at: new Date().toISOString(),
  });
  saveCart(items.slice(0, 40));
  toast("Added to invoice");
}

function renderInvoice() {
  const items = loadCart();
  if (!items.length) {
    els.invoiceList.innerHTML = `<li class="empty lots-lead">No windows yet. Scan one, then tap Create invoice.</li>`;
    return;
  }
  els.invoiceList.innerHTML = items
    .map(
      (item) =>
        `<li><div class="lot-card">${item.line}<div class="lots-lead">${new Date(item.at).toLocaleString()}</div></div></li>`
    )
    .join("");
}

async function scanFile(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    showScreen("camera");
    const maxEdge = 420;
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const cw = Math.max(1, Math.round(img.naturalWidth * scale));
    const ch = Math.max(1, Math.round(img.naturalHeight * scale));
    state.work.width = cw;
    state.work.height = ch;
    const ctx = state.work.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cw, ch);
    applyResult(detectWindowGlasses(ctx.getImageData(0, 0, cw, ch)), cw, ch);
    els.still.src = url;
    els.still.classList.add("is-on");
  };
  img.src = url;
}

els.start.addEventListener("click", startCamera);
els.closeCamera.addEventListener("click", closeCamera);
els.camRetry.addEventListener("click", startCamera);
els.addInvoice.addEventListener("click", () => {
  addCurrentToInvoice();
  renderInvoice();
  showScreen("invoice");
});
els.cartOpen.addEventListener("click", () => {
  renderInvoice();
  showScreen("invoice");
});
els.homeCart.addEventListener("click", () => {
  renderInvoice();
  showScreen("invoice");
});
els.invoiceBack.addEventListener("click", () => {
  if (tracksLive() || els.still.classList.contains("is-on")) showScreen("camera");
  else showScreen("home");
});
els.invoiceClear.addEventListener("click", () => {
  saveCart([]);
  renderInvoice();
});
els.photo.addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  scanFile(file);
});

refreshCart();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const reg of regs) reg.unregister();
  });
}
