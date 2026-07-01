(function () {
  const assetPattern =
    /(SectionParkour|parkour-3d|model-site|main-character|npc-model|Parkour|star-progress-bar|arrow1|otter-landing-bg).*?\.(js|glb|gltf|bin|ktx2|webp|png|jpg|jpeg)(\?|$)/i;
  const EXPECTED_ASSET_COUNT = 16;
  const MIN_VISIBLE_MS = 1100;
  const DISPLAY_MAX_BEFORE_READY = 98;
  const DISPLAY_CATCHUP_PER_SECOND = 34;
  const assets = new Map();
  const state = {
    active: false,
    moduleLoaded: false,
    sceneReady: false,
    startedAt: 0,
    rawProgress: 0,
    displayProgress: 0,
    lastDisplayAt: 0,
  };
  let overlay = null;

  function getLang() {
    try {
      const lang = new URLSearchParams(window.location.search).get("lang");
      return lang && lang.toLowerCase() === "en" ? "en" : "zh";
    } catch {
      return "zh";
    }
  }

  function landingText() {
    return getLang() === "en" ? "Otter is landing on the path..." : "奥特正在降落到小路上...";
  }

  function relevant(url) {
    try {
      return assetPattern.test(String(url));
    } catch {
      return false;
    }
  }

  function key(url) {
    try {
      return new URL(String(url), location.href).href;
    } catch {
      return String(url);
    }
  }

  function touchAsset(url, patch) {
    if (!relevant(url)) return;
    if (!state.active && !hasVisibleWaitLayer()) return;
    const id = key(url);
    const item = assets.get(id) || { loaded: 0, total: 0, done: false };
    Object.assign(item, patch);
    assets.set(id, item);
    render();
  }

  function hasVisibleWaitLayer() {
    return Array.from(document.querySelectorAll(".otter-landing-wait")).some((node) => {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || 1) > 0.01
      );
    });
  }

  function resourceEntries() {
    if (!window.performance || !performance.getEntriesByType) return;
    for (const entry of performance.getEntriesByType("resource")) {
      if (!relevant(entry.name)) continue;
      touchAsset(entry.name, {
        loaded: entry.transferSize || entry.encodedBodySize || 1,
        total: entry.transferSize || entry.encodedBodySize || 1,
        done: !!entry.responseEnd,
      });
    }
  }

  function computeProgress() {
    if (state.sceneReady) return 100;
    const elapsed = state.startedAt ? Date.now() - state.startedAt : 0;
    const moduleProgress = state.moduleLoaded
      ? 35
      : Math.min(34, 6 + elapsed / 160);

    const list = Array.from(assets.values());
    let assetRatio = 0;
    if (list.length) {
      const known = list.filter((item) => item.total > 0 || item.done);
      const expectedCount = Math.max(EXPECTED_ASSET_COUNT, list.length);
      if (known.length) {
        const knownTotals = known.map((item) => Math.max(item.total, item.loaded, item.done ? 1 : 0));
        const averageTotal =
          knownTotals.reduce((sum, total) => sum + total, 0) / Math.max(1, knownTotals.length);
        const missingCount = Math.max(0, expectedCount - list.length);
        const loaded = known.reduce((sum, item) => {
          const total = Math.max(item.total, item.loaded, item.done ? 1 : 0);
          return sum + (item.done ? total : Math.min(item.loaded, total));
        }, 0);
        const total =
          knownTotals.reduce((sum, itemTotal) => sum + itemTotal, 0) +
          missingCount * averageTotal;
        assetRatio = total ? loaded / total : 0;
      } else {
        assetRatio = list.filter((item) => item.done).length / expectedCount;
      }
    }

    const assetProgress = assetRatio * 57;
    const softProgress = Math.min(96, moduleProgress + assetProgress);
    return Math.max(state.rawProgress, softProgress);
  }

  function displayProgressFor(rawProgress) {
    const now = Date.now();
    if (!state.lastDisplayAt) state.lastDisplayAt = now;
    const elapsedSinceLast = Math.max(16, now - state.lastDisplayAt);
    state.lastDisplayAt = now;

    if (state.sceneReady) {
      const minVisibleDone = !state.startedAt || now - state.startedAt >= MIN_VISIBLE_MS;
      return minVisibleDone ? 100 : Math.min(99, Math.max(state.displayProgress, rawProgress));
    }

    const cappedRaw = Math.min(DISPLAY_MAX_BEFORE_READY, rawProgress);
    const maxStep = Math.max(1.2, (DISPLAY_CATCHUP_PER_SECOND * elapsedSinceLast) / 1000);
    return Math.min(cappedRaw, state.displayProgress + maxStep);
  }

  function applyToWaitLayers(progress) {
    const rounded = Math.max(0, Math.min(100, Math.round(progress)));
    if (state.active && !state.sceneReady) ensureOverlay();
    document.querySelectorAll(".otter-landing-wait").forEach((node) => {
      node.style.setProperty("--otter-load-progress-scale", String(rounded / 100));
      node.setAttribute("data-progress", String(rounded));
      const copy =
        node.querySelector(".otter-global-landing-copy, .otter-landing-copy") ||
        (node.children && node.children[0]);
      if (copy) copy.setAttribute("data-progress-label", `${rounded}%`);
    });
  }

  function ensureOverlay() {
    document.documentElement.classList.add("otter-unified-loading-active");
    if (overlay && document.body.contains(overlay)) return overlay;
    overlay = document.createElement("div");
    overlay.className =
      "otter-landing-wait otter-global-landing-wait";
    overlay.setAttribute("aria-live", "polite");
    overlay.innerHTML =
      '<div class="otter-global-landing-copy">' +
      landingText() +
      "</div>";
    document.body.appendChild(overlay);
    return overlay;
  }

  function removeOverlaySoon() {
    window.setTimeout(() => {
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      overlay = null;
      document.documentElement.classList.remove("otter-unified-loading-active");
      document.documentElement.classList.add("otter-unified-loading-complete");
      state.active = false;
    }, 260);
  }

  function visibleSceneReady() {
    return !!document.querySelector("canvas") && !!document.querySelector("[data-tutorial-direction]");
  }

  function completeScene() {
    if (state.sceneReady) return;
    if (!state.startedAt) state.startedAt = Date.now();
    state.active = true;
    state.moduleLoaded = true;
    state.sceneReady = true;
    state.rawProgress = 100;
    render();
    const remainingVisibleTime = Math.max(0, MIN_VISIBLE_MS - (Date.now() - state.startedAt));
    window.setTimeout(() => {
      state.displayProgress = 100;
      applyToWaitLayers(100);
      removeOverlaySoon();
    }, remainingVisibleTime);
  }

  function render() {
    if (!state.active && !document.querySelector(".otter-landing-wait")) return;
    if (!state.active && !hasVisibleWaitLayer()) return;
    state.active = true;
    if (!state.sceneReady && visibleSceneReady()) {
      completeScene();
      return;
    }
    state.rawProgress = computeProgress();
    state.displayProgress = displayProgressFor(state.rawProgress);
    applyToWaitLayers(state.displayProgress);
  }

  function start() {
    if (!state.active && !hasVisibleWaitLayer()) return;
    if (!state.startedAt) state.startedAt = Date.now();
    state.active = true;
    resourceEntries();
    render();
  }

  window.otterParkourLoading = {
    start,
    markModuleLoaded() {
      start();
      state.moduleLoaded = true;
      render();
    },
    markSceneReady() {
      completeScene();
    },
    getState() {
      return {
        active: state.active,
        moduleLoaded: state.moduleLoaded,
        sceneReady: state.sceneReady,
        rawProgress: state.rawProgress,
        displayProgress: state.displayProgress,
        assetCount: assets.size,
      };
    },
  };
  document.documentElement.setAttribute("data-otter-loading-runtime", "realprogress6");

  const OriginalXHR = window.XMLHttpRequest;
  if (OriginalXHR && OriginalXHR.prototype) {
    const originalOpen = OriginalXHR.prototype.open;
    const originalSend = OriginalXHR.prototype.send;
    OriginalXHR.prototype.open = function (method, url) {
      this.__otterLoadingUrl = key(url);
      return originalOpen.apply(this, arguments);
    };
    OriginalXHR.prototype.send = function () {
      const url = this.__otterLoadingUrl;
      if (relevant(url)) {
        start();
        touchAsset(url, { loaded: 0, total: 0, done: false });
        this.addEventListener("progress", (event) => {
          touchAsset(url, {
            loaded: event.loaded || 0,
            total: event.lengthComputable ? event.total || 0 : 0,
            done: false,
          });
        });
        this.addEventListener("loadend", () => {
          const item = assets.get(key(url));
          const total = Math.max((item && item.total) || 0, (item && item.loaded) || 0, 1);
          touchAsset(url, { done: true, loaded: total, total });
        });
      }
      return originalSend.apply(this, arguments);
    };
  }

  // Intercept fetch() to track GLB/asset downloads — three.js v0.133+ uses fetch(), not XHR.
  // Without this, the 13+ GLB model downloads are invisible to the XHR interceptor above,
  // causing the progress bar to freeze at ~45% (only fast CSS/JS/webp assets counted).
  const _nativeFetch = window.fetch;
  if (typeof _nativeFetch === 'function') {
    window.fetch = function(input, init) {
      const url = typeof input === 'string' ? input
        : (input && typeof input === 'object' && 'url' in input) ? input.url
        : String(input);
      if (relevant(url)) {
        start();
        touchAsset(url, { loaded: 0, total: 0, done: false });
        return _nativeFetch.apply(this, arguments).then(function(response) {
          if (!response.body) {
            touchAsset(url, { done: true, loaded: 1, total: 1 });
            return response;
          }
          const contentLength = parseInt(response.headers.get('content-length') || '0', 10) || 0;
          if (contentLength > 0) {
            touchAsset(url, { loaded: 0, total: contentLength, done: false });
          }
          const reader = response.body.getReader();
          let loaded = 0;
          const total = contentLength;
          const stream = new ReadableStream({
            start: function(controller) {
              function pump() {
                return reader.read().then(function(result) {
                  if (result.done) {
                    touchAsset(url, { done: true, loaded: total || loaded, total: total || loaded });
                    controller.close();
                    return;
                  }
                  loaded += result.value.byteLength;
                  touchAsset(url, { loaded: loaded, total: total || 0, done: false });
                  controller.enqueue(result.value);
                  return pump();
                }).catch(function(err) {
                  touchAsset(url, { done: true, loaded: loaded || 1, total: loaded || 1 });
                  controller.error(err);
                });
              }
              pump();
            }
          });
          return new Response(stream, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }).catch(function(err) {
          touchAsset(url, { done: true, loaded: 1, total: 1 });
          throw err;
        });
      }
      return _nativeFetch.apply(this, arguments);
    };
  }

  if ("PerformanceObserver" in window) {
    try {
      new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          if (!relevant(entry.name)) return;
          touchAsset(entry.name, {
            loaded: entry.transferSize || entry.encodedBodySize || 1,
            total: entry.transferSize || entry.encodedBodySize || 1,
            done: !!entry.responseEnd,
          });
        });
      }).observe({ type: "resource", buffered: true });
    } catch {}
  }

  new MutationObserver(() => {
    if (document.querySelector(".otter-landing-wait")) start();
    if (state.active && !state.sceneReady && visibleSceneReady()) completeScene();
  }).observe(document.documentElement, { childList: true, subtree: true });

  setInterval(render, 120);
})();
