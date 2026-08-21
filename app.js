(() => {
  "use strict";

  const WIKI_API = "https://en.wikipedia.org/api/rest_v1/page/summary/";
  const STORAGE_KEY = "openlot-lots-v1";
  const NOT_FOR_SALE = new Set([
    "person",
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
    "cell phone": "Smartphone",
    mouse: "Computer mouse",
    keyboard: "Computer keyboard",
    remote: "Remote control",
    "hair drier": "Hair dryer",
    "potted plant": "Houseplant",
    "dining table": "Dining table",
    "sports ball": "Ball",
    "hot dog": "Hot dog",
    "wine glass": "Wine glass",
    "fire hydrant": "Fire hydrant",
    "stop sign": "Stop sign",
    "traffic light": "Traffic light",
    "parking meter": "Parking meter",
    "teddy bear": "Teddy bear",
    "baseball bat": "Baseball bat",
    "baseball glove": "Baseball glove",
    "tennis racket": "Tennis racket",
  };

  const els = {
    home: document.getElementById("home"),
    camera: document.getElementById("camera"),
    lots: document.getElementById("lots"),
    start: document.getElementById("start-camera"),
    startLabel: document.getElementById("start-label"),
    live: document.getElementById("live"),
    boxes: document.getElementById("boxes"),
    still: document.getElementById("still"),
    liveChip: document.getElementById("live-chip"),
    shutter: document.getElementById("shutter"),
    closeCamera: document.getElementById("close-camera"),
    torch: document.getElementById("toggle-torch"),
    flip: document.getElementById("flip-camera"),
    sheet: document.getElementById("sheet"),
    sheetBody: document.getElementById("sheet-body"),
    sheetBackdrop: document.getElementById("sheet-backdrop"),
    toast: document.getElementById("toast"),
    lotCount: document.getElementById("lot-count"),
    lotList: document.getElementById("lot-list"),
    lotsLead: document.getElementById("lots-lead"),
    photo: document.getElementById("photo-input"),
    photoCam: document.getElementById("photo-input-cam"),
  };

  const state = {
    model: null,
    stream: null,
    facingMode: "environment",
    torchOn: false,
    scanning: false,
    liveLoop: 0,
    lastLive: null,
    frame: null,
    lastFocus: null,
  };

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
    }, 2400);
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

  async function setBackend() {
    const order = ["webgl", "cpu"];
    for (const name of order) {
      try {
        if (tf.findBackend(name) || name === "cpu") {
          await tf.setBackend(name);
          await tf.ready();
          return name;
        }
      } catch {
        /* try next */
      }
    }
    await tf.ready();
    return tf.getBackend();
  }

  async function loadModel() {
    els.startLabel.textContent = "Warming the lens…";
    await setBackend();
    state.model = await cocoSsd.load({ base: "lite_mobilenet_v2" });
    els.start.disabled = false;
    els.startLabel.textContent = "Open the camera";
  }

  function stopStream() {
    if (state.liveLoop) {
      cancelAnimationFrame(state.liveLoop);
      state.liveLoop = 0;
    }
    if (state.stream) {
      for (const track of state.stream.getTracks()) track.stop();
      state.stream = null;
    }
    els.live.srcObject = null;
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast("This browser cannot open the camera. Use a photo instead.");
      els.photo.click();
      return;
    }
    if (location.protocol !== "https:" && location.hostname !== "localhost") {
      toast("iPhone camera needs HTTPS. Open the live site, not a file.");
    }
    stopStream();
    showScreen("camera");
    els.still.hidden = true;
    els.live.hidden = false;
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: state.facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      els.live.srcObject = state.stream;
      els.live.setAttribute("playsinline", "true");
      els.live.muted = true;
      await els.live.play();
      setupTorchButton();
      loopLive();
    } catch (err) {
      showScreen("home");
      const denied = /not allowed|permission|denied/i.test(String(err));
      toast(
        denied
          ? "Camera permission is off. Allow it in Safari settings, or pick a photo."
          : "Could not open the camera. Try a photo from the library."
      );
    }
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
    if (!track || !track.getCapabilities().torch) return;
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
    state.facingMode =
      state.facingMode === "environment" ? "user" : "environment";
    await startCamera();
  }

  function mapBox(bbox) {
    const [x, y, w, h] = bbox;
    const video = els.live;
    const canvas = els.boxes;
    const vw = video.videoWidth || 1;
    const vh = video.videoHeight || 1;
    const rw = canvas.width;
    const rh = canvas.height;
    const scale = Math.max(rw / vw, rh / vh);
    const ox = (rw - vw * scale) / 2;
    const oy = (rh - vh * scale) / 2;
    return {
      x: x * scale + ox,
      y: y * scale + oy,
      w: w * scale,
      h: h * scale,
    };
  }

  function drawBoxes(predictions) {
    const canvas = els.boxes;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#d4a24a";
    ctx.lineWidth = 3 * dpr;
    for (const pred of predictions.slice(0, 4)) {
      const box = mapBox(pred.bbox);
      ctx.strokeRect(box.x, box.y, box.w, box.h);
    }
  }

  function loopLive() {
    let last = 0;
    const tick = async (now) => {
      state.liveLoop = requestAnimationFrame(tick);
      if (!state.model || state.scanning || els.live.readyState < 2) return;
      if (now - last < 900) return;
      last = now;
      try {
        const predictions = await state.model.detect(els.live);
        const top = predictions
          .filter((p) => p.score >= 0.45)
          .sort((a, b) => b.score - a.score);
        drawBoxes(top);
        if (top[0]) {
          state.lastLive = top[0];
          els.liveChip.hidden = false;
          els.liveChip.textContent = `I see ${article(top[0].class)} ${top[0].class}…`;
        } else {
          els.liveChip.hidden = true;
        }
      } catch {
        /* keep the loop alive */
      }
    };
    state.liveLoop = requestAnimationFrame(tick);
  }

  function drawScaled(source, maxEdge) {
    const w = source.videoWidth || source.naturalWidth || source.width;
    const h = source.videoHeight || source.naturalHeight || source.height;
    const scale = Math.min(1, maxEdge / Math.max(w, h, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function captureStillFromVideo() {
    const canvas = drawScaled(els.live, 960);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    els.still.src = dataUrl;
    els.still.hidden = false;
    els.live.hidden = true;
    return { canvas, dataUrl };
  }

  async function scanFromCanvas(canvas, dataUrl) {
    if (!state.model) {
      toast("The scanner is still loading. Give it a moment.");
      return;
    }
    state.scanning = true;
    els.shutter.classList.add("busy");
    try {
      const detectCanvas =
        canvas.width > 480 || canvas.height > 480 ? drawScaled(canvas, 480) : canvas;
      const predictions = await state.model.detect(detectCanvas);
      const ranked = predictions.sort((a, b) => b.score - a.score);
      const top = ranked.find((p) => p.score >= 0.35);
      state.frame = { dataUrl, predictions: ranked };
      if (!top) {
        openUnknownSheet(dataUrl);
        return;
      }
      await openResultSheet(top, ranked, dataUrl);
    } catch (err) {
      toast("Scan failed. Try more light, or a still photo.");
      console.error(err);
    } finally {
      state.scanning = false;
      els.shutter.classList.remove("busy");
    }
  }

  async function shutter() {
    if (state.scanning) return;
    if (!els.live.srcObject || els.live.readyState < 2) {
      toast("Camera is still opening.");
      return;
    }
    if (state.liveLoop) {
      cancelAnimationFrame(state.liveLoop);
      state.liveLoop = 0;
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
      els.still.src = dataUrl;
      showScreen("camera");
      els.still.hidden = false;
      els.live.hidden = true;
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
        thumb: data.thumbnail && data.thumbnail.source,
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

  function closeSheet() {
    els.sheet.hidden = true;
    els.sheetBody.innerHTML = "";
    if (els.camera.classList.contains("hidden") === false) {
      els.still.hidden = true;
      els.live.hidden = false;
      if (state.stream && !state.liveLoop) loopLive();
    }
    if (state.lastFocus && state.lastFocus.focus) state.lastFocus.focus();
  }

  function resultCopy(name, wiki) {
    const item = pretty(name);
    const intro = `Hey, this is ${article(name)} ${item}. What do you want to do with it?`;
    const extract = wiki && wiki.extract ? wiki.extract : "";
    return { intro, extract, item };
  }

  async function openResultSheet(top, all, dataUrl) {
    const wiki = await fetchWiki(top.class);
    const { intro, extract, item } = resultCopy(top.class, wiki);
    const canSell = !NOT_FOR_SALE.has(top.class);
    const others = all.filter((p) => p.class !== top.class && p.score >= 0.35);
    const thumb = dataUrl;
    const safeItem = escapeHtml(item);
    const safeIntro = escapeHtml(intro);
    const safeExtract = escapeHtml(extract);
    const wikiLabel = wiki && wiki.title ? escapeHtml(wiki.title) : "";
    openSheet(`
      <div class="result-hero">
        <img src="${thumb}" alt="Scanned ${safeItem}" />
        <div>
          <p class="sheet-kicker">Scanned</p>
          <h2 id="sheet-title" tabindex="-1">${safeIntro}</h2>
          <p class="confidence">${Math.round(top.score * 100)}% match${wikiLabel ? ` · ${wikiLabel}` : ""}</p>
        </div>
      </div>
      ${safeExtract ? `<p class="sheet-extract">${safeExtract}</p>` : ""}
      <div class="choices">
        ${
          canSell
            ? `<button class="choice" data-act="sell" type="button">
                <span>Sell it<div><small>See prices and open marketplaces</small></div></span>
                <span class="choice-mark" aria-hidden="true">→</span>
              </button>`
            : `<p class="sheet-extract">I won’t list ${escapeHtml(item.toLowerCase())} for sale.</p>`
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
              .map(
                (p) =>
                  `<button type="button" data-alt="${escapeHtml(p.class)}">Not that — it’s ${article(p.class)} ${escapeHtml(p.class)}</button>`
              )
              .join("")}</div>`
          : ""
      }
      <button class="quiet" data-act="rescan" type="button">Scan something else</button>
    `);

    els.sheetBody.dataset.item = top.class;
    els.sheetBody.dataset.score = String(top.score);
    els.sheetBody.dataset.image = dataUrl;
    els.sheetBody.dataset.wiki = wiki && wiki.url ? wiki.url : "";
  }

  function openUnknownSheet(dataUrl) {
    openSheet(`
      <p class="sheet-kicker">Couldn’t lock on</p>
      <h2 id="sheet-title" tabindex="-1">I couldn’t quite name that. What is it?</h2>
      <p class="sheet-extract">Fill the frame, add light, or type the name and I’ll still take you to where it sells.</p>
      <form class="manual" id="manual-form">
        <label for="manual-name">Item name</label>
        <input id="manual-name" name="name" required maxlength="80" placeholder="e.g. leather jacket" />
        <button class="primary" type="submit">That’s the item</button>
      </form>
      <button class="quiet" data-act="rescan" type="button">Try the camera again</button>
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

  function saveCurrentLot(condition) {
    const item = els.sheetBody.dataset.item;
    const image = els.sheetBody.dataset.image;
    if (!item || !image) return;
    const lots = loadLots();
    lots.unshift({
      id: String(Date.now()),
      name: item,
      condition: condition || els.sheetBody.dataset.condition || "Like new",
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
    els.still.src = lot.image;
    els.still.hidden = false;
    els.live.hidden = true;
    await openResultSheet(
      { class: lot.name, score: 1, bbox: [0, 0, 0, 0] },
      [],
      lot.image
    );
  }

  function closeCamera() {
    closeSheet();
    stopStream();
    els.still.hidden = true;
    showScreen("home");
  }

  els.start.addEventListener("click", startCamera);
  els.closeCamera.addEventListener("click", closeCamera);
  els.shutter.addEventListener("click", shutter);
  els.torch.addEventListener("click", toggleTorch);
  els.flip.addEventListener("click", flipCamera);
  els.sheetBackdrop.addEventListener("click", closeSheet);
  document.getElementById("lots-open").addEventListener("click", () => {
    renderLots();
    showScreen("lots");
  });
  document.getElementById("lots-back").addEventListener("click", () => {
    showScreen("home");
  });
  els.photo.addEventListener("change", (e) => scanFile(e.target.files[0]));
  els.photoCam.addEventListener("change", (e) => scanFile(e.target.files[0]));

  els.sheetBody.addEventListener("click", async (event) => {
    const alt = event.target.closest("[data-alt]");
    if (alt) {
      const name = alt.getAttribute("data-alt");
      const pred = (state.frame && state.frame.predictions || []).find(
        (p) => p.class === name
      ) || { class: name, score: 0.5, bbox: [0, 0, 0, 0] };
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
    if (action === "rescan") {
      closeSheet();
      if (!state.stream) startCamera();
    }
    if (action === "back-result") {
      const pred = { class: item, score: Number(els.sheetBody.dataset.score || 0.9), bbox: [0, 0, 0, 0] };
      await openResultSheet(pred, (state.frame && state.frame.predictions) || [], image);
    }
  });

  els.sheetBody.addEventListener("submit", async (event) => {
    if (event.target.id !== "manual-form") return;
    event.preventDefault();
    const name = (document.getElementById("manual-name").value || "").trim().toLowerCase();
    if (!name) return;
    await openResultSheet(
      { class: name, score: 1, bbox: [0, 0, 0, 0] },
      [],
      els.sheetBody.dataset.image
    );
  });

  els.lotList.addEventListener("click", (event) => {
    const card = event.target.closest("[data-lot]");
    if (card) reopenLot(card.getAttribute("data-lot"));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.sheet.hidden) {
      closeSheet();
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
    els.startLabel.textContent = "Could not load the scanner";
    toast("The free model did not load. Check your connection and refresh.");
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
})();
