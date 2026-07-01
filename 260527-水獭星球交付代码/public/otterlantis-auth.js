(function () {
  const API_BASE = "https://api.otterlantis.com";
  const STORAGE_KEY = "otterlantis_user";
  const SESSION_KEY = "otterlantis_session_id";
  const NICKNAMES_ZH = ["月亮小水獭", "星星探险家", "海草观察员", "蓝莓小队长", "贝壳收藏家"];
  const NICKNAMES_EN = ["Moon Otter", "Star Explorer", "Shell Keeper", "Blueberry Buddy", "Tiny Captain"];

  function getLang() {
    const params = new URLSearchParams(window.location.search);
    const urlLang = params.get("lang");
    if (urlLang === "en" || urlLang === "zh") return urlLang;
    return document.documentElement.lang === "en" ? "en" : "zh";
  }

  function text(zh, en) {
    return getLang() === "en" ? en : zh;
  }

  function getSessionId() {
    let sid = localStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = "sess_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
      localStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  }

  function getStoredUser() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch (e) {
      return null;
    }
  }

  function saveUser(user) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    window.otterlantisUser = user;
  }

  function clearUser() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SESSION_KEY);
    window.otterlantisUser = null;
  }

  function randomNickname() {
    const names = getLang() === "en" ? NICKNAMES_EN : NICKNAMES_ZH;
    return names[Math.floor(Math.random() * names.length)];
  }

  async function postJSON(path, body) {
    const res = await fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || ("HTTP " + res.status));
    return data;
  }

  async function getJSON(path) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(API_BASE + path + sep + "_t=" + Date.now(), {
      headers: { "Accept": "application/json" },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || ("HTTP " + res.status));
    return data;
  }

  function track(event, extra) {
    const user = getStoredUser();
    return postJSON("/api/track", {
      sessionId: getSessionId(),
      event,
      ts: Date.now(),
      lang: getLang(),
      otterId: user && user.otterId,
      userRole: user && user.role,
      ...(extra || {}),
    }).catch(() => {});
  }

  function patchTrackFetch() {
    if (window.__otterAuthFetchPatched) return;
    window.__otterAuthFetchPatched = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        const url = typeof input === "string" ? input : input && input.url;
        const isTrack = typeof url === "string" && /\/api\/track(?:$|\?)/.test(url);
        const user = getStoredUser();
        if (isTrack && user && init && init.body && typeof init.body === "string") {
          const payload = JSON.parse(init.body);
          if (!payload.otterId) payload.otterId = user.otterId;
          if (!payload.userRole) payload.userRole = user.role;
          init = { ...init, body: JSON.stringify(payload) };
        }
      } catch (e) {}
      return originalFetch(input, init);
    };
  }

  function setBusy(button, busy) {
    button.disabled = busy;
    button.textContent = busy ? (button.dataset.busy || text("处理中...", "Working...")) : button.dataset.label;
  }

  function showNote(el, message, kind) {
    el.className = "otter-auth-note" + (kind ? " " + kind : "");
    el.textContent = message;
  }

  function buildOverlay() {
    const overlay = document.createElement("div");
    overlay.className = "otter-auth-overlay";
    overlay.innerHTML = `
      <div class="otter-auth-panel" role="dialog" aria-modal="true" aria-label="${text("水獭账号注册", "Otter account registration")}">
        <section class="otter-auth-brand">
          <div>
            <img class="otter-auth-logo" src="/Logo.svg?v=202606112151" alt="Otterlantis">
            <h2>${text("输入 ID，继续你的水獭旅程", "Enter your ID to continue")}</h2>
            <p>${text("已有水獭 ID 可以直接登录；没有 ID，就先注册一个专属 ID。", "Use an existing Otter ID, or register a new one before playing.")}</p>
          </div>
          <div class="otter-auth-badge">${text("每个人一个唯一 ID", "One unique ID per person")}</div>
        </section>
        <section class="otter-auth-card">
          <form class="otter-auth-form active" data-form="login">
            <h3 class="otter-auth-title">${text("直接输入 ID 登录", "Log in with your ID")}</h3>
            <p class="otter-auth-copy">${text("如果你已经有水獭 ID，输入后就能继续玩。", "If you already have an Otter ID, enter it to continue.")}</p>
            <div class="otter-auth-field">
              <label for="otterExistingId">${text("水獭 ID", "Otter ID")}</label>
              <input id="otterExistingId" maxlength="28" autocomplete="username" placeholder="OT-ABCDE">
            </div>
            <button class="otter-auth-button" type="submit" data-label="${text("登录并开始", "Log in and start")}" data-busy="${text("登录中...", "Logging in...")}">${text("登录并开始", "Log in and start")}</button>
            <button class="otter-auth-link-button" type="button" data-show-register>${text("没有 ID，注册 ID", "No ID? Register one")}</button>
            <div class="otter-auth-note" data-note="login"></div>
          </form>

          <div data-register-area hidden>
            <div class="otter-auth-tabs">
              <button class="otter-auth-tab active" type="button" data-role="child">${text("我是勇敢的水獭", "I'm a brave otter")}</button>
              <button class="otter-auth-tab" type="button" data-role="guardian">${text("我是家长", "I'm a parent")}</button>
            </div>

            <form class="otter-auth-form active" data-form="child">
              <h3 class="otter-auth-title">${text("注册勇敢的水獭 ID", "Register a brave otter ID")}</h3>
              <p class="otter-auth-copy">${text("给你的水獭取个名字。不要使用真实姓名哦。", "Name your otter. Do not use a real name.")}</p>
              <div class="otter-auth-row">
                <div class="otter-auth-field">
                  <label for="otterChildName">${text("水獭昵称", "Otter nickname")}</label>
                  <input id="otterChildName" maxlength="40" autocomplete="nickname">
                </div>
                <button class="otter-auth-link-button" type="button" data-random>${text("随机", "Random")}</button>
              </div>
              <button class="otter-auth-button" type="submit" data-label="${text("注册 ID 并开始", "Register ID and start")}" data-busy="${text("注册中...", "Registering...")}">${text("注册 ID 并开始", "Register ID and start")}</button>
              <div class="otter-auth-note" data-note="child"></div>
              <div class="otter-auth-id" data-id-box="child"></div>
            </form>

            <form class="otter-auth-form" data-form="guardian">
              <h3 class="otter-auth-title">${text("注册家长 ID", "Register a parent ID")}</h3>
              <p class="otter-auth-copy">${text("第一版先记录家长邮箱账号；验证码验证可在下一步接入。", "This MVP records the parent email first. Email code verification can be added next.")}</p>
              <div class="otter-auth-field">
                <label for="otterGuardianName">${text("显示名", "Display name")}</label>
                <input id="otterGuardianName" maxlength="40" autocomplete="name">
              </div>
              <div class="otter-auth-field">
                <label for="otterGuardianEmail">${text("邮箱", "Email")}</label>
                <input id="otterGuardianEmail" type="email" autocomplete="email">
              </div>
              <button class="otter-auth-button" type="submit" data-label="${text("注册家长 ID", "Register parent ID")}" data-busy="${text("注册中...", "Registering...")}">${text("注册家长 ID", "Register parent ID")}</button>
              <div class="otter-auth-note" data-note="guardian"></div>
              <div class="otter-auth-id" data-id-box="guardian"></div>
            </form>
          </div>
        </section>
      </div>
    `;
    return overlay;
  }

  function releaseGame(overlay) {
    document.documentElement.classList.remove("otter-auth-lock");
    document.body.classList.remove("otter-auth-lock");
    overlay.remove();
    renderAccountSwitcher();
    track("game_start_after_register");
  }

  function renderAccountSwitcher() {
    const user = getStoredUser();
    document.querySelector(".otter-account-switcher")?.remove();
    if (!user || !user.otterId) return;

    const switcher = document.createElement("div");
    switcher.className = "otter-account-switcher";
    switcher.innerHTML = `
      <span class="otter-account-role">${user.role === "guardian" ? text("家长", "Parent") : text("水獭", "Otter")}</span>
      <span class="otter-account-id">${user.otterId}</span>
      <button type="button">${text("切换 ID", "Switch ID")}</button>
    `;
    switcher.querySelector("button").addEventListener("click", () => {
      track("user_switch").finally(() => {
        clearUser();
        window.location.reload();
      });
    });
    document.body.appendChild(switcher);
  }

  function initOverlay() {
    const existing = getStoredUser();
    window.otterlantisUser = existing;
    patchTrackFetch();
    if (existing && existing.otterId) {
      renderAccountSwitcher();
      return;
    }

    document.documentElement.classList.add("otter-auth-lock");
    document.body.classList.add("otter-auth-lock");
    const overlay = buildOverlay();
    document.body.appendChild(overlay);
    track("auth_modal_view");

    const childName = overlay.querySelector("#otterChildName");
    childName.value = randomNickname();

    overlay.querySelector('[data-form="login"]').addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector(".otter-auth-button");
      const note = overlay.querySelector('[data-note="login"]');
      const input = overlay.querySelector("#otterExistingId");
      const otterId = input.value.trim().toUpperCase();
      if (!otterId) {
        showNote(note, text("请输入你的水獭 ID。", "Please enter your Otter ID."), "error");
        return;
      }
      setBusy(button, true);
      try {
        const data = await getJSON("/api/users/" + encodeURIComponent(otterId));
        saveUser(data.user);
        showNote(note, text("登录成功，继续出发！", "Logged in. Let's continue!"), "success");
        await track("user_login", { loginRole: data.user.role });
        setTimeout(() => releaseGame(overlay), 450);
      } catch (e) {
        showNote(note, text("没有找到这个 ID，请检查后重试，或注册一个新 ID。", "ID not found. Check it or register a new one."), "error");
      } finally {
        setBusy(button, false);
      }
    });

    overlay.querySelector("[data-show-register]").addEventListener("click", () => {
      overlay.querySelector('[data-form="login"]').classList.remove("active");
      overlay.querySelector("[data-register-area]").hidden = false;
      overlay.querySelector('[data-form="child"]').classList.add("active");
      childName.focus();
      track("auth_register_open");
    });

    overlay.querySelector("[data-random]").addEventListener("click", () => {
      childName.value = randomNickname();
      childName.focus();
    });

    overlay.querySelectorAll(".otter-auth-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        overlay.querySelectorAll(".otter-auth-tab").forEach((el) => el.classList.remove("active"));
        overlay.querySelectorAll('[data-register-area] .otter-auth-form').forEach((el) => el.classList.remove("active"));
        tab.classList.add("active");
        overlay.querySelector(`[data-form="${tab.dataset.role}"]`).classList.add("active");
      });
    });

    overlay.querySelector('[data-form="child"]').addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector(".otter-auth-button");
      const note = overlay.querySelector('[data-note="child"]');
      const idBox = overlay.querySelector('[data-id-box="child"]');
      const displayName = childName.value.trim();
      if (!displayName) {
        showNote(note, text("请先给水獭取个名字。", "Please name your otter first."), "error");
        return;
      }
      setBusy(button, true);
      try {
        const data = await postJSON("/api/users", { role: "child", displayName, lang: getLang() });
        saveUser(data.user);
        idBox.textContent = text("你的水獭 ID：", "Your Otter ID: ") + data.user.otterId;
        idBox.classList.add("show");
        showNote(note, text("注册成功，准备出发！", "Registered. Ready to play!"), "success");
        await track("user_create", { createdRole: "child" });
        setTimeout(() => releaseGame(overlay), 650);
      } catch (e) {
        showNote(note, e.message || text("注册失败，请重试。", "Registration failed. Please retry."), "error");
      } finally {
        setBusy(button, false);
      }
    });

    overlay.querySelector('[data-form="guardian"]').addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector(".otter-auth-button");
      const note = overlay.querySelector('[data-note="guardian"]');
      const idBox = overlay.querySelector('[data-id-box="guardian"]');
      const displayName = overlay.querySelector("#otterGuardianName").value.trim() || text("家长", "Parent");
      const email = overlay.querySelector("#otterGuardianEmail").value.trim();
      if (!email) {
        showNote(note, text("请输入邮箱。", "Please enter an email."), "error");
        return;
      }
      setBusy(button, true);
      try {
        const data = await postJSON("/api/users", { role: "guardian", displayName, email, lang: getLang() });
        saveUser(data.user);
        idBox.textContent = text("你的家长水獭 ID：", "Your parent Otter ID: ") + data.user.otterId;
        idBox.classList.add("show");
        showNote(note, text("家长账号已创建。", "Parent account created."), "success");
        await track("user_create", { createdRole: "guardian" });
        setTimeout(() => releaseGame(overlay), 650);
      } catch (e) {
        showNote(note, e.message || text("创建失败，请重试。", "Creation failed. Please retry."), "error");
      } finally {
        setBusy(button, false);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initOverlay);
  } else {
    initOverlay();
  }
})();
