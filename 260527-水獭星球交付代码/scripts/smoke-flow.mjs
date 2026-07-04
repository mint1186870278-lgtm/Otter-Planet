#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000/';
const SCREENSHOT_DIR = process.env.SMOKE_SCREENSHOT_DIR || '/tmp/otter-smoke-flow';
const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'google-chrome',
  'chromium',
  'chrome',
].filter(Boolean);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate.includes('/')) {
      if (existsSync(candidate)) return candidate;
    } else {
      return candidate;
    }
  }
  throw new Error('Chrome not found. Set CHROME_BIN=/path/to/chrome and retry.');
}

async function startChrome() {
  assert(typeof WebSocket !== 'undefined', 'This smoke test needs Node with global WebSocket support.');
  const userDataDir = await mkdtemp(join(tmpdir(), 'otter-smoke-chrome-'));
  const chrome = spawn(findChrome(), [
    '--headless=new',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for Chrome DevTools endpoint.')), 15000);
    const onData = data => {
      const text = String(data);
      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    chrome.stdout.on('data', onData);
    chrome.stderr.on('data', onData);
    chrome.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited before DevTools was ready: ${code}`));
    });
    chrome.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });

  return { chrome, endpoint, userDataDir };
}

class CdpClient {
  constructor(endpoint) {
    this.endpoint = endpoint;
    this.ws = new WebSocket(endpoint);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', event => this.handleMessage(event.data));
  }

  close() {
    this.ws.close();
  }

  key(method, sessionId = '') {
    return `${sessionId}:${method}`;
  }

  on(method, sessionId, handler) {
    const key = this.key(method, sessionId);
    const list = this.listeners.get(key) || [];
    list.push(handler);
    this.listeners.set(key, list);
    return () => {
      const current = this.listeners.get(key) || [];
      this.listeners.set(key, current.filter(item => item !== handler));
    };
  }

  waitForEvent(method, sessionId, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      const unsubscribe = this.on(method, sessionId, params => {
        clearTimeout(timer);
        unsubscribe();
        resolve(params);
      });
    });
  }

  handleMessage(raw) {
    const message = JSON.parse(String(raw));
    if (message.id) {
      const item = this.pending.get(message.id);
      if (!item) return;
      this.pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else item.resolve(message.result || {});
      return;
    }

    const list = this.listeners.get(this.key(message.method, message.sessionId || '')) || [];
    for (const handler of list) handler(message.params || {});
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    const message = sessionId ? { id, method, params, sessionId } : { id, method, params };
    this.ws.send(JSON.stringify(message));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }
}

const initScript = `
(() => {
  localStorage.setItem('otterlantis_user', JSON.stringify({
    otterId: 'OT-SMOKE',
    role: 'child',
    displayName: 'Smoke Test',
    lang: 'zh',
    localOnly: true
  }));
  localStorage.setItem('otterlantis_session_id', 'sess_smoke_flow');

  const counts = {};
  window.__otterListenerCounts = counts;
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (this === window) counts[type] = (counts[type] || 0) + 1;
    return add.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function(type, listener, options) {
    if (this === window) counts[type] = Math.max(0, (counts[type] || 0) - 1);
    return remove.call(this, type, listener, options);
  };

  function activeSection() {
    const viewportArea = window.innerWidth * window.innerHeight;
    return Array.from(document.querySelectorAll('[data-otter-game-section]'))
      .map(el => {
        const r = el.getBoundingClientRect();
        const w = Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0));
        const h = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
        return { el, name: el.getAttribute('data-otter-game-section'), area: w * h, ratio: viewportArea ? w * h / viewportArea : 0 };
      })
      .sort((a, b) => b.area - a.area)[0] || null;
  }

  window.__otterSmokeInfo = function() {
    const active = activeSection();
    return {
      active: active ? { name: active.name, ratio: Number(active.ratio.toFixed(3)) } : null,
      authOverlay: !!document.querySelector('.otter-auth-overlay'),
      frameworkOverlay: !!document.querySelector('vite-error-overlay, .vite-error-overlay, .webpack-dev-server-client-overlay, nextjs-portal'),
      canvasCount: document.querySelectorAll('canvas').length,
      tutorialDirections: document.querySelectorAll('[data-tutorial-direction]').length,
      listenerCounts: { ...counts },
      textSample: document.body.innerText.slice(0, 240),
      title: document.title,
      url: location.href
    };
  };

  window.__otterSmokeClickFirstButton = function() {
    const active = activeSection();
    const startLabel = Array.from(active?.el.querySelectorAll('*') || [])
      .find(el =>
        el.textContent &&
        el.textContent.includes('\\u5f00\\u59cb\\u63a2\\u7d22') &&
        !Array.from(el.children).some(child => child.textContent?.includes('\\u5f00\\u59cb\\u63a2\\u7d22'))
      );
    const button = startLabel?.closest('button') || (active && active.el.querySelector('button'));
    if (!button) throw new Error('No first button in active section');
    button.click();
  };

  window.__otterSmokeClickMoonIsland = function() {
    const active = activeSection();
    const moonLabel = Array.from(active?.el.querySelectorAll('*') || [])
      .find(el =>
        el.textContent &&
        el.textContent.includes('\\u6708\\u4eae\\u5c9b') &&
        !Array.from(el.children).some(child => child.textContent?.includes('\\u6708\\u4eae\\u5c9b'))
      );
    const target = moonLabel?.closest('.cursor-pointer') || moonLabel;
    if (!target) throw new Error('Moon island target not found');
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  };

  window.__otterSmokeClickLastControl = function() {
    const active = activeSection();
    const controls = Array.from(active?.el.querySelectorAll('button,[role="button"]') || [])
      .filter(el => !el.hasAttribute('disabled'));
    const target = controls[controls.length - 1];
    if (!target) throw new Error('No active control found');
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  };

  window.__otterSmokeClickSaveMemory = function() {
    const active = activeSection();
    const target = active?.el.querySelector('[data-otter-save-memory]');
    if (!target) throw new Error('Save memory button not found');
    for (const type of ['pointerdown', 'pointerup', 'click']) {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    target.click();
  };

  window.__otterSmokeSaveMemoryPoint = function() {
    const active = activeSection();
    const target = active?.el.querySelector('[data-otter-save-memory]');
    if (!target) throw new Error('Save memory button not found');
    const rect = target.getBoundingClientRect();
    return {
      x: Math.max(1, Math.min(window.innerWidth - 1, rect.left + rect.width * 0.42)),
      y: Math.max(1, Math.min(window.innerHeight - 1, rect.top + rect.height * 0.78)),
      text: target.textContent
    };
  };
})();
`;

async function main() {
  await rm(SCREENSHOT_DIR, { recursive: true, force: true });
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const chromeState = await startChrome();
  const cdp = new CdpClient(chromeState.endpoint);
  await cdp.open();
  const consoleMessages = [];

  try {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Network.enable', {}, sessionId);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: initScript }, sessionId);

    cdp.on('Runtime.consoleAPICalled', sessionId, params => {
      if (!['warning', 'error'].includes(params.type)) return;
      consoleMessages.push({
        type: params.type,
        text: (params.args || []).map(arg => arg.value || arg.description || '').join(' '),
      });
    });
    cdp.on('Runtime.exceptionThrown', sessionId, params => {
      consoleMessages.push({ type: 'exception', text: params.exceptionDetails?.text || 'Runtime exception' });
    });

    const evaluate = async expression => {
      const result = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      }, sessionId);
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Evaluation failed');
      }
      return result.result?.value;
    };

    const navigate = async url => {
      const load = cdp.waitForEvent('Page.loadEventFired', sessionId, 15000).catch(() => null);
      await cdp.send('Page.navigate', { url }, sessionId);
      await load;
    };

    const reload = async () => {
      const load = cdp.waitForEvent('Page.loadEventFired', sessionId, 15000).catch(() => null);
      await cdp.send('Page.reload', { ignoreCache: true }, sessionId);
      await load;
    };

    const clickPoint = async ({ x, y }) => {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x,
        y,
        button: 'none',
        buttons: 0,
      }, sessionId);
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        buttons: 1,
        clickCount: 1,
      }, sessionId);
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        buttons: 0,
        clickCount: 1,
      }, sessionId);
    };

    const info = () => evaluate('window.__otterSmokeInfo()');
    const screenshot = async name => {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
      const path = join(SCREENSHOT_DIR, `${name}.png`);
      await writeFile(path, Buffer.from(data, 'base64'));
      return path;
    };

    const waitFor = async (label, predicate, timeoutMs = 15000) => {
      const start = Date.now();
      let last;
      while (Date.now() - start < timeoutMs) {
        last = await info();
        if (predicate(last)) return last;
        await sleep(120);
      }
      throw new Error(`Timed out waiting for ${label}. Last state: ${JSON.stringify(last)}`);
    };

    const waitForActive = name => waitFor(`active section ${name}`, state => state.active?.name === name && state.active.ratio > 0.45);
    const settleActive = async name => {
      await sleep(900);
      const state = await waitForActive(name);
      assert(state.active.ratio === 1, `${name} did not settle to a full viewport`);
      assert(!state.authOverlay, `${name} has auth overlay`);
      assert(!state.frameworkOverlay, `${name} has framework overlay`);
      return state;
    };

    const directSection = async (index, name) => {
      await navigate(`${BASE_URL}?test=1&smoke=${Date.now()}-${index}`);
      await evaluate(`sessionStorage.setItem('otter_pending_section', String(${index}))`);
      await reload();
      return settleActive(name);
    };

    const results = [];
    await navigate(`${BASE_URL}?test=1&smoke=${Date.now()}`);
    results.push({ step: 'load-main', state: await settleActive('main') });

    await evaluate('window.__otterSmokeClickFirstButton()');
    await sleep(1000);
    await evaluate('window.__otterSmokeClickMoonIsland()');
    results.push({ step: 'main-to-storybook', state: await settleActive('storybook'), screenshot: await screenshot('storybook') });

    for (let i = 0; i < 4; i += 1) {
      await evaluate('window.__otterSmokeClickLastControl()');
      await sleep(250);
    }
    results.push({ step: 'storybook-to-intro', state: await settleActive('intro'), screenshot: await screenshot('intro') });

    results.push({ step: 'direct-parkour', state: await directSection(3, 'parkour') });
    await waitFor('parkour canvas and tutorial', state => state.canvasCount >= 1 && state.tutorialDirections >= 4, 25000);
    const parkourKey = await evaluate(`(() => {
      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', bubbles: true, cancelable: true });
      const dispatchResult = window.dispatchEvent(event);
      return { dispatchResult, defaultPrevented: event.defaultPrevented };
    })()`);
    assert(parkourKey.defaultPrevented === true, 'Parkour did not own ArrowLeft while visible');
    results.push({ step: 'parkour-keydown', state: await info(), key: parkourKey, screenshot: await screenshot('parkour') });

    results.push({ step: 'direct-story', state: await directSection(4, 'story') });
    const storySpace = await evaluate(`(() => {
      const event = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
      const dispatchResult = window.dispatchEvent(event);
      return { dispatchResult, defaultPrevented: event.defaultPrevented };
    })()`);
    assert(storySpace.defaultPrevented === false, 'Story should not block Space default handling globally');
    results.push({ step: 'story-space', state: await info(), key: storySpace, screenshot: await screenshot('story') });

    results.push({ step: 'direct-gallery', state: await directSection(5, 'gallery') });
    const galleryState = await info();
    assert(!('keydown' in galleryState.listenerCounts), 'Gallery should not inherit story/parkour keydown listener');
    await evaluate('window.__otterSmokeSaveMemoryPoint()');
    results.push({ step: 'gallery-save-button-present', state: galleryState, screenshot: await screenshot('gallery') });

    results.push({ step: 'direct-egg', state: await directSection(6, 'egg'), screenshot: await screenshot('egg') });

    const relevantConsole = consoleMessages.filter(entry =>
      !/THREE\.Clock|PCFSoftShadowMap|Failed to load resource|favicon|WebGL context could not be created|Error creating WebGL context|Uncaught \(in promise\)/i.test(entry.text)
    );
    assert(relevantConsole.length === 0, `Relevant console errors/warnings found: ${JSON.stringify(relevantConsole)}`);

    console.log(JSON.stringify({
      ok: true,
      baseUrl: BASE_URL,
      screenshots: SCREENSHOT_DIR,
      results: results.map(item => ({
        step: item.step,
        active: item.state.active,
        key: item.key,
        screenshot: item.screenshot,
      })),
    }, null, 2));
  } finally {
    cdp.close();
    chromeState.chrome.kill('SIGTERM');
    await sleep(300);
    await rm(chromeState.userDataDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }).catch(() => {});
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
