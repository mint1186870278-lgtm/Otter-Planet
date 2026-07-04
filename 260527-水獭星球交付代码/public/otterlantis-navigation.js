let parkourPrewarmPromise;

function prewarmParkour() {
  if (!parkourPrewarmPromise) {
    parkourPrewarmPromise = Promise.resolve();
  }

  return parkourPrewarmPromise;
}

function findSectionScroller() {
  const root = document.getElementById("root");
  if (!root) return null;

  const candidates = [root.firstElementChild, ...root.querySelectorAll("div")].filter(Boolean);
  return (
    candidates.find((element) => {
      const className = String(element.className || "");
      const sections = element.querySelectorAll(":scope > section");
      return sections.length >= 3 && className.includes("snap-y");
    }) ||
    candidates.find((element) => {
      const sections = element.querySelectorAll(":scope > section");
      return sections.length >= 3 && element.scrollHeight > element.clientHeight;
    }) || null
  );
}

function installWheelGuard(scroller) {
  if (scroller.dataset.otterWheelGuard === "on") return;
  scroller.dataset.otterWheelGuard = "on";
  scroller.style.overscrollBehavior = "none";

  const shouldAllowNativeScroll = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return false;
    return !!target.closest(".otter-voice-text-scroll");
  };

  const stopSectionScroll = (event) => {
    if (shouldAllowNativeScroll(event)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  scroller.addEventListener("wheel", stopSectionScroll, { capture: true, passive: false });
  scroller.addEventListener("touchmove", stopSectionScroll, { capture: true, passive: false });

  window.addEventListener("wheel", stopSectionScroll, { capture: true, passive: false });
  window.addEventListener("touchmove", stopSectionScroll, { capture: true, passive: false });
  document.addEventListener("wheel", stopSectionScroll, { capture: true, passive: false });
  document.addEventListener("touchmove", stopSectionScroll, { capture: true, passive: false });

  window.addEventListener(
    "keydown",
    (event) => {
      const tagName = event.target instanceof Element ? event.target.tagName : "";
      if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return;
      if (!["PageDown", "PageUp", "Home", "End", " "].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
    },
    { capture: true, passive: false },
  );
}

function boot() {
  const scroller = findSectionScroller();
  if (!scroller) return false;

  installWheelGuard(scroller);
  return true;
}

function schedulePrewarm() {
  const run = () => prewarmParkour();
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 1800 });
  } else {
    window.setTimeout(run, 600);
  }
}

function isElementInViewport(element) {
  const rect = element.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
}

function findVisibleTutorialButton() {
  const buttons = Array.from(document.querySelectorAll("[data-tutorial-direction]"));
  if (!buttons.length) return null;

  const visibleButtons = buttons.filter((button) => isElementInViewport(button));
  if (!visibleButtons.length) return null;

  return (
    visibleButtons.find((button) => !String(button.className).includes("opacity-45")) || visibleButtons[0]
  );
}

function getCurrentLang() {
  try {
    const lang = new URLSearchParams(window.location.search).get("lang");
    return lang && lang.toLowerCase() === "en" ? "en" : "zh";
  } catch {
    return "zh";
  }
}

function landingCopy() {
  return getCurrentLang() === "en" ? "Otter is landing on the path..." : "奥特正在降落到小路上...";
}

function createLandingOverlay() {
  const overlay = document.createElement("div");
  overlay.id = "otter-landing-tutorial-cover";
  overlay.setAttribute("aria-live", "polite");
  overlay.innerHTML = `
    <div class="otter-landing-copy">${landingCopy()}</div>
  `;
  overlay.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483647",
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "justify-content:center",
    "background:linear-gradient(rgba(0,78,155,.14),rgba(0,44,91,.22)),url(\"/otter-landing-bg.webp?v=20260618-landing\") center / cover no-repeat",
    "color:white",
    "pointer-events:auto",
    "font-family:Nunito,system-ui,sans-serif",
  ].join(";");
  return overlay;
}

function installLandingOverlayStyles() {
  if (document.getElementById("otter-landing-tutorial-cover-style")) return;

  const style = document.createElement("style");
  style.id = "otter-landing-tutorial-cover-style";
  style.textContent = `
    #otter-landing-tutorial-cover .otter-landing-copy {
      font-size: 24px;
      font-weight: 900;
      text-shadow: 0 2px 8px rgba(0,0,0,.25);
    }

  `;
  document.head.appendChild(style);
}

function installLandingTutorialCover() {
  installLandingOverlayStyles();

  let overlay = null;
  let coverStartedAt = 0;
  let lastFrameAt = 0;
  let lastJankAt = 0;
  let hasCoveredThisTutorial = false;

  const STABLE_MS = 1200;
  const MIN_COVER_MS = 1800;
  const MAX_COVER_MS = 7000;
  const JANK_FRAME_MS = 180;

  const tickFrame = (now) => {
    if (lastFrameAt && now - lastFrameAt > JANK_FRAME_MS) {
      lastJankAt = now;
    }
    lastFrameAt = now;
    window.requestAnimationFrame(tickFrame);
  };

  window.requestAnimationFrame(tickFrame);

  window.setInterval(() => {
    const button = findVisibleTutorialButton();

    if (button) {
      if (hasCoveredThisTutorial) return;

      const now = Date.now();
      if (!overlay) {
        overlay = createLandingOverlay();
        document.body.appendChild(overlay);
        coverStartedAt = now;
        lastJankAt = now;
      }

      const coveredFor = now - coverStartedAt;
      const quietFor = now - lastJankAt;
      if ((coveredFor >= MIN_COVER_MS && quietFor >= STABLE_MS) || coveredFor >= MAX_COVER_MS) {
        overlay.remove();
        overlay = null;
        hasCoveredThisTutorial = true;
      }
      return;
    }

    if (overlay) {
      overlay.remove();
      overlay = null;
    }

    hasCoveredThisTutorial = false;
    coverStartedAt = 0;
  }, 160);
}

// Parkour loading is now handled by otterlantis-loader.js so the user sees one
// continuous progress bar from module download through 3D scene readiness.

if (!boot()) {
  const observer = new MutationObserver(() => {
    if (boot()) observer.disconnect();
  });
  observer.observe(document.getElementById("root") || document.body, { childList: true, subtree: true });
}

let bootAttempts = 0;
const bootTimer = window.setInterval(() => {
  bootAttempts += 1;
  if (boot() || bootAttempts > 60) {
    window.clearInterval(bootTimer);
  }
}, 250);
