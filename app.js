(() => {
  'use strict';

  const STORAGE_KEY = 'pomodoro.settings.v1';
  const THEMES = ['clean', 'linear', 'falling', 'grayscale'];
  const DIGIT_MOTION = ['falling', 'grayscale'];   // themes that animate digit changes
  const STYLES = ['digital', 'ring', 'bar'];
  const BAR_SEGMENTS = 24;                           // matches the segment lines in style.css
  const LIMITS = { focus: [1, 180], break: [1, 60] };
  const DEFAULTS = { focus: 25, break: 5, theme: 'clean', style: 'digital' };
  const THEME_COLOR = { clean: '#F7F7F8', linear: '#08090A', falling: '#120E1F', grayscale: '#111111' };

  const $ = (sel) => document.querySelector(sel);
  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const form = $('#setup-form');
  const focusInput = $('#focus-min');
  const breakInput = $('#break-min');
  const durationError = $('#duration-error');
  const startBtn = $('#start-btn');

  const setupView = $('#setup');
  const timerView = $('#timer');
  const stage = $('#stage');
  const phaseEl = $('#phase');
  const clockEl = $('#clock');
  const metaEl = $('#meta');
  const ringEl = $('#ring-progress');
  const barEl = $('#bar-fill');
  const controls = $('#controls');
  const doneActions = $('#done-actions');
  const pauseBtn = $('#pause-btn');
  const fsBtn = $('#fs-btn');
  const nextBtn = $('#next-btn');
  const announcer = $('#announcer');

  /* ---------------------------------------------------------
     Settings
     --------------------------------------------------------- */
  const validMinutes = (v, [min, max]) => Number.isInteger(v) && v >= min && v <= max;

  function loadSettings() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (_) { /* ignore */ }
    return {
      focus: validMinutes(saved.focus, LIMITS.focus) ? saved.focus : DEFAULTS.focus,
      break: validMinutes(saved.break, LIMITS.break) ? saved.break : DEFAULTS.break,
      theme: THEMES.includes(saved.theme) ? saved.theme : DEFAULTS.theme,
      style: STYLES.includes(saved.style) ? saved.style : DEFAULTS.style,
    };
  }

  function saveSettings(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (_) { /* ignore */ }
  }

  function readForm() {
    return {
      focus: Number(focusInput.value),
      break: Number(breakInput.value),
      theme: form.elements.theme.value,
      style: form.elements.style.value,
    };
  }

  /**
   * Switch theme. With an origin point (a click/keyboard pick), the new theme
   * spreads out as a circle from there via the View Transitions API; without
   * one — or without browser support / with reduced motion — it swaps instantly.
   */
  let themeTransition = null;
  let activeTheme = root.dataset.theme;   // updated immediately; the DOM catches up a frame later
  function applyTheme(theme, origin) {
    if (activeTheme === theme) return;
    activeTheme = theme;
    const swap = () => {
      root.dataset.theme = theme;
      $('meta[name="theme-color"]').setAttribute('content', THEME_COLOR[theme]);
      Falling.setActive(theme === 'falling');
    };
    if (!origin || !document.startViewTransition || reduceMotion.matches) {
      swap();
      return;
    }

    const { x, y } = origin;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    root.classList.add('theme-swap');
    const t = document.startViewTransition(swap);
    themeTransition = t;
    t.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 650, easing: 'cubic-bezier(.4, 0, .2, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    }).catch(() => { /* skipped by a newer switch */ });
    t.finished.finally(() => {
      if (themeTransition === t) root.classList.remove('theme-swap');
    });
  }

  /** Entrance animation for a screen that just appeared (themes opt in via CSS `.enter`). */
  const enterTimers = new Map();
  function playEntrance(view) {
    view.classList.remove('enter');
    void view.offsetWidth;              // restart the animations if already running
    view.classList.add('enter');
    clearTimeout(enterTimers.get(view));
    enterTimers.set(view, setTimeout(() => view.classList.remove('enter'), 1600));
  }

  function syncChips() {
    document.querySelectorAll('.chips').forEach((group) => {
      const input = document.getElementById(group.dataset.for);
      group.querySelectorAll('.chip').forEach((chip) => {
        chip.setAttribute('aria-pressed', String(chip.dataset.value === input.value));
      });
    });
  }

  /** Validates durations, updates the error + start button. Returns true if OK. */
  function validate() {
    const s = readForm();
    const focusOk = validMinutes(s.focus, LIMITS.focus);
    const breakOk = validMinutes(s.break, LIMITS.break);
    focusInput.setAttribute('aria-invalid', String(!focusOk));
    breakInput.setAttribute('aria-invalid', String(!breakOk));

    const msgs = [];
    if (!focusOk) msgs.push(`Focus must be a whole number from ${LIMITS.focus[0]} to ${LIMITS.focus[1]} minutes.`);
    if (!breakOk) msgs.push(`Break must be a whole number from ${LIMITS.break[0]} to ${LIMITS.break[1]} minutes.`);
    durationError.textContent = msgs.join(' ');
    durationError.hidden = msgs.length === 0;

    const ok = focusOk && breakOk;
    startBtn.disabled = !ok;
    startBtn.textContent = focusOk ? `Start focus · ${s.focus} min` : 'Start focus';
    return ok;
  }

  function onSettingsChange(e) {
    syncChips();
    const ok = validate();
    const s = readForm();
    // reveal the new theme from the preview the user picked
    const picked = e && e.target.name === 'theme' && e.target.closest('.option');
    const box = picked && picked.querySelector('.preview').getBoundingClientRect();
    applyTheme(s.theme, box && { x: box.left + box.width / 2, y: box.top + box.height / 2 });
    if (ok) saveSettings(s);
  }

  function initSetup() {
    const s = loadSettings();
    focusInput.value = s.focus;
    breakInput.value = s.break;
    form.elements.theme.value = s.theme;
    form.elements.style.value = s.style;

    document.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const input = document.getElementById(chip.closest('.chips').dataset.for);
        input.value = chip.dataset.value;
        onSettingsChange();
      });
    });
    form.addEventListener('input', onSettingsChange);
    form.addEventListener('change', onSettingsChange);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!validate()) {
        (focusInput.getAttribute('aria-invalid') === 'true' ? focusInput : breakInput).focus();
        return;
      }
      startSession(readForm());
    });

    onSettingsChange();
    playEntrance(setupView);
  }

  /* ---------------------------------------------------------
     Timer — wall-clock based (endAt), so it never drifts and
     stays correct when the tab is throttled in the background.
     --------------------------------------------------------- */
  const timer = {
    settings: null,
    phase: 'focus',      // 'focus' | 'break'
    session: 1,
    durationMs: 0,
    remainingMs: 0,
    endAt: 0,
    running: false,
    done: false,
    interval: 0,
  };

  function startSession(settings) {
    timer.settings = settings;
    timer.session = 1;
    stage.dataset.style = settings.style;

    unlockAudio();
    setupView.hidden = true;
    timerView.hidden = false;
    playEntrance(timerView);
    enterFullscreen();
    startPhase('focus');
    wakeControls();
  }

  function startPhase(phase) {
    timer.phase = phase;
    timer.durationMs = timer.settings[phase] * 60 * 1000;
    timer.remainingMs = timer.durationMs;
    timer.done = false;
    resume();
    announce(phase === 'focus' ? `Focus session ${timer.session} started.` : 'Break started.');
  }

  function resume() {
    if (timer.done) return;
    timer.endAt = Date.now() + timer.remainingMs;
    timer.running = true;
    clearInterval(timer.interval);
    timer.interval = setInterval(tick, 200);
    requestWakeLock();
    Falling.setPaused(false);
    render();
  }

  function pause() {
    if (!timer.running) return;
    timer.remainingMs = Math.max(0, timer.endAt - Date.now());
    timer.running = false;
    clearInterval(timer.interval);
    releaseWakeLock();
    Falling.setPaused(true);
    render();
    announce('Paused.');
  }

  function togglePause() {
    if (timer.done) return;
    timer.running ? pause() : resume();
    wakeControls();
  }

  function restart() {
    if (timer.done) return;
    startPhase(timer.phase);
    wakeControls();
  }

  function tick() {
    if (!timer.running) return;
    timer.remainingMs = Math.max(0, timer.endAt - Date.now());
    if (timer.remainingMs === 0) complete();
    else render();
  }

  function complete() {
    timer.running = false;
    timer.done = true;
    clearInterval(timer.interval);
    releaseWakeLock();
    chime();
    render();
    const r = clockEl.getBoundingClientRect();
    Falling.celebrate(r.left + r.width / 2, r.top + r.height / 2);
    announce(timer.phase === 'focus' ? 'Focus session complete. Time for a break.' : 'Break is over.');
    nextBtn.focus({ preventScroll: true });
  }

  function next() {
    if (timer.phase === 'focus') {
      startPhase('break');
    } else {
      timer.session += 1;
      startPhase('focus');
    }
    wakeControls();
  }

  function endSession() {
    timer.running = false;
    timer.done = false;
    clearInterval(timer.interval);
    releaseWakeLock();
    Falling.setPaused(false);
    exitFullscreen();
    timerView.hidden = true;
    timerView.classList.remove('is-idle', 'is-paused', 'is-done');
    setupView.hidden = false;
    playEntrance(setupView);
    document.title = 'Pomodoro Timer';
    startBtn.focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------
     Rendering
     --------------------------------------------------------- */
  const pad = (n) => String(n).padStart(2, '0');
  let lastClockText = '';

  function formatClock(ms) {
    const totalSec = Math.ceil(ms / 1000);
    return `${pad(Math.floor(totalSec / 60))}:${pad(totalSec % 60)}`;
  }

  function spokenTime(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    const parts = [];
    if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
    if (s || !m) parts.push(`${s} second${s === 1 ? '' : 's'}`);
    return `${parts.join(' ')} remaining`;
  }

  const clockTime = (date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  /* The clock is a row of fixed-width cells, each holding one glyph.
     In Falling Colors a changed digit falls out and the new one drops in;
     in Grayscale it rolls up through a blur. (Keyframes live in the CSS.) */
  let clockCells = [];

  function setGlyph(cell, ch, animate) {
    const current = cell.querySelector('.g:not(.g-out)');
    if (current && current.textContent === ch) return;
    cell.querySelectorAll('.g-out').forEach((el) => el.remove());

    const glyph = document.createElement('span');
    glyph.className = 'g';
    glyph.textContent = ch;
    if (current && animate) {
      current.className = 'g g-out';
      current.style.setProperty('--tilt', `${(Math.random() * 24 - 12).toFixed(1)}deg`);
      current.addEventListener('animationend', () => current.remove(), { once: true });
      glyph.classList.add('g-in');
    } else if (current) {
      current.remove();
    }
    cell.append(glyph);
  }

  function renderClock(text) {
    if (clockCells.length !== text.length) {
      clockCells = [...text].map((ch) => {
        const cell = document.createElement('span');
        cell.className = ch === ':' ? 'c' : 'd';
        cell.setAttribute('aria-hidden', 'true');
        return cell;
      });
      clockEl.replaceChildren(...clockCells);
      clockEl.classList.toggle('is-long', text.length > 5);
    }
    // LCD digits just switch segments, whatever the theme
    const animate = DIGIT_MOTION.includes(root.dataset.theme) && stage.dataset.style !== 'bar' && !reduceMotion.matches;
    [...text].forEach((ch, i) => setGlyph(clockCells[i], ch, animate));
  }

  function render() {
    const text = formatClock(timer.remainingMs);
    if (text !== lastClockText) {
      lastClockText = text;
      renderClock(text);
      clockEl.setAttribute('aria-label', spokenTime(timer.remainingMs));
    }

    const frac = timer.durationMs ? timer.remainingMs / timer.durationMs : 0;
    ringEl.style.strokeDashoffset = String(100 - frac * 100);
    ringEl.style.opacity = frac > 0.001 ? '' : '0';   // a round cap would leave a dot at 0
    // the LCD bar drops one whole segment at a time
    barEl.style.transform = `scaleX(${Math.ceil(frac * BAR_SEGMENTS) / BAR_SEGMENTS})`;

    const isFocus = timer.phase === 'focus';
    const label = isFocus ? 'Focus' : 'Break';

    if (timer.done) {
      phaseEl.textContent = isFocus ? 'Focus complete' : 'Break over';
      metaEl.textContent = isFocus
        ? `Nice work — session ${timer.session} done.`
        : `Ready for session ${timer.session + 1}?`;
      nextBtn.textContent = isFocus
        ? `Start break · ${timer.settings.break} min`
        : `Start focus · ${timer.settings.focus} min`;
      document.title = `✓ ${phaseEl.textContent} · Pomodoro`;
    } else {
      phaseEl.textContent = isFocus ? `Focus · Session ${timer.session}` : 'Break';
      metaEl.textContent = timer.running
        ? `Ends at ${clockTime(new Date(timer.endAt))}`
        : 'Paused';
      document.title = `${text} · ${label}`;
    }

    timerView.classList.toggle('is-paused', !timer.running && !timer.done);
    timerView.classList.toggle('is-done', timer.done);
    controls.hidden = timer.done;
    doneActions.hidden = !timer.done;

    pauseBtn.setAttribute('aria-label', timer.running ? 'Pause' : 'Resume');
    pauseBtn.title = timer.running ? 'Pause (Space)' : 'Resume (Space)';
  }

  function announce(msg) {
    announcer.textContent = '';
    // next frame so repeated messages are re-announced
    requestAnimationFrame(() => { announcer.textContent = msg; });
  }

  /* ---------------------------------------------------------
     Controls auto-hide while running
     --------------------------------------------------------- */
  let idleTimer = 0;
  function wakeControls() {
    timerView.classList.remove('is-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (timer.running) timerView.classList.add('is-idle');
    }, 2500);
  }

  /* ---------------------------------------------------------
     Fullscreen
     --------------------------------------------------------- */
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;

  function enterFullscreen() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req || fsElement()) return;
    try {
      const p = req.call(el);
      if (p && p.catch) p.catch(() => { /* not allowed — page view still fills the window */ });
    } catch (_) { /* ignore */ }
  }

  function exitFullscreen() {
    if (!fsElement()) return;
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    try {
      const p = exit.call(document);
      if (p && p.catch) p.catch(() => {});
    } catch (_) { /* ignore */ }
  }

  function toggleFullscreen() {
    fsElement() ? exitFullscreen() : enterFullscreen();
    wakeControls();
  }

  function syncFullscreenButton() {
    const on = Boolean(fsElement());
    fsBtn.setAttribute('aria-pressed', String(on));
    fsBtn.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Enter fullscreen');
  }
  if (!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen)) {
    fsBtn.hidden = true;  // e.g. iPhone Safari
  }

  /* ---------------------------------------------------------
     Sound — a short three-note chime, no audio files needed
     --------------------------------------------------------- */
  let audioCtx = null;
  function unlockAudio() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (_) { audioCtx = null; }
  }

  function chime() {
    if (!audioCtx) return;
    try {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const t0 = audioCtx.currentTime + 0.05;
      [[880, 0], [1108.73, 0.18], [1318.51, 0.36], [1760, 0.54]].forEach(([freq, at]) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0 + at);
        gain.gain.exponentialRampToValueAtTime(0.22, t0 + at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 1.4);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t0 + at);
        osc.stop(t0 + at + 1.5);
      });
    } catch (_) { /* ignore */ }
  }

  /* ---------------------------------------------------------
     Keep the screen awake while counting down
     --------------------------------------------------------- */
  let wakeLock = null;
  async function requestWakeLock() {
    if (!('wakeLock' in navigator) || wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (_) { wakeLock = null; }
  }
  function releaseWakeLock() {
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
  }

  /* ---------------------------------------------------------
     Falling Colors — canvas particles with depth: nearer shapes
     are bigger, brighter and fall faster. The pointer gently
     pushes them aside; taps and finished sessions throw "sparks"
     (short-lived confetti with gravity).
     --------------------------------------------------------- */
  const Falling = (() => {
    const canvas = $('#falling');
    const ctx = canvas.getContext('2d');
    const COLORS = ['#FF6B6B', '#FFB84D', '#FFE066', '#6BCB77', '#4D96FF', '#9B7BFF', '#FF7AC6'];
    const REPEL_R = 140;
    const GRAVITY = 560;
    const MAX_SPARKS = 320;

    let particles = [];   // the endless rain
    let sparks = [];      // bursts that fall away and disappear
    let w = 0, h = 0;
    let raf = 0, last = 0;
    let active = false;
    let speed = 1, targetSpeed = 1, boostUntil = 0;
    const pointer = { x: 0, y: 0, on: false };

    const pick = (list) => list[(Math.random() * list.length) | 0];
    const randomShape = () => {
      const r = Math.random();
      return r < 0.45 ? 'circle' : r < 0.8 ? 'petal' : 'square';
    };

    function spawn(anywhere) {
      const z = Math.random();                       // 0 = far, 1 = near
      const size = 5 + z * z * 30;
      return {
        x: Math.random() * w,
        y: anywhere ? Math.random() * h : -size * 2,
        z,
        size,
        color: pick(COLORS),
        alpha: 0.25 + z * 0.6,
        vy: 14 + z * 70,
        vx: 0,                                       // extra velocity from the pointer
        ey: 0,
        sway: 6 + Math.random() * 26,
        phase: Math.random() * Math.PI * 2,
        freq: 0.3 + Math.random() * 0.8,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 1.6,
        shape: randomShape(),
      };
    }

    function burst(x, y, count, power) {
      if (!active || reduceMotion.matches) return;
      for (let i = 0; i < count && sparks.length < MAX_SPARKS; i++) {
        const angle = Math.random() * Math.PI * 2;
        const v = power * (0.3 + Math.random() * 0.7);
        sparks.push({
          x,
          y,
          vx: Math.cos(angle) * v,
          vy: Math.sin(angle) * v - power * 0.45,    // bias upward, gravity brings them down
          size: 6 + Math.random() * 12,
          color: pick(COLORS),
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 12,
          shape: randomShape(),
          life: 0,
          ttl: 1.8 + Math.random() * 1.4,
        });
      }
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = Math.round(Math.min(150, Math.max(36, (w * h) / 13000)));
      while (particles.length < target) particles.push(spawn(true));
      particles.length = target;
      if (active && reduceMotion.matches) draw(0);
    }

    function shape(p, x, y, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.translate(x, y);
      ctx.rotate(p.rot);
      ctx.beginPath();
      const s = p.size;
      if (p.shape === 'circle') {
        ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
      } else if (p.shape === 'petal') {
        ctx.ellipse(0, 0, s / 2, s / 4, 0, 0, Math.PI * 2);
      } else if (ctx.roundRect) {
        ctx.roundRect(-s / 2.4, -s / 2.4, s / 1.2, s / 1.2, s / 6);
      } else {
        ctx.rect(-s / 2.4, -s / 2.4, s / 1.2, s / 1.2);
      }
      ctx.fill();
      ctx.restore();
    }

    function stepRain(p, dt) {
      const k = dt * speed;
      p.y += p.vy * k;
      p.phase += p.freq * k;
      p.rot += p.vr * k;

      // push shapes out of the pointer's way — nearer (bigger) ones react more
      if (pointer.on) {
        const dx = p.x + Math.sin(p.phase) * p.sway - pointer.x;
        const dy = p.y - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < REPEL_R * REPEL_R && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const f = (1 - d / REPEL_R) * 1500 * (0.4 + p.z) * dt;
          p.vx += (dx / d) * f;
          p.ey += (dy / d) * f;
        }
      }
      const damp = Math.exp(-dt * 2.4);
      p.vx *= damp;
      p.ey *= damp;
      p.x += p.vx * dt;
      p.y += p.ey * dt;

      if (p.x < -40) p.x += w + 80;
      else if (p.x > w + 40) p.x -= w + 80;
      if (p.y - p.size > h || p.y < -h * 0.5) Object.assign(p, spawn(false));
    }

    function stepSpark(s, dt) {
      const drag = Math.exp(-dt * 1.8);
      s.vx *= drag;
      s.vy = s.vy * drag + GRAVITY * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.rot += s.vr * dt;
      s.life += dt;
    }

    function draw(dt) {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        if (dt) stepRain(p, dt);
        shape(p, p.x + Math.sin(p.phase) * p.sway, p.y, p.alpha);
      }
      if (sparks.length) {
        sparks = sparks.filter((s) => s.life < s.ttl && s.y < h + 40);
        for (const s of sparks) {
          stepSpark(s, dt);
          shape(s, s.x, s.y, 0.95 * Math.min(1, (s.ttl - s.life) / 0.6));   // fade out at the end
        }
      }
    }

    function frame(t) {
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 0;
      last = t;
      const goal = t < boostUntil ? 3 : targetSpeed;
      speed += (goal - speed) * Math.min(1, dt * 2.5);
      draw(dt);
      raf = requestAnimationFrame(frame);
    }

    function start() {
      cancelAnimationFrame(raf);
      last = 0;
      if (reduceMotion.matches) { draw(0); return; }
      raf = requestAnimationFrame(frame);
    }

    window.addEventListener('resize', () => { if (active) resize(); });
    reduceMotion.addEventListener?.('change', () => { if (active) start(); });

    window.addEventListener('pointermove', (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.on = true;
    }, { passive: true });
    root.addEventListener('pointerleave', () => { pointer.on = false; });
    ['pointerup', 'pointercancel'].forEach((type) => {
      window.addEventListener(type, (e) => { if (e.pointerType !== 'mouse') pointer.on = false; });
    });

    // tap/click on empty space → a little splash of color
    window.addEventListener('pointerdown', (e) => {
      if (!(e.target instanceof Element) || e.target.closest('button, input, label, a, .card')) return;
      burst(e.clientX, e.clientY, 18, 420);
    });

    return {
      setActive(on) {
        if (on === active) return;
        active = on;
        sparks = [];
        if (on) { resize(); start(); }
        else { cancelAnimationFrame(raf); ctx.clearRect(0, 0, w, h); }
      },
      setPaused(paused) { targetSpeed = paused ? 0.08 : 1; },
      celebrate(x = w / 2, y = h / 2) {
        boostUntil = performance.now() + 1800;
        burst(x, y, 90, 780);
        setTimeout(() => burst(x, y, 50, 520), 260);
      },
    };
  })();

  /* ---------------------------------------------------------
     Events
     --------------------------------------------------------- */
  pauseBtn.addEventListener('click', togglePause);
  $('#restart-btn').addEventListener('click', restart);
  $('#end-btn').addEventListener('click', endSession);
  $('#back-btn').addEventListener('click', endSession);
  fsBtn.addEventListener('click', toggleFullscreen);
  nextBtn.addEventListener('click', next);

  ['mousemove', 'mousedown', 'touchstart'].forEach((type) => {
    timerView.addEventListener(type, wakeControls, { passive: true });
  });

  document.addEventListener('keydown', (e) => {
    if (timerView.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    const onButton = e.target instanceof HTMLButtonElement;
    wakeControls();

    switch (e.key) {
      case ' ':
      case 'k':
      case 'K':
        if (onButton) return;          // the focused button handles Space itself
        e.preventDefault();
        togglePause();
        break;
      case 'r':
      case 'R':
        restart();
        break;
      case 'f':
      case 'F':
        toggleFullscreen();
        break;
      case 'Enter':
        if (timer.done && !onButton) { e.preventDefault(); next(); }
        break;
      case 'Escape':
        // In browser fullscreen, the browser consumes Esc to leave fullscreen first.
        if (!fsElement()) endSession();
        break;
      default:
    }
  });

  document.addEventListener('fullscreenchange', syncFullscreenButton);
  document.addEventListener('webkitfullscreenchange', syncFullscreenButton);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || timerView.hidden) return;
    if (timer.running) requestWakeLock();
    tick();
  });

  initSetup();
})();
