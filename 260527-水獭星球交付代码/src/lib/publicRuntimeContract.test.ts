import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readProjectFile(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function assertAbsent(source: string, patterns: string[], label: string) {
  for (const pattern of patterns) {
    assert.equal(
      source.includes(pattern),
      false,
      `${label} must not contain ${pattern}`,
    );
  }
}

function assertPresent(source: string, patterns: string[], label: string) {
  for (const pattern of patterns) {
    assert.equal(
      source.includes(pattern),
      true,
      `${label} must contain ${pattern}`,
    );
  }
}

const indexHtml = readProjectFile('index.html');
const navigationRuntime = readProjectFile('public/otterlantis-navigation.js');
const audioRuntime = readProjectFile('public/otterlantis-audio.js');
const loaderRuntime = readProjectFile('public/otterlantis-loader.js');
const authRuntime = readProjectFile('public/otterlantis-auth.js');
const storyTtsRuntime = readProjectFile('public/otterlantis-story-tts.js');

assertPresent(navigationRuntime, [
  'mode: "react-owned-section-state"',
  'globalScrollGuard: false',
  'data-otter-navigation-runtime',
], 'navigation runtime');

assertAbsent(navigationRuntime, [
  'installWheelGuard',
  'findSectionScroller',
  'preventDefault',
  'touchmove',
  'PageDown',
  'MutationObserver',
], 'navigation runtime');

assertPresent(audioRuntime, [
  'window.__otterSectionState',
  'document.body.dataset.otterActiveSectionIndex',
  'otterlantis:section-change',
  'handleReactSectionChange',
], 'audio runtime');

assertPresent(loaderRuntime, [
  'window.__otterLoaderFetchPatched',
  'typeof _nativeFetch',
], 'loader runtime');

assertPresent(authRuntime, [
  'safeStorageGet',
  'safeStorageSet',
  'memorySessionId',
  'window.__otterAuthFetchPatched',
], 'auth runtime');

assertPresent(storyTtsRuntime, [
  'otterlantis:section-change',
  'sectionName !== "story"',
  'stop();',
], 'story TTS runtime');

assertPresent(indexHtml, [
  '/otterlantis-story-tts.js?v=20260704-p1-boundary',
  '/otterlantis-loader.js?v=20260704-p1-boundary',
  '/otterlantis-navigation.js?v=20260704-p1-boundary',
  '/otterlantis-audio.js?v=20260704-p1-boundary',
  '/otterlantis-auth.js?v=20260704-p1-boundary',
], 'index public runtime versions');

console.log('public runtime contracts ok');
