// No browser/server needed: exercise bundled client/worker with Web API doubles.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';

const dir = mkdtempSync(join(tmpdir(), 'voxl-audio-'));
function bundle(path, name) {
  const out = join(dir, name + '.js');
  execFileSync('esbuild', [path, '--bundle', '--format=iife', '--global-name=' + name, '--outfile=' + out, '--log-level=error']);
  return readFileSync(out, 'utf8');
}
try {
  const client = bundle('web/src/client/audio.ts', 'audioModule');
  const worker = bundle('web/src/worker.ts', 'workerModule');
  let failModule = true;
  const contexts = [];
  const messages = [];
  class Context {
    state = 'suspended';
    resumes = 0;
    destination = {};
    audioWorklet = { addModule: async () => {
      assert.ok(this.resumes > 0, 'resume must happen before awaiting module loading');
      if (failModule) throw new Error('transient module failure');
    }};
    constructor() { contexts.push(this); }
    resume() { this.resumes++; this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  const sandbox = vm.createContext({
    console: { warn() {} }, AudioContext: Context,
    AudioWorkletNode: class { port = { postMessage() {} }; connect() {} },
    MessageChannel: class { port1 = {}; port2 = {}; },
    // Deliberately no AudioDecoder (older iOS Safari).
  });
  vm.runInContext(client, sandbox);
  const audio = sandbox.audioModule.createAudio({ post: m => messages.push(m) });
  await audio.start();
  assert.equal(contexts[0].state, 'closed');
  failModule = false;
  await audio.start();
  assert.equal(messages.length, 1, 'initialization retries without AudioDecoder');
  const context = contexts[1];
  context.state = 'interrupted';
  const before = context.resumes;
  await audio.start();
  assert.equal(context.resumes, before + 1, 'resume interrupted iOS context');
  assert.equal(messages.length, 1, 'resuming must not create another player');

  async function checkWorker(Decoder, expected) {
    let receive;
    const sockets = [];
    const sent = [];
    const chunks = [];
    class Socket {
      static OPEN = 1;
      readyState = 1;
      listeners = {};
      constructor() { sockets.push(this); }
      addEventListener(t, fn) { this.listeners[t] = fn; }
      send(s) { sent.push(s); }
    }
    const scope = vm.createContext({
      self: { location: { search: '' }, addEventListener: (_, fn) => receive = fn, postMessage() {} },
      WebSocket: Socket, AudioDecoder: Decoder,
      EncodedAudioChunk: class { constructor(data) { Object.assign(this, data); } },
      performance: { now: () => 0 }, setInterval() {}, setTimeout() {}, console,
      Uint8Array, Float32Array, DataView,
    });
    vm.runInContext(worker, scope);
    receive({ data: { t: 'init', canvas: { getContext: () => null }, url: 'ws://test' } });
    receive({ data: { t: 'audioPort', port: { postMessage: m => chunks.push(m), close() {} } } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sent.at(-1), expected);
    // Reconnection must preserve the selected format.
    sockets[0].listeners.open();
    assert.equal(sent.at(-1), expected);
    return { sent, chunks, socket: sockets[0] };
  }
  const pcm = await checkWorker(undefined, 'au,1,pcm');
  pcm.socket.listeners.message({ data: new Uint8Array([5, 0, 128, 255, 127]).buffer });
  assert.equal(pcm.chunks.length, 1);
  assert.equal(pcm.chunks[0].l[0], -1);
  assert.equal(pcm.chunks[0].r[0], 32767 / 32768);
  pcm.socket.listeners.message({ data: new Uint8Array([5, 1]).buffer });
  assert.equal(pcm.chunks.length, 1, 'malformed PCM is ignored');
  await checkWorker(class { static async isConfigSupported() { return { supported: false }; } }, 'au,1,pcm');
  await checkWorker(class { static async isConfigSupported() { throw Error('unsupported'); } }, 'au,1,pcm');
  class BrokenDecoder {
    static async isConfigSupported() { return { supported: true }; }
    state = 'unconfigured';
    configure() { throw Error('runtime codec failure'); }
    close() { this.state = 'closed'; }
  }
  const opus = await checkWorker(BrokenDecoder, 'au,1');
  opus.socket.listeners.message({ data: new Uint8Array([2, 1, 2]).buffer });
  assert.equal(opus.sent.at(-1), 'au,1,pcm', 'runtime decoder failure switches to PCM');
  console.log('PASS: audio initialization/retry, iOS resume, codec negotiation, reconnect, PCM samples, runtime fallback');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
