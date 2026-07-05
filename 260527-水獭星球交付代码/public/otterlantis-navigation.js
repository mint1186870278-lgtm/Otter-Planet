let parkourPrewarmPromise;

function prewarmParkour() {
  if (!parkourPrewarmPromise) {
    parkourPrewarmPromise = Promise.resolve();
  }

  return parkourPrewarmPromise;
}

function schedulePrewarm() {
  const run = () => prewarmParkour();
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 1800 });
  } else {
    window.setTimeout(run, 600);
  }
}

function publishNavigationState() {
  window.__otterNavigationState = {
    mode: "react-owned-section-state",
    globalScrollGuard: false,
  };
  if (document.documentElement) {
    document.documentElement.setAttribute("data-otter-navigation-runtime", "react-owned-section-state");
  }
}

publishNavigationState();
schedulePrewarm();
