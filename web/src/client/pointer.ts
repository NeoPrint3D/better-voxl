// Mouse, wheel/trackpad and touch input on the desktop surface.
import { cmd } from '../protocol';
import type { App } from './app';
import { createTouch } from './touch';

/** DOM button -> X button (left, middle, right, back, forward). */
const BUTTONS = [1, 2, 3, 8, 9];

export function setupPointer(app: App, onInteract: () => void) {
	const { surface, send } = app;

	function toDesk(p: { clientX: number; clientY: number }): [number, number] {
		const r = surface.getBoundingClientRect();
		const x = Math.round(((p.clientX - r.left) * app.desk.w) / r.width);
		const y = Math.round(((p.clientY - r.top) * app.desk.h) / r.height);
		return [
			Math.max(0, Math.min(app.desk.w - 1, x)),
			Math.max(0, Math.min(app.desk.h - 1, y)),
		];
	}
	let lastMove = '';
	let position: [number, number] | null = null;
	let lastBackgroundMouse: { x: number; y: number } | null = null;
	type InputMode = 'pad' | 'direct';
	let inputMode: InputMode = matchMedia('(pointer: coarse)').matches ? 'pad' : 'direct';
	try {
		const saved = localStorage.getItem('voxl-input-mode');
		if (saved === 'pad' || saved === 'direct') inputMode = saved;
		else if (localStorage.getItem('voxl-touch-mode') === 'direct') inputMode = 'direct';
	} catch {}
	let trackpad = inputMode !== 'direct';
	const marker = document.createElement('div');
	marker.id = 'touch-cursor';
	marker.setAttribute('aria-hidden', 'true');
	surface.appendChild(marker);
	function emit(x: number, y: number, force = false) {
		if (!app.desk.w || !app.desk.h) return;
		position = [Math.max(0, Math.min(app.desk.w - 1, x)), Math.max(0, Math.min(app.desk.h - 1, y))];
		marker.style.left = `${position[0] / app.desk.w * 100}%`;
		marker.style.top = `${position[1] / app.desk.h * 100}%`;
		app.view.x = position[0] / app.desk.w;
		app.view.y = position[1] / app.desk.h;
		if (app.view.zoom > 1) surface.dispatchEvent(new Event('voxl-layout'));
		const s = cmd.move(Math.round(position[0]), Math.round(position[1]));
		if (s !== lastMove || force) {
			lastMove = s;
			send(s);
		}
	}
	function move(p: { clientX: number; clientY: number }, force = false) {
		emit(...toDesk(p), force);
	}
	function moveBy(dx: number, dy: number) {
		const [x, y] = position || [app.desk.w / 2, app.desk.h / 2];
		// Scale gestures against the full remote desktop and user-selected cursor speed.
		// New 1× baseline is half the previous relative-pointer speed.
		const gain = deskPerPx() * (precision ? 0.4 : 2) * cursorSpeed;
		emit(x + dx * gain, y + dy * gain);
	}

	// Scroll is sent in desktop pixels, batched per frame; the server turns it into
	// smooth (pixel-precise) scrolling, or wheel clicks on X servers that can't.
	let sx = 0,
		sy = 0,
		queued = false;
	function flushScroll() {
		queued = false;
		if (Math.abs(sx) < 0.5 && Math.abs(sy) < 0.5) return;
		// X11 wheel fallback caps each input at 20 notches. Drain large flicks
		// over frames instead of silently losing the excess in one command.
		const dx = Math.max(-1440, Math.min(1440, sx));
		const dy = Math.max(-1440, Math.min(1440, sy));
		sx -= dx; sy -= dy;
		send(cmd.scroll(dx, dy));
		if (Math.abs(sx) >= 0.5 || Math.abs(sy) >= 0.5) {
			queued = true;
			requestAnimationFrame(flushScroll);
		}
	}
	function queueScroll(dx: number, dy: number) {
		sx += dx;
		sy += dy;
		if (queued) return;
		queued = true;
		requestAnimationFrame(flushScroll);
	}
	/** Desktop pixels per on-screen pixel. */
	const deskPerPx = () => {
		const width = surface.getBoundingClientRect().width;
		return app.desk.w && width ? app.desk.w / width : 1;
	};

	const background = document.getElementById('trackpad-space')!;
	const touchPointers = new Set<number>();
	let backgroundGesture = false;
	const touch = createTouch(app, {
		moveTo: (x, y) => move({ clientX: x, clientY: y }, true),
		moveBy,
		queueScroll,
		cancelScroll: () => { sx = sy = 0; },
		deskPerPx,
		isTrackpad: () => trackpad || backgroundGesture,
		isDragging: () => dragging,
		holdArrows: () => backgroundGesture,
		captureTarget: () => backgroundGesture ? background : surface,
	});
	app.tools?.addEventListener('pointerdown', touch.stopMomentum, true);
	app.kbd.addEventListener('keydown', touch.stopMomentum);
	app.kbd.addEventListener('input', touch.stopMomentum);
	function resetTouch() {
		touch.reset();
		touchPointers.clear();
		backgroundGesture = false;
	}
	function startTouch(e: PointerEvent, fromBackground: boolean) {
		if (!touchPointers.size) backgroundGesture = fromBackground;
		touchPointers.add(e.pointerId);
		const relative = trackpad || backgroundGesture;
		marker.classList.toggle('visible', relative);
		if (relative && !position) emit(app.desk.w / 2, app.desk.h / 2, true);
		touch.down(e);
	}
	function endTouch(e: PointerEvent) {
		touch.up(e);
		touchPointers.delete(e.pointerId);
		if (!touchPointers.size) backgroundGesture = false;
	}
	function cancelTouch(e: PointerEvent) {
		if (touchPointers.has(e.pointerId)) reset();
	}
	const modeBtn = document.getElementById('touch-mode-btn')!;
	const dragBtn = document.getElementById('drag-btn')!;
	let dragging = false;
	function setDragging(on: boolean) {
		dragging = on;
		send(cmd.button(1, on));
		dragBtn.classList.toggle('on', on);
		dragBtn.setAttribute('aria-pressed', String(on));
	}
	function saveMode() {
		try { localStorage.setItem('voxl-input-mode', inputMode); } catch {}
	}
	function updateMode() {
		trackpad = inputMode !== 'direct';
		const label = inputMode === 'pad' ? 'Pad' : 'Direct';
		modeBtn.textContent = label;
		modeBtn.setAttribute('data-input-mode', inputMode);
		modeBtn.setAttribute('aria-label', `Input mode: ${label}. Tap to change mode.`);
		modeBtn.title = 'Input mode: Pad / Direct';
		marker.classList.toggle('visible', trackpad && matchMedia('(pointer: coarse)').matches);
	}
	modeBtn.addEventListener('click', () => {
		reset();
		inputMode = inputMode === 'pad' ? 'direct' : 'pad';
		saveMode();
		updateMode();
	});
	for (const [id, button] of [['left-btn', 1], ['right-btn', 3]] as const) {
		document.getElementById(id)!.addEventListener('click', () => {
			touch.stopMomentum();
			if (dragging) setDragging(false);
			emit(...(position || [app.desk.w / 2, app.desk.h / 2]), true);
			send(cmd.button(button, true));
			send(cmd.button(button, false));
		});
	}
	dragBtn.addEventListener('click', () => {
		resetTouch();
		if (inputMode === 'direct') { inputMode = 'pad'; saveMode(); }
		updateMode();
		emit(...(position || [app.desk.w / 2, app.desk.h / 2]), true);
		setDragging(!dragging);
	});
	let precision = false;
	try { precision = localStorage.getItem('voxl-precision') === 'fine'; } catch {}
	let cursorSpeed = 1;
	try {
		const savedSpeed = parseFloat(localStorage.getItem('voxl-cursor-speed-v2') || '');
		if (Number.isFinite(savedSpeed) && savedSpeed >= 0.2 && savedSpeed <= 4) cursorSpeed = savedSpeed;
	} catch {}
	const precisionBtn = document.getElementById('precision-btn')!;
	const speedSlider = document.getElementById('speed-slider') as HTMLInputElement | null;
	const speedBtn = document.getElementById('speed-btn');
	function updateSpeedUI() {
		if (speedSlider) speedSlider.value = String(cursorSpeed);
		if (speedBtn) speedBtn.textContent = `${Number(cursorSpeed.toFixed(2))}×`;
	}
	function setCursorSpeed(next: number) {
		cursorSpeed = Math.max(0.25, Math.min(3.5, Math.round(next * 4) / 4));
		try { localStorage.setItem('voxl-cursor-speed-v2', String(cursorSpeed)); } catch {}
		updateSpeedUI();
	}
	speedSlider?.addEventListener('input', () => {
		const v = parseFloat(speedSlider.value);
		if (Number.isFinite(v)) setCursorSpeed(v);
	});
	speedBtn?.addEventListener('click', () => {
		const presets = [0.5, 0.75, 1, 1.5, 2, 3];
		const idx = presets.findIndex(p => Math.abs(p - cursorSpeed) < 0.05);
		setCursorSpeed(presets[(idx + 1) % presets.length]);
	});
	updateSpeedUI();
	function updatePrecision() {
		precisionBtn.classList.toggle('on', precision);
		precisionBtn.setAttribute('aria-pressed', String(precision));
	}
	precisionBtn.addEventListener('click', () => {
		precision = !precision;
		try { localStorage.setItem('voxl-precision', precision ? 'fine' : 'fast'); } catch {}
		updatePrecision();
	});
	updatePrecision();
	function reset() {
		lastBackgroundMouse = null;
		resetTouch();
		if (dragging) setDragging(false);
	}
	surface.addEventListener('voxl-release-input', reset);
	surface.addEventListener('voxl-release-pointer', reset);
	window.addEventListener('blur', reset);
	document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
	surface.addEventListener('lostpointercapture', cancelTouch);
	background.addEventListener('lostpointercapture', cancelTouch);
	updateMode();

	surface.addEventListener('pointermove', (e) => {
		if (e.pointerType === 'touch') touch.move(e);
		else move(e);
	});
	surface.addEventListener('pointerdown', (e) => {
		e.preventDefault();
		onInteract();
		if (e.pointerType === 'touch') {
			startTouch(e, false);
			return;
		}
		marker.classList.remove('visible');
		touch.stopMomentum();
		app.kbd.focus({ preventScroll: true });
		move(e);
		try {
			surface.setPointerCapture(e.pointerId);
		} catch {}
		send(cmd.button(BUTTONS[e.button] || 1, true));
	});
	surface.addEventListener('pointerup', (e) => {
		e.preventDefault();
		if (e.pointerType === 'touch') {
			endTouch(e);
			return;
		}
		move(e);
		send(cmd.button(BUTTONS[e.button] || 1, false));
	});
	surface.addEventListener('pointercancel', (e) => {
		if (e.pointerType === 'touch') reset();
		else send(cmd.releaseAll);
	});
	surface.addEventListener('contextmenu', (e) => e.preventDefault());

	// Letterboxed/unused page space is a relative trackpad, regardless of the
	// desktop's Direct/Trackpad toggle. Capturing on the starting region keeps a
	// swipe continuous when a finger crosses onto the video or over the dock.
	background.addEventListener('pointerdown', e => {
		e.preventDefault();
		onInteract();
		if (e.pointerType === 'touch') {
			startTouch(e, true);
			return;
		}
		touch.stopMomentum();
		app.kbd.focus({ preventScroll: true });
		marker.classList.add('visible');
		if (!position) emit(app.desk.w / 2, app.desk.h / 2, true);
		lastBackgroundMouse = { x: e.clientX, y: e.clientY };
		try { background.setPointerCapture(e.pointerId); } catch {}
		send(cmd.button(BUTTONS[e.button] || 1, true));
	});
	background.addEventListener('pointermove', e => {
		if (e.pointerType === 'touch') {
			touch.move(e);
			return;
		}
		marker.classList.add('visible');
		if (lastBackgroundMouse) moveBy(e.clientX - lastBackgroundMouse.x, e.clientY - lastBackgroundMouse.y);
		lastBackgroundMouse = { x: e.clientX, y: e.clientY };
	});
	background.addEventListener('pointerleave', e => {
		if (!e.buttons && e.pointerType !== 'touch') lastBackgroundMouse = null;
	});
	background.addEventListener('pointerup', e => {
		e.preventDefault();
		if (e.pointerType === 'touch') {
			endTouch(e);
			return;
		}
		send(cmd.button(BUTTONS[e.button] || 1, false));
	});
	background.addEventListener('pointercancel', e => {
		lastBackgroundMouse = null;
		if (e.pointerType === 'touch') reset();
		else { reset(); send(cmd.releaseAll); }
	});
	background.addEventListener('contextmenu', e => e.preventDefault());
	background.addEventListener('wheel', e => {
		e.preventDefault();
		touch.stopMomentum();
		const k = (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1) * deskPerPx();
		queueScroll(e.deltaX * k, e.deltaY * k);
	}, { passive: false });
	surface.addEventListener(
		'wheel',
		(e) => {
			e.preventDefault();
			touch.stopMomentum();
			move(e);
			const k =
				(e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1) * deskPerPx();
			queueScroll(e.deltaX * k, e.deltaY * k);
		},
		{ passive: false }
	);
}
