import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'voxl-fullscreen-'));
try {
  for (const name of ['video', 'fullscreen']) execFileSync('esbuild', [
    `web/src/client/${name}.ts`, '--bundle', '--platform=node', '--format=esm',
    `--outfile=${join(dir, name + '.mjs')}`, '--log-level=error',
  ]);
  class Classes extends Set {
    contains(c) { return this.has(c); }
    remove(c) { this.delete(c); }
    toggle(c, on = !this.has(c)) { if (on) this.add(c); else this.delete(c); return on; }
  }
  class Element extends EventTarget {
    classList = new Classes(); style = {}; textContent = '';
    setAttribute() {} getBoundingClientRect() { return { height: 150 }; }
    click() { this.dispatchEvent(new Event('click')); }
  }
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  globalThis.document = new EventTarget();
  document.documentElement = new Element();
  document.getElementById = get;
  document.fullscreenEnabled = true;
  document.fullscreenElement = null;
  globalThis.window = { innerWidth: 834, innerHeight: 1194, devicePixelRatio: 2, visualViewport: null };
  let locks = 0, unlocks = 0;
  const keyboard = {
    async lock(...args) {
      assert.ok(document.fullscreenElement, 'lock only after fullscreen is active');
      assert.equal(args.length, 0, 'all keys, including Escape, must be locked');
      locks++;
    },
    unlock() { unlocks++; },
  };
  Object.defineProperty(globalThis, 'navigator', { value: { keyboard }, configurable: true });
  let standalone = false;
  globalThis.matchMedia = query => ({ matches: query === '(pointer: coarse)' || (standalone && query === '(display-mode: standalone)'), addEventListener() {} });
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '24' });
  const saved = new Map();
  globalThis.localStorage = { getItem: k => saved.get(k), setItem: (k, v) => saved.set(k, v) };
  globalThis.requestAnimationFrame = fn => fn();
  const app = { desk: { w: 1920, h: 1080 }, view: { scale: 1, zoom: 1, x: .5, y: .5 }, surface: new Element(), tools: new Element() };
  get('dock-toggle').addEventListener('click', () => app.tools.classList.toggle('dock-collapsed'));
  const { createVideo } = await import(pathToFileURL(join(dir, 'video.mjs')));
  const { setupFullscreen } = await import(pathToFileURL(join(dir, 'fullscreen.mjs')));
  const video = createVideo(app, new Element(), false, () => {});
  video.build([[0, 540], [540, 540]]);
  video.layout();
  const normal = { ...app.surface.style };
  assert.ok(parseFloat(normal.width) < 834, 'windowed mode still reserves safe areas');
  assert.ok(parseFloat(normal.height) < 1194, 'windowed mode still fits aspect ratio');
  document.documentElement.requestFullscreen = async () => {
    document.fullscreenElement = document.documentElement;
    document.dispatchEvent(new Event('fullscreenchange'));
  };
  document.exitFullscreen = async () => {
    document.fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
  };
  setupFullscreen(app, video.layout);
  app.view.zoom = 2;
  get('fs-btn').click();
  await new Promise(r => setImmediate(r));
  assert.equal(locks, 1, 'request Keyboard Lock when entering fullscreen');
  const nativeEscape = new Event('keydown'); nativeEscape.key = 'Escape'; document.dispatchEvent(nativeEscape);
  assert.equal(document.fullscreenElement, document.documentElement, 'no page-level Escape exit');
  assert.equal(app.view.zoom, 1, 'fullscreen starts with the entire desktop visible');
  assert.ok(app.tools.classList.contains('dock-collapsed'));
  function fills(w, h) {
    assert.equal(app.surface.style.width, `${w}px`);
    assert.equal(app.surface.style.height, `${h}px`);
    assert.equal(app.surface.style.left, '0px');
    assert.equal(app.surface.style.top, '0px');
  }
  fills(834, 1194);
  app.tools.classList.remove('dock-collapsed'); video.layout();
  fills(834, 1194); // Expanding controls overlays instead of shrinking video.
  window.innerWidth = 1194; window.innerHeight = 834; video.layout();
  fills(1194, 834);
  window.visualViewport = { width: 1194, height: 500, offsetLeft: 0, offsetTop: 0 }; video.layout();
  fills(1194, 500); // Visible viewport above the software keyboard.
  get('fit-btn').click();
  assert.ok(Math.abs(parseFloat(app.surface.style.width) / parseFloat(app.surface.style.height) - 1920 / 1080) < 1e-9);
  get('fit-btn').click(); fills(1194, 500);
  get('fs-btn').click(); await new Promise(r => setImmediate(r));
  assert.ok(!app.tools.classList.contains('dock-collapsed'));
  window.visualViewport = null; window.innerWidth = 834; window.innerHeight = 1194;
  video.layout(); assert.deepEqual(app.surface.style, normal, 'exit restores windowed layout');
  assert.ok(unlocks >= 2, 'release lock when leaving fullscreen');
  document.fullscreenEnabled = false;
  get('fs-btn').click(); await new Promise(r => setImmediate(r));
  fills(834, 1194);
  const escape = new Event('keydown'); escape.key = 'Escape'; document.dispatchEvent(escape);
  assert.ok(document.documentElement.classList.contains('voxl-immersive'), 'Escape must not leave immersive fullscreen');
  fills(834, 1194);
  get('fs-btn').click(); await new Promise(r => setImmediate(r));
  assert.ok(!document.documentElement.classList.contains('voxl-immersive'), 'fullscreen button remains an exit');
  standalone = true; video.layout(); fills(834, 1194);
  console.log('PASS: fullscreen fill/fit, safe areas, overlay dock, rotation, keyboard viewport, zoom reset, exit restore, iOS fallback and standalone');
} finally { rmSync(dir, { recursive: true, force: true }); }
