// Native fullscreen where available; viewport-only immersive mode otherwise.
import type { App } from './app';
import { el } from './app';

type SafariDocument = Document & {
	webkitFullscreenElement?: Element;
	webkitFullscreenEnabled?: boolean;
	webkitExitFullscreen?: () => void;
};
type SafariElement = HTMLElement & { webkitRequestFullscreen?: () => void };

export function isFullscreen() {
	return !!(document.fullscreenElement || (document as SafariDocument).webkitFullscreenElement ||
		document.documentElement.classList.contains('voxl-immersive') ||
		matchMedia('(display-mode: fullscreen)').matches ||
		matchMedia('(display-mode: standalone)').matches ||
		(navigator as Navigator & { standalone?: boolean }).standalone);
}

export function setupFullscreen(app: App, layout: () => void) {
	const button = el<HTMLButtonElement>('fs-btn');
	const fit = el<HTMLButtonElement>('fit-btn');
	const root = document.documentElement as SafariElement;
	const doc = document as SafariDocument;
	let wasFullscreen = false;
	let wasCollapsed = false;
	try { root.classList.toggle('voxl-fit', localStorage.getItem('voxl-fullscreen-fit') === 'true'); } catch {}
	function update() {
		const active = isFullscreen();
		if (active !== wasFullscreen) {
			if (active) {
				wasCollapsed = app.tools.classList.contains('dock-collapsed');
				if (!wasCollapsed) el('dock-toggle').click();
				app.view.zoom = 1;
				el('zoom-btn').textContent = 'Zoom 1×';
			} else if (!wasCollapsed && app.tools.classList.contains('dock-collapsed')) {
				el('dock-toggle').click();
			}
			wasFullscreen = active;
		}
		button.classList.toggle('on', active);
		button.setAttribute('aria-pressed', String(active));
		fit.textContent = root.classList.contains('voxl-fit') ? 'View: Fit' : 'View: Fill';
		fit.title = 'Fullscreen: Fill uses every pixel; Fit preserves the desktop aspect ratio';
		layout();
		// Safari can report the new viewport a frame after fullscreenchange.
		requestAnimationFrame(layout);
	}
	fit.addEventListener('click', () => {
		root.classList.toggle('voxl-fit');
		try { localStorage.setItem('voxl-fullscreen-fit', String(root.classList.contains('voxl-fit'))); } catch {}
		update();
	});
	button.addEventListener('click', async () => {
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
			else if (doc.webkitFullscreenElement) doc.webkitExitFullscreen?.();
			else if (root.classList.contains('voxl-immersive')) root.classList.remove('voxl-immersive');
			else if (document.fullscreenEnabled && root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
			else if (doc.webkitFullscreenEnabled && root.webkitRequestFullscreen) root.webkitRequestFullscreen();
			else root.classList.add('voxl-immersive');
		} catch (error) {
			console.warn('[voxl] native fullscreen unavailable; filling browser viewport', error);
			root.classList.add('voxl-immersive');
		}
		update();
	});
	async function lockFullscreenKeyboard() {
		if (!document.fullscreenElement && !doc.webkitFullscreenElement) {
			navigator.keyboard?.unlock();
			button.title = 'Fullscreen (captures browser shortcuts where supported)';
			return;
		}
		try {
			if (!navigator.keyboard?.lock) throw new Error('Keyboard Lock is not supported by this browser');
			// With no key list, lock ALL keys, including Escape and browser shortcuts.
			// Request only after native fullscreen is active. Chromium may ask permission;
			// its emergency long-press Escape exit cannot be disabled by a web page.
			await navigator.keyboard.lock();
			if (!document.fullscreenElement && !doc.webkitFullscreenElement) {
				navigator.keyboard.unlock();
				return;
			}
			button.title = 'Exit fullscreen (tap Escape for the remote desktop; hold Escape for the browser emergency exit)';
		} catch (error) {
			if (!document.fullscreenElement && !doc.webkitFullscreenElement) return;
			button.title = 'Exit fullscreen (browser may reserve Escape; allow Keyboard Lock or use the installed app)';
			console.warn('[voxl] Cannot capture Escape in native fullscreen. Allow Keyboard Lock if prompted, or use the installed app.', error);
		}
	}
	for (const event of ['fullscreenchange', 'webkitfullscreenchange']) {
		document.addEventListener(event, () => {
			void lockFullscreenKeyboard();
			update();
		});
	}
	// Never bind Escape to leaving immersive mode: keyboard.ts forwards it to the
	// remote application. The fullscreen button is the explicit local exit control.
	for (const query of ['(display-mode: standalone)', '(display-mode: fullscreen)']) {
		matchMedia(query).addEventListener('change', update);
	}
	update();
	void lockFullscreenKeyboard();
}
