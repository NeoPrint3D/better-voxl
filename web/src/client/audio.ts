// The worker selects Opus or PCM and feeds the player over a MessageChannel.
import type { App } from './app';

export function createAudio(app: App) {
	let started = false;
	let ac: AudioContext | null = null;

	/** Call synchronously from gestures: iOS loses activation across awaits. */
	async function start() {
		if (ac && ac.state !== 'closed') {
			// Safari also uses "interrupted" after backgrounding or audio-route changes.
			if (ac.state !== 'running') void ac.resume().catch(() => {});
			if (started) return;
		}
		if (started) return;
		started = true;
		let context: AudioContext | null = null;
		try {
			context = ac = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
			// Must happen before addModule's await, inside the triggering gesture.
			void context.resume().catch(() => {});
			await context.audioWorklet.addModule('audio.js');
			const node = new AudioWorkletNode(context, 'pcm-player', {
				outputChannelCount: [2],
			});
			node.connect(context.destination);
			const ch = new MessageChannel();
			node.port.postMessage({ port: ch.port2 }, [ch.port2]);
			app.post({ t: 'audioPort', port: ch.port1 }, [ch.port1]);
		} catch (err) {
			started = false; // A transient module/device error must not disable audio forever.
			ac = null;
			if (context && context.state !== 'closed') void context.close().catch(() => {});
			console.warn('[voxl] audio unavailable; tap to retry', err);
		}
	}
	return { start };
}
