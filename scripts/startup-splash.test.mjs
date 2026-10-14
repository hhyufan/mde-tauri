import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';

const script = readFileSync(new URL('../public/splash/splash.js', import.meta.url), 'utf8');
const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url)));

function splash({ stored, systemDark = false, decodeFailure = false } = {}) {
  let domReady;
  let finishDecode;
  const calls = [];
  const frames = [];
  const timers = new Map();
  const image = { decode: () => new Promise((resolve, reject) => {
    finishDecode = decodeFailure ? () => reject(new Error('missing asset')) : resolve;
  }) };
  const dataset = {};
  const context = {
    localStorage: { getItem: (key) => key === 'mokidown-theme' ? stored : null },
    matchMedia: () => ({ matches: systemDark }),
    document: {
      documentElement: { dataset }, readyState: 'loading',
      addEventListener: (_event, callback) => { domReady = callback; },
      querySelector: (selector) => selector === '.card__image' ? image : { classList: { add() {} } },
    },
    window: { __TAURI_INTERNALS__: { invoke: async (...args) => { calls.push(args); } } },
    requestAnimationFrame: (callback) => { frames.push(callback); },
    setTimeout: (callback, delay) => { const id = {}; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    console,
  };
  vm.runInNewContext(script, context);
  return { image, dataset, calls, frames, timers,
    start: () => domReady(), decode: () => finishDecode() };
}

test('theme is chosen before DOM readiness; reveal waits for decoded image and layout', async () => {
  const page = splash({ stored: JSON.stringify({ state: { theme: 'dark' } }) });
  assert.equal(page.dataset.theme, 'dark');
  const prepared = page.start();
  assert.equal(page.image.src, './hello-dark.png');
  assert.equal(page.calls.length, 0);
  page.decode();
  await setImmediate();
  assert.equal(page.calls.length, 0);
  page.frames.shift()();
  page.frames.shift()();
  await prepared;
  assert.equal(page.calls.length, 1);
  assert.equal(page.calls[0][0], 'splash_ready');
  assert.equal(page.calls[0][1].dark, true);
  assert.equal(page.timers.size, 0);
});

test('hidden WebView with paused frames still reveals using the bounded fallback', async () => {
  const page = splash({ stored: 'invalid', systemDark: false });
  assert.equal(page.dataset.theme, 'light');
  const prepared = page.start();
  page.decode();
  await setImmediate();
  const [{ callback, delay }] = page.timers.values();
  assert.equal(delay, 80);
  callback();
  await prepared;
  assert.equal(page.image.src, './hello-light.png');
  assert.equal(page.calls[0][0], 'splash_ready');
  assert.equal(page.calls[0][1].dark, false);
});

test('missing image does not trap the editor behind the splash', async () => {
  const page = splash({ decodeFailure: true, systemDark: true });
  const prepared = page.start();
  page.decode();
  await setImmediate();
  page.frames.shift()();
  page.frames.shift()();
  await prepared;
  assert.equal(page.image.hidden, true);
  assert.equal(page.calls[0][0], 'splash_ready');
});

test('native windows start hidden and splash assets load under the production CSP', () => {
  const main = config.app.windows.find((window) => window.label === 'main');
  const card = config.app.windows.find((window) => window.label === 'splash');
  assert.equal(main.visible, false);
  assert.equal(card.visible, false);
  assert.equal(card.focus, false);
  assert.equal(card.skipTaskbar, true);
  assert.equal(card.width, 640);
  assert.equal(card.height, 400);
  const html = readFileSync(new URL('../public/splash/index.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="\.\/splash.js"><\/script>/);
  assert.doesNotMatch(html, /<script[^>]*>\s*[^<\s]/);
  assert.doesNotMatch(script, /import\s*\(/);
  for (const asset of ['hello-dark.png', 'hello-light.png', 'splash.css']) {
    assert.ok(readFileSync(new URL(`../public/splash/${asset}`, import.meta.url)).length > 0);
  }
});

test('splash uses original lossless pixels with sufficient resolution for 200% scaling', () => {
  for (const asset of ['hello-dark.png', 'hello-light.png']) {
    const source = readFileSync(new URL(`../src/assets/characters/${asset}`, import.meta.url));
    const deployed = readFileSync(new URL(`../public/splash/${asset}`, import.meta.url));
    assert.deepEqual(deployed, source);
    assert.ok(deployed.readUInt32BE(16) >= 1280);
    assert.ok(deployed.readUInt32BE(20) >= 800);
  }
});
