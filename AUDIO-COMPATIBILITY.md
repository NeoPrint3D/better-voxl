# Desktop audio on iPad/iPhone

Older Safari versions support WebCodecs video but do not expose `AudioDecoder`.
Previously the page returned immediately in that case, silently disabling audio.
Playback resume also handled only `suspended`, not Safari's `interrupted` state,
and the initial resume happened after awaiting the worklet module.

## Compatibility path

- The socket worker probes Opus with `AudioDecoder.isConfigSupported()`.
- Compatible browsers keep the existing Opus packets (`0x02`, `au,1`).
- Missing/unsupported/failed Opus decoders select `au,1,pcm`. The server sends
  `0x05` followed by signed 16-bit little-endian interleaved stereo at 48 kHz.
- PCM is converted to planar floats in the worker and delivered to the existing
  jitter-buffered worklet. It requires about 1.536 Mbps during active audio,
  excluding transport overhead; it is a compatibility tradeoff, not a bandwidth
  optimization. Other clients still receive Opus.
- All capture backends share format-aware fanout; raw packets are allocated only
  when a PCM subscriber exists. Disabled audio and read-only policies still apply.
- Resume is attempted synchronously before loading the worklet and on gestures,
  including touchend/click and toolbar taps. Non-running contexts (including iOS
  interruptions) can resume on a subsequent tap. Initialization failures can retry.

After deployment reload the browser page to load the new client/worker, then tap
once inside the page. After an iOS interruption, another tap may be necessary.

## Validation

- `node test-audio.mjs`: bundled client/worker tests with Web API doubles covering
  absent/unsupported decoders, rejected support probes, runtime codec failures,
  reconnect negotiation, PCM byte order/channel samples, malformed PCM rejection,
  synchronous resume, interrupted-state recovery and worklet-load retry.
- `npm run typecheck`: all three TypeScript targets.
- `cargo test --lib` and `cargo test --release --lib`: includes audio fanout and
  protocol negotiation checks (read-only allowed, audio-disabled still blocked).

These are automated regression tests, not proof of audible output on physical
Apple hardware. Confirm on iPad/iPhone with server audio playing, page reloaded,
one tap to unlock audio, and device volume/output route checked. Background/lock
screen playback is not guaranteed by this change. macOS/Windows capture fanout
was updated but not compiled on this Linux host.
