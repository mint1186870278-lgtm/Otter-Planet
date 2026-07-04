(function () {
  var OPENING_AUDIO = "/audio/game-opening.m4a";
  var GAMEPLAY_AUDIO = "/audio/gameplay-loop.m4a";
  var GAMEPLAY_START_SECTION = 3;
  var FADE_MS = 500;
  var TARGET_VOLUME = 0.45;

  var tracks = {
    opening: createTrack(OPENING_AUDIO, "opening"),
    gameplay: createTrack(GAMEPLAY_AUDIO, "gameplay")
  };
  var musicEnabled = true;
  var hasUserGesture = false;
  var activeTrackName = null;
  var fadeTimer = null;
  var observer = null;
  var lastSectionIndex = 0;
  var toggleButton = null;
  var unlockListenersAttached = false;

  window.__otterlantisAudioState = {
    activeTrackName: null,
    hasUserGesture: false,
    lastSectionIndex: 0,
    lastPlayError: null,
    musicEnabled: true
  };

  function createTrack(src, name) {
    var audio = document.createElement("audio");
    audio.dataset.src = src;
    audio.loop = true;
    audio.preload = "metadata";
    audio.autoplay = false;
    audio.volume = 0;
    audio.playsInline = true;
    audio.setAttribute("autoplay", "");
    audio.setAttribute("playsinline", "");
    audio.setAttribute("data-otterlantis-audio", name);
    audio.setAttribute("aria-hidden", "true");
    audio.style.display = "none";
    return audio;
  }

  function ensureTrackSource(track) {
    if (!track.src && track.dataset && track.dataset.src) {
      track.src = track.dataset.src;
    }
  }

  function ensureTrackElements() {
    Object.keys(tracks).forEach(function (trackName) {
      var track = tracks[trackName];
      if (!track.parentNode && document.body) {
        document.body.appendChild(track);
      }
    });
  }

  function setAudioState(patch) {
    Object.keys(patch).forEach(function (key) {
      window.__otterlantisAudioState[key] = patch[key];
      if (document.body) {
        document.body.setAttribute("data-otter-audio-" + key.replace(/[A-Z]/g, function (match) {
          return "-" + match.toLowerCase();
        }), String(patch[key]));
      }
    });
  }

  function getTrackNameForSection(index) {
    return index >= GAMEPLAY_START_SECTION ? "gameplay" : "opening";
  }

  function getDesiredTrackName() {
    return getTrackNameForSection(lastSectionIndex);
  }

  function stopAllTracks() {
    clearInterval(fadeTimer);
    Object.keys(tracks).forEach(function (trackName) {
      tracks[trackName].pause();
      tracks[trackName].volume = 0;
    });
  }

  function getLang() {
    try {
      var lang = new URLSearchParams(window.location.search).get("lang");
      return lang && lang.toLowerCase() === "en" ? "en" : "zh";
    } catch (error) {
      return "zh";
    }
  }

  function audioText(key) {
    var lang = getLang();
    var text = {
      zh: {
        close: "关闭音乐",
        enableClick: "开启音乐，点击后播放",
        enable: "开启音乐",
        playingTitle: "音乐播放中，点击关闭",
        clickTitle: "点击播放音乐",
        offTitle: "音乐已关闭，点击开启",
        label: "音乐"
      },
      en: {
        close: "Turn music off",
        enableClick: "Turn music on, click to play",
        enable: "Turn music on",
        playingTitle: "Music playing, click to turn off",
        clickTitle: "Click to play music",
        offTitle: "Music off, click to turn on",
        label: "Music"
      }
    };
    return text[lang][key];
  }

  function refreshToggleButton() {
    if (!toggleButton) return;

    var currentTrack = activeTrackName ? tracks[activeTrackName] : null;
    var isPlaying = !!(musicEnabled && currentTrack && !currentTrack.paused);
    var isWaiting = !!(musicEnabled && (!hasUserGesture || !isPlaying));

    toggleButton.classList.toggle("is-off", !musicEnabled);
    toggleButton.classList.toggle("is-waiting", isWaiting);
    toggleButton.setAttribute("aria-pressed", musicEnabled ? "true" : "false");
    toggleButton.setAttribute(
      "aria-label",
      musicEnabled
        ? isPlaying
          ? audioText("close")
          : audioText("enableClick")
        : audioText("enable")
    );
    toggleButton.title = musicEnabled
      ? isPlaying
        ? audioText("playingTitle")
        : audioText("clickTitle")
      : audioText("offTitle");
    var label = toggleButton.querySelector(".otter-music-toggle-label");
    if (label) label.textContent = audioText("label");
  }

  function isCurrentTrackPlaying() {
    var currentTrack = activeTrackName ? tracks[activeTrackName] : null;
    return !!(currentTrack && !currentTrack.paused);
  }

  function requestPlay(trackName) {
    if (!musicEnabled) {
      stopAllTracks();
      refreshToggleButton();
      return;
    }

    var from = activeTrackName && activeTrackName !== trackName ? tracks[activeTrackName] : null;
    var to = tracks[trackName];
    activeTrackName = trackName;
    setAudioState({
      activeTrackName: activeTrackName,
      hasUserGesture: hasUserGesture,
      lastSectionIndex: lastSectionIndex,
      musicEnabled: musicEnabled
    });

    if (!hasUserGesture) {
      refreshToggleButton();
      return;
    }

    ensureTrackSource(to);
    if (from) ensureTrackSource(from);
    fadeToActiveTrack(from, to);
  }

  function warmupAndTryAutoplay() {
    ensureTrackElements();
    refreshToggleButton();
  }

  function fadeToActiveTrack(from, to) {
    clearInterval(fadeTimer);

    to.play().then(function () {
      setAudioState({ lastPlayError: null });
      refreshToggleButton();
    }).catch(function (error) {
      setAudioState({ lastPlayError: error && error.message ? error.message : String(error) });
      refreshToggleButton();
    });

    var startedAt = Date.now();
    fadeTimer = setInterval(function () {
      var progress = Math.min(1, (Date.now() - startedAt) / FADE_MS);
      to.volume = TARGET_VOLUME * progress;

      if (from) {
        from.volume = TARGET_VOLUME * (1 - progress);
      }

      if (progress >= 1) {
        clearInterval(fadeTimer);
        to.volume = TARGET_VOLUME;
        if (from) {
          from.pause();
          from.currentTime = 0;
          from.volume = 0;
        }
        refreshToggleButton();
      }
    }, 40);
  }

  function syncMusicToCurrentSection() {
    requestPlay(getDesiredTrackName());
  }

  function updateByScrollPosition() {
    var sections = Array.prototype.slice.call(document.querySelectorAll("section"));
    if (!sections.length) return;

    var viewportCenter = window.innerHeight / 2;
    var closest = sections.reduce(function (best, section, index) {
      var rect = section.getBoundingClientRect();
      var distance = Math.abs(rect.top + rect.height / 2 - viewportCenter);
      return distance < best.distance ? { index: index, distance: distance } : best;
    }, { index: 0, distance: Infinity });

    if (lastSectionIndex !== closest.index) {
      lastSectionIndex = closest.index;
      setAudioState({ lastSectionIndex: lastSectionIndex });
      syncMusicToCurrentSection();
      return;
    }

    lastSectionIndex = closest.index;
    setAudioState({ lastSectionIndex: lastSectionIndex });
  }

  function setupObserver() {
    if (observer) observer.disconnect();

    var sections = Array.prototype.slice.call(document.querySelectorAll("section"));
    if (!sections.length || !("IntersectionObserver" in window)) {
      updateByScrollPosition();
      return;
    }

    observer = new IntersectionObserver(function (entries) {
      var visible = entries
        .filter(function (entry) { return entry.isIntersecting; })
        .sort(function (a, b) { return b.intersectionRatio - a.intersectionRatio; })[0];

      if (!visible) return;
      var nextIndex = sections.indexOf(visible.target);
      if (nextIndex === lastSectionIndex) return;
      lastSectionIndex = nextIndex;
      setAudioState({ lastSectionIndex: lastSectionIndex });
      syncMusicToCurrentSection();
    }, { threshold: [0.45, 0.6, 0.75] });

    sections.forEach(function (section) { observer.observe(section); });
    updateByScrollPosition();
  }

  function markGestureAndPlay(event) {
    if (event && event.target && event.target.closest && event.target.closest(".otter-music-toggle")) {
      return;
    }
    hasUserGesture = true;
    setAudioState({ hasUserGesture: true });
    if (musicEnabled) syncMusicToCurrentSection();
  }

  function attachUnlockListeners() {
    if (unlockListenersAttached) return;
    unlockListenersAttached = true;
    document.addEventListener("pointerdown", markGestureAndPlay, { once: true, capture: true });
    document.addEventListener("pointerup", markGestureAndPlay, { once: true, capture: true });
    document.addEventListener("mousedown", markGestureAndPlay, { once: true, capture: true });
    document.addEventListener("click", markGestureAndPlay, { once: true, capture: true });
    document.addEventListener("keydown", markGestureAndPlay, { once: true, capture: true });
    document.addEventListener("touchstart", markGestureAndPlay, { once: true, passive: true, capture: true });
  }

  function toggleMusic(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    hasUserGesture = true;
    if (!musicEnabled) {
      musicEnabled = true;
    } else if (isCurrentTrackPlaying()) {
      musicEnabled = false;
    }
    setAudioState({ hasUserGesture: true, musicEnabled: musicEnabled });

    if (musicEnabled) {
      syncMusicToCurrentSection();
    } else {
      stopAllTracks();
      refreshToggleButton();
    }
  }

  function createToggleButton() {
    if (toggleButton || !document.body) return;

    toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = "otter-music-toggle is-waiting";
    toggleButton.innerHTML = [
      '<svg viewBox="0 0 32 32" aria-hidden="true">',
      '<path d="M22 4.2a2 2 0 0 1 2.4 2v13.2a5.2 5.2 0 1 1-3.2-4.8V10l-9.2 2.1v9.4a5.2 5.2 0 1 1-3.2-4.8v-9a2 2 0 0 1 1.56-1.95L22 4.2Z"/>',
      '<path class="slash" d="M5.2 4.2 28 27l-2.2 2.2L3 6.4z"/>',
      "</svg>",
      '<span class="otter-music-toggle-label"></span>'
    ].join("");
    toggleButton.addEventListener("click", toggleMusic);
    document.body.appendChild(toggleButton);
    refreshToggleButton();
  }

  function init() {
    ensureTrackElements();
    createToggleButton();
    setupObserver();
    attachUnlockListeners();
    warmupAndTryAutoplay();

    window.addEventListener("scroll", updateByScrollPosition, true);
    window.addEventListener("resize", updateByScrollPosition);
    window.addEventListener("otterlantis:lang-change", refreshToggleButton);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
