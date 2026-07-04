(function () {
  const API_BASE = "https://api.otterlantis.com";
  const STORAGE_KEY = "otterlantis_user";
  const SESSION_KEY = "otterlantis_session_id";
  const ASSET_BASE = "/page0";
  const NICKNAMES_ZH = ["月亮小水獭", "星星探险家", "海草观察员", "蓝莓小队长", "贝壳收藏家"];
  const NICKNAMES_EN = ["Moon Otter", "Star Explorer", "Shell Keeper", "Blueberry Buddy", "Tiny Captain"];

  const VIEWS = {
    identity: "identity",
    login: "login",
    child: "register-child",
    guardian: "register-guardian",
    created: "created",
  };

  const TEXT = {
    zh: {
      dialogLabel: "水獭账号注册登录",
      roleLabel: "选择身份",
      title: "欢迎来到 Otterlantis!",
      subtitle: "开始探索前，先选择你的身份",
      childTitle: "我是小朋友",
      childDesc: "创建我的水獭",
      guardianTitle: "我是家长",
      guardianDesc: "登录 / 注册家长账号",
      loginEntry: "已有 ID？登录",
      childTab: "我是小朋友",
      guardianTab: "我是家长",
      childRegisterTitle: "注册勇敢的水獭 ID",
      childRegisterDesc: "给你的水獭取个名字。不要使用真实姓名哦。",
      nicknameLabel: "水獭昵称",
      nicknamePlaceholder: "输入你的水獭昵称",
      random: "随机",
      createChild: "注册",
      guardianRegisterTitle: "注册家长 ID",
      displayNameLabel: "显示名",
      displayNamePlaceholder: "输入显示名",
      emailLabel: "邮箱",
      emailPlaceholder: "输入邮箱",
      createGuardian: "注册",
      guardianLoginEntry: "已有家长 ID？登录",
      loginTitle: "输入 ID 继续旅程",
      loginDesc: "如果你已经有水獭 ID，输入后就能继续玩。",
      otterIdLabel: "水獭 ID",
      otterIdPlaceholder: "OT-ABCDE",
      loginButton: "登录并开始",
      back: "返回",
      working: "处理中...",
      loggingIn: "登录中...",
      registering: "注册中...",
      enterOtterId: "请输入你的水獭 ID。",
      idNotFound: "没有找到这个 ID，请检查后重试，或注册一个新 ID。",
      loggedIn: "登录成功，继续出发！",
      nameRequired: "请先给水獭取个名字。",
      displayNameRequired: "请填写显示名。",
      emailRequired: "请输入邮箱。",
      emailInvalid: "请输入有效的邮箱。",
      registerFailed: "注册失败，请重试。",
      creationFailed: "创建失败，请重试。",
      childCreated: "注册成功，准备出发！",
      guardianCreated: "家长账号已创建。",
      yourOtterId: "你的水獭 ID：",
      yourParentId: "你的家长水獭 ID：",
      saveIdHint: "请记住这个 ID，下次可用它登录。",
      accountOtter: "水獭",
      accountParent: "家长",
      switchId: "切换 ID",
      skip: "跳过",
    },
    en: {
      dialogLabel: "Otter account registration and login",
      roleLabel: "Choose identity",
      title: "Welcome to Otterlantis!",
      subtitle: "Choose how you want to start your adventure",
      childTitle: "I'm a Kid",
      childDesc: "Create my otter",
      guardianTitle: "I'm a Parent",
      guardianDesc: "Log in / Sign up as a parent",
      loginEntry: "Already have an ID? Log in",
      childTab: "I'm a Kid",
      guardianTab: "I'm a Parent",
      childRegisterTitle: "Create Your Otter ID",
      childRegisterDesc: "Give your otter a name. Please do not use your real name.",
      nicknameLabel: "Otter Nickname",
      nicknamePlaceholder: "Enter your otter nickname",
      random: "Random",
      createChild: "Register",
      guardianRegisterTitle: "Register Parent ID",
      displayNameLabel: "Display Name",
      displayNamePlaceholder: "Enter display name",
      emailLabel: "Email",
      emailPlaceholder: "Enter email",
      createGuardian: "Register",
      guardianLoginEntry: "Already have a Parent ID? Log in",
      loginTitle: "Enter ID to Continue",
      loginDesc: "If you already have an Otter ID, enter it to continue.",
      otterIdLabel: "Otter ID",
      otterIdPlaceholder: "OT-ABCDE",
      loginButton: "Log in and Start",
      back: "Back",
      working: "Working...",
      loggingIn: "Logging in...",
      registering: "Registering...",
      enterOtterId: "Please enter your Otter ID.",
      idNotFound: "ID not found. Check it or register a new one.",
      loggedIn: "Logged in. Let's continue!",
      nameRequired: "Please name your otter first.",
      displayNameRequired: "Please enter a display name.",
      emailRequired: "Please enter an email.",
      emailInvalid: "Please enter a valid email.",
      registerFailed: "Registration failed. Please retry.",
      creationFailed: "Creation failed. Please retry.",
      childCreated: "Registered. Ready to play!",
      guardianCreated: "Parent account created.",
      yourOtterId: "Your Otter ID: ",
      yourParentId: "Your parent Otter ID: ",
      saveIdHint: "Save this ID. You can use it to log in next time.",
      accountOtter: "Otter",
      accountParent: "Parent",
      switchId: "Switch ID",
      skip: "Skip",
    },
  };

  function getLang() {
    const params = new URLSearchParams(window.location.search);
    const urlLang = params.get("lang");
    if (urlLang === "en" || urlLang === "zh") return urlLang;
    return "zh";
  }

  function t(key) {
    return TEXT[getLang()][key] || TEXT.zh[key] || key;
  }

  function asset(path) {
    return ASSET_BASE + path;
  }

  function langAsset(zhPath, enPath) {
    return asset(getLang() === "en" ? enPath : zhPath);
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

  function createFallbackUser(role, displayName, email) {
    const suffix =
      Date.now().toString(36).slice(-4).toUpperCase() +
      Math.random().toString(36).slice(2, 6).toUpperCase();
    return {
      otterId: "OT-" + suffix,
      role,
      displayName: displayName || (role === "guardian" ? "Parent" : randomNickname()),
      email: email || "",
      lang: getLang(),
      localOnly: true,
    };
  }

  function finishRegistration(overlay, role, user) {
    saveUser(user);
    track("user_create", { createdRole: role, localOnly: !!user.localOnly });
    renderView(overlay, VIEWS.created, { user, role });
    setTimeout(() => releaseGame(overlay), 900);
  }

  function syncServerUser(role, payload) {
    postJSON("/api/users", { role, ...payload, lang: getLang() })
      .then((data) => {
        if (!data || !data.user || !data.user.otterId) return;
        saveUser(data.user);
        renderAccountSwitcher();
        track("user_create_server_synced", { createdRole: role });
      })
      .catch(() => {});
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

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? (button.dataset.busy || t("working")) : button.dataset.label;
  }

  function showNote(el, message, kind) {
    el.className = "otter-auth-note" + (kind ? " " + kind : "");
    el.textContent = message;
  }

  function clearNotes(overlay) {
    overlay.querySelectorAll(".otter-auth-note").forEach((note) => showNote(note, "", ""));
  }

  function renderRoleTabs(activeRole) {
    return `
      <div class="otter-auth-role-tabs" role="tablist" aria-label="${t("roleLabel")}">
        <button class="otter-auth-role-tab otter-auth-role-tab--child ${activeRole === "child" ? "active" : ""}" type="button" data-view="${VIEWS.child}">
          ${t("childTab")}
        </button>
        <button class="otter-auth-role-tab otter-auth-role-tab--guardian ${activeRole === "guardian" ? "active" : ""}" type="button" data-view="${VIEWS.guardian}">
          ${t("guardianTab")}
        </button>
      </div>
    `;
  }

  function renderIdentitySelect() {
    return `
      <section class="otter-auth-shell otter-auth-shell--identity" data-panel="identity">
        <img class="otter-auth-paper-bg" src="${asset("/0-1/parchment-card-bg.webp")}" alt="">
        <img class="otter-auth-header-decor" src="${asset("/0-1/header-otter-decoration.webp")}" alt="">
        <div class="otter-auth-identity-content">
          <img class="otter-auth-title-art" src="${langAsset("/0-1/title-welcome-otterlantis-Chinese.webp", "/0-1/title-welcome-otterlantis-English.webp")}" alt="${t("title")}">
          <h1 class="otter-auth-sr-only">${t("title")}</h1>
          <p class="otter-auth-sr-only">${t("subtitle")}</p>
          <div class="otter-auth-role-grid">
            <button class="otter-auth-role-card otter-auth-role-card--child" type="button" data-view="${VIEWS.child}">
              <img class="otter-auth-role-bg" src="${asset("/0-1/role-card-child-bg.webp")}" alt="">
              <img class="otter-auth-role-figure otter-auth-role-figure--child" src="${asset("/0-1/child-otter-full.webp")}" alt="">
              <img class="otter-auth-role-text otter-auth-role-text--child" src="${langAsset("/0-1/role-child-text-zh.webp", "/0-1/role-child-text-en.webp")}" alt="${t("childTitle")} ${t("childDesc")}">
              <span class="otter-auth-sr-only">${t("childTitle")} ${t("childDesc")}</span>
              <img class="otter-auth-role-arrow" src="${asset("/0-1/arrow-button-orange.webp")}" alt="">
            </button>
            <button class="otter-auth-role-card otter-auth-role-card--guardian" type="button" data-view="${VIEWS.guardian}">
              <img class="otter-auth-role-bg" src="${asset("/0-1/role-card-parent-bg.webp")}" alt="">
              <img class="otter-auth-role-figure otter-auth-role-figure--guardian" src="${asset("/0-1/parent-house.webp")}" alt="">
              <img class="otter-auth-role-text otter-auth-role-text--guardian" src="${langAsset("/0-1/role-parent-text-zh.webp", "/0-1/role-parent-text-en.webp")}" alt="${t("guardianTitle")} ${t("guardianDesc")}">
              <span class="otter-auth-sr-only">${t("guardianTitle")} ${t("guardianDesc")}</span>
              <img class="otter-auth-role-arrow" src="${asset("/0-1/arrow-button-blue.webp")}" alt="">
            </button>
          </div>
          <button class="otter-auth-login-entry" type="button" data-view="${VIEWS.login}">${t("loginEntry")}</button>
          <button class="otter-auth-skip-button" type="button" data-skip-auth>${t("skip")}</button>
        </div>
      </section>
    `;
  }

  function renderChildRegister() {
    return `
      <section class="otter-auth-shell otter-auth-shell--register" data-panel="register-child">
        <img class="otter-auth-register-bg" src="${asset("/0-2/register-bg-paper.webp")}" alt="">
        <div class="otter-auth-register-content">
          ${renderRoleTabs("child")}
          <button class="otter-auth-back-button" type="button" data-view="${VIEWS.identity}" aria-label="${t("back")}">${t("back")}</button>
          <form class="otter-auth-form" data-form="child">
            <div class="otter-auth-register-title-row otter-auth-register-title-row--child">
              <img class="otter-auth-child-title-art" src="${asset("/0-2/register-child-title-decor.webp")}" alt="">
              <h2 class="otter-auth-title">${t("childRegisterTitle")}</h2>
              <p class="otter-auth-copy">${t("childRegisterDesc")}</p>
            </div>
            <div class="otter-auth-row otter-auth-row--child-name">
              <div class="otter-auth-field otter-auth-field--child-name">
                <label for="otterChildName">${t("nicknameLabel")}</label>
                <div class="otter-auth-child-input-art">
                  <input id="otterChildName" maxlength="16" autocomplete="nickname" placeholder="${t("nicknamePlaceholder")}">
                </div>
              </div>
              <button class="otter-auth-random-button" type="button" data-random aria-label="${t("random")}"></button>
            </div>
            <button class="otter-auth-primary-button" type="submit" data-label="${t("createChild")}" data-busy="${t("registering")}"><span class="otter-auth-primary-button-text">${t("createChild")}</span></button>
            <button class="otter-auth-skip-button" type="button" data-skip-auth>${t("skip")}</button>
            <div class="otter-auth-note" data-note="child"></div>
            <div class="otter-auth-id" data-id-box="child"></div>
          </form>
        </div>
      </section>
    `;
  }

  function renderGuardianRegister() {
    return `
      <section class="otter-auth-shell otter-auth-shell--register" data-panel="register-guardian">
        <img class="otter-auth-register-bg" src="${asset("/0-2/register-bg-paper.webp")}" alt="">
        <img class="otter-auth-house-decor" src="${asset("/0-2/parent-house.webp")}" alt="">
        <div class="otter-auth-register-content">
          ${renderRoleTabs("guardian")}
          <button class="otter-auth-back-button" type="button" data-view="${VIEWS.identity}" aria-label="${t("back")}">${t("back")}</button>
          <form class="otter-auth-form" data-form="guardian">
            <div class="otter-auth-register-title-row otter-auth-register-title-row--guardian">
              <img class="otter-auth-parent-title-art" src="${asset("/0-2/register-parent-id-title.webp")}" alt="${t("guardianRegisterTitle")}">
              <h2 class="otter-auth-title">${t("guardianRegisterTitle")}</h2>
            </div>
            <div class="otter-auth-parent-fields-art">
              <div class="otter-auth-field">
                <label for="otterGuardianName">${t("displayNameLabel")}</label>
                <input class="otter-auth-parent-real-input" id="otterGuardianName" maxlength="40" autocomplete="name" placeholder="${t("displayNamePlaceholder")}">
              </div>
              <div class="otter-auth-field">
                <label for="otterGuardianEmail">${t("emailLabel")}</label>
                <input class="otter-auth-parent-real-input" id="otterGuardianEmail" type="email" autocomplete="email" placeholder="${t("emailPlaceholder")}">
              </div>
            </div>
            <button class="otter-auth-primary-button" type="submit" data-label="${t("createGuardian")}" data-busy="${t("registering")}"><span class="otter-auth-primary-button-text">${t("createGuardian")}</span></button>
            <button class="otter-auth-text-button" type="button" data-view="${VIEWS.login}">${t("guardianLoginEntry")}</button>
            <button class="otter-auth-skip-button" type="button" data-skip-auth>${t("skip")}</button>
            <div class="otter-auth-note" data-note="guardian"></div>
            <div class="otter-auth-id" data-id-box="guardian"></div>
          </form>
        </div>
      </section>
    `;
  }

  function renderLoginForm() {
    return `
      <section class="otter-auth-shell otter-auth-shell--login" data-panel="login">
        <img class="otter-auth-register-bg" src="${asset("/0-2/register-bg-paper.webp")}" alt="">
        <div class="otter-auth-register-content">
          <button class="otter-auth-back-button" type="button" data-view="${VIEWS.identity}" aria-label="${t("back")}">${t("back")}</button>
          <form class="otter-auth-form" data-form="login">
            <h2 class="otter-auth-title">${t("loginTitle")}</h2>
            <p class="otter-auth-copy">${t("loginDesc")}</p>
            <div class="otter-auth-field">
              <label for="otterExistingId">${t("otterIdLabel")}</label>
              <input id="otterExistingId" maxlength="28" autocomplete="username" placeholder="${t("otterIdPlaceholder")}">
            </div>
            <button class="otter-auth-primary-button" type="submit" data-label="${t("loginButton")}" data-busy="${t("loggingIn")}"><span class="otter-auth-primary-button-text">${t("loginButton")}</span></button>
            <button class="otter-auth-skip-button" type="button" data-skip-auth>${t("skip")}</button>
            <div class="otter-auth-note" data-note="login"></div>
          </form>
        </div>
      </section>
    `;
  }

  function renderCreatedResult(user, role) {
    const idText = role === "guardian" ? t("yourParentId") : t("yourOtterId");
    return `
      <section class="otter-auth-shell otter-auth-shell--login" data-panel="created">
        <img class="otter-auth-register-bg" src="${asset("/0-2/register-bg-paper.webp")}" alt="">
        <div class="otter-auth-register-content">
          <div class="otter-auth-created">
            <h2 class="otter-auth-title">${role === "guardian" ? t("guardianCreated") : t("childCreated")}</h2>
            <div class="otter-auth-id show">${idText}${user.otterId}</div>
            <p class="otter-auth-copy">${t("saveIdHint")}</p>
          </div>
        </div>
      </section>
    `;
  }

  function buildOverlay() {
    const overlay = document.createElement("div");
    overlay.className = "otter-auth-overlay";
    overlay.innerHTML = `
      <div class="otter-auth-panel" role="dialog" aria-modal="true" aria-label="${t("dialogLabel")}"></div>
    `;
    return overlay;
  }

  function renderView(overlay, view, data) {
    const panel = overlay.querySelector(".otter-auth-panel");
    if (view === VIEWS.login) panel.innerHTML = renderLoginForm();
    else if (view === VIEWS.child) panel.innerHTML = renderChildRegister();
    else if (view === VIEWS.guardian) panel.innerHTML = renderGuardianRegister();
    else if (view === VIEWS.created) panel.innerHTML = renderCreatedResult(data.user, data.role);
    else panel.innerHTML = renderIdentitySelect();

    panel.dataset.view = view;
    bindPanelEvents(overlay, view);
    if (view === VIEWS.child) {
      const input = overlay.querySelector("#otterChildName");
      input.focus();
    } else if (view === VIEWS.login) {
      overlay.querySelector("#otterExistingId")?.focus();
    } else if (view === VIEWS.guardian) {
      overlay.querySelector("#otterGuardianName")?.focus();
    }
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
      <span class="otter-account-role">${user.role === "guardian" ? t("accountParent") : t("accountOtter")}</span>
      <span class="otter-account-id">${user.otterId}</span>
      <button type="button">${t("switchId")}</button>
    `;
    switcher.querySelector("button").addEventListener("click", () => {
      track("user_switch").finally(() => {
        clearUser();
        window.location.reload();
      });
    });
    document.body.appendChild(switcher);
  }

  function bindPanelEvents(overlay, view) {
    function trackRegisterSubmitOnce(form, payload) {
      if (!form || form.dataset.registerIntentTracked === "1") return;
      form.dataset.registerIntentTracked = "1";
      track("auth_register_submit", payload);
      setTimeout(() => {
        if (form) delete form.dataset.registerIntentTracked;
      }, 2000);
    }

    function completeRegisterNow(role, form) {
      if (form && form.dataset.registerSubmitting === "1") return;
      if (form) form.dataset.registerSubmitting = "1";
      const childName = overlay.querySelector("#otterChildName");
      const guardianName = overlay.querySelector("#otterGuardianName");
      const guardianEmail = overlay.querySelector("#otterGuardianEmail");
      const displayName =
        role === "guardian"
          ? guardianName?.value.trim() || "Parent"
          : childName?.value.trim() || randomNickname();
      const emailInput = guardianEmail?.value.trim() || "";
      const email = role === "guardian" && isValidEmail(emailInput) ? emailInput : "";
      const payload = role === "guardian" ? { displayName, email } : { displayName };
      trackRegisterSubmitOnce(form, { role, ...payload });
      finishRegistration(overlay, role, createFallbackUser(role, displayName, email));
      syncServerUser(role, payload);
    }

    function skipAuth() {
      const role = view === VIEWS.guardian ? "guardian" : "child";
      const user = createFallbackUser(role, role === "guardian" ? "Parent" : randomNickname());
      track("auth_skip", { role });
      finishRegistration(overlay, role, user);
    }

    overlay.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => {
        const nextView = button.dataset.view;
        clearNotes(overlay);
        if (nextView === VIEWS.child) track("auth_role_select_child");
        if (nextView === VIEWS.guardian) track("auth_role_select_guardian");
        if (nextView === VIEWS.login) track("auth_login_view");
        renderView(overlay, nextView);
      });
    });

    overlay.querySelector("[data-random]")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const childName = overlay.querySelector("#otterChildName");
      if (!childName) return;
      childName.value = randomNickname();
      childName.dispatchEvent(new Event("input", { bubbles: true }));
      childName.focus();
    });

    overlay.querySelectorAll("[data-skip-auth]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        skipAuth();
      });
    });

    const childRegisterForm = overlay.querySelector('[data-form="child"]');
    childRegisterForm?.querySelector(".otter-auth-primary-button")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      completeRegisterNow("child", childRegisterForm);
    });

    const guardianRegisterForm = overlay.querySelector('[data-form="guardian"]');
    guardianRegisterForm?.querySelector(".otter-auth-primary-button")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      completeRegisterNow("guardian", guardianRegisterForm);
    });

    overlay.querySelector('[data-form="login"]')?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector(".otter-auth-primary-button");
      const note = overlay.querySelector('[data-note="login"]');
      const input = overlay.querySelector("#otterExistingId");
      const otterId = input.value.trim().toUpperCase();
      if (!otterId) {
        showNote(note, t("enterOtterId"), "error");
        return;
      }
      setBusy(button, true);
      try {
        const data = await getJSON("/api/users/" + encodeURIComponent(otterId));
        saveUser(data.user);
        showNote(note, t("loggedIn"), "success");
        await track("user_login", { loginRole: data.user.role });
        setTimeout(() => releaseGame(overlay), 450);
      } catch (e) {
        showNote(note, t("idNotFound"), "error");
      } finally {
        setBusy(button, false);
      }
    });

    overlay.querySelector('[data-form="child"]')?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      completeRegisterNow("child", form);
    });

    overlay.querySelector('[data-form="guardian"]')?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      completeRegisterNow("guardian", form);
    });

    if (view === VIEWS.identity) track("auth_identity_select_view");
    if (view === VIEWS.child) track("auth_register_child_view");
    if (view === VIEWS.guardian) track("auth_register_guardian_view");
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
    renderView(overlay, VIEWS.identity);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initOverlay);
  } else {
    initOverlay();
  }
})();
