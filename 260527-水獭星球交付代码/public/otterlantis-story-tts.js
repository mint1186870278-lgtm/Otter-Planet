(function () {
  var TTS_URL = "/api/fish-tts";
  var STORY_ROLE = "storyNarrator";
  var STORY_REFERENCE_ID = "64f3d78c5b164c13b6257a302da856e7";

  var audio = null;
  var abortController = null;
  var objectUrl = null;
  var retryHandler = null;
  var requestId = 0;

  window.__otterlantisStoryTtsState = {
    role: STORY_ROLE,
    referenceId: STORY_REFERENCE_ID,
    status: "idle",
    lastError: null,
    lastText: "",
    lastUpdatedAt: Date.now()
  };

  function setState(patch) {
    Object.keys(patch).forEach(function (key) {
      window.__otterlantisStoryTtsState[key] = patch[key];
    });
    window.__otterlantisStoryTtsState.lastUpdatedAt = Date.now();
    if (document.body && patch.status) {
      document.body.setAttribute("data-otter-story-tts", patch.status);
    }
  }

  function getAudio() {
    if (audio) return audio;
    audio = document.createElement("audio");
    audio.preload = "auto";
    audio.volume = 1;
    audio.playsInline = true;
    audio.setAttribute("playsinline", "");
    audio.setAttribute("data-otterlantis-audio", "story-tts");
    audio.setAttribute("aria-hidden", "true");
    audio.style.display = "none";
    if (document.body) document.body.appendChild(audio);
    return audio;
  }

  function clearRetry() {
    if (!retryHandler) return;
    window.removeEventListener("pointerdown", retryHandler, true);
    window.removeEventListener("keydown", retryHandler, true);
    retryHandler = null;
  }

  function revokeObjectUrl() {
    if (!objectUrl) return;
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  function cleanText(text) {
    return String(text || "")
      .replace(/\[(?:OK|COMPLETE|NAME:[^\]]*)\]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function stop() {
    requestId += 1;
    clearRetry();
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      try {
        audio.load();
      } catch (error) {}
    }
    revokeObjectUrl();
    setState({ status: "idle", lastError: null });
  }

  function scheduleRetry(currentRequestId) {
    clearRetry();
    retryHandler = function () {
      clearRetry();
      if (currentRequestId !== requestId || !audio || !audio.src) return;
      attemptPlay(currentRequestId);
    };
    window.addEventListener("pointerdown", retryHandler, true);
    window.addEventListener("keydown", retryHandler, true);
    setState({ status: "waiting-for-gesture" });
  }

  function attemptPlay(currentRequestId) {
    if (currentRequestId !== requestId || !audio || !audio.src) return;
    clearRetry();
    setState({ status: "playing", lastError: null });
    var playPromise = audio.play();
    if (!playPromise || typeof playPromise.catch !== "function") return;
    playPromise.catch(function (error) {
      if (currentRequestId !== requestId) return;
      if (error && error.name === "NotAllowedError") {
        scheduleRetry(currentRequestId);
        return;
      }
      setState({
        status: "playback-error",
        lastError: error && error.message ? error.message : String(error)
      });
      console.warn("Story Fish Audio playback failed", error);
    });
  }

  async function play(text) {
    stop();
    var clean = cleanText(text);
    if (!clean) return;

    var currentRequestId = requestId + 1;
    requestId = currentRequestId;
    abortController = new AbortController();
    setState({ status: "loading", lastText: clean, lastError: null });

    try {
      var response = await fetch(TTS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: STORY_ROLE,
          reference_id: STORY_REFERENCE_ID,
          text: clean
        }),
        signal: abortController.signal
      });

      if (!response.ok) throw new Error("Story Fish TTS relay " + response.status);

      var blob = await response.blob();
      if (currentRequestId !== requestId || abortController.signal.aborted) return;

      revokeObjectUrl();
      objectUrl = URL.createObjectURL(blob);
      var player = getAudio();
      audio = player;
      player.src = objectUrl;
      player.onended = function () {
        if (currentRequestId !== requestId) return;
        revokeObjectUrl();
        setState({ status: "ended" });
      };
      attemptPlay(currentRequestId);
    } catch (error) {
      if (error && error.name === "AbortError") return;
      setState({
        status: "error",
        lastError: error && error.message ? error.message : String(error)
      });
      console.warn("Story Fish Audio failed", error);
    }
  }

  window.__otterlantisStoryTts = {
    play: play,
    stop: stop,
    clearRetry: clearRetry,
    getState: function () {
      return Object.assign({}, window.__otterlantisStoryTtsState);
    }
  };
})();
