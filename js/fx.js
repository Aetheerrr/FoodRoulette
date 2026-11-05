/* Эффекты: Telegram-обёртка, вибро, звук, конфетти, встряска */
(function () {
  const tg = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData !== undefined
    ? window.Telegram.WebApp : null;
  const inTelegram = !!(tg && tg.platform && tg.platform !== 'unknown');
  const vOk = v => tg && tg.isVersionAtLeast && tg.isVersionAtLeast(v);

  const FX = { tg, inTelegram, vOk };

  /* ---------- Вибро ---------- */
  FX.haptic = function (kind) {
    if (!Store.state.settings.haptics) return;
    try {
      if (inTelegram && vOk('6.1')) {
        const h = tg.HapticFeedback;
        if (kind === 'tick') h.selectionChanged();
        else if (kind === 'success' || kind === 'error' || kind === 'warning') h.notificationOccurred(kind);
        else h.impactOccurred(kind || 'light'); // light | medium | heavy | rigid | soft
      } else if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) {
        navigator.vibrate(kind === 'tick' ? 4 : kind === 'success' ? [20, 40, 30] : 12);
      }
    } catch (e) { /* ignore */ }
  };

  /* ---------- Звук (WebAudio, без файлов) ---------- */
  let ctx = null;
  function ac() {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function blip(freq, dur, type, vol, when) {
    const a = ac(); if (!a) return;
    const t = a.currentTime + (when || 0);
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol || 0.04, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  FX.unlockAudio = () => { if (Store.state.settings.sound) ac(); };
  FX.sound = function (kind) {
    if (!Store.state.settings.sound) return;
    try {
      if (kind === 'tick') blip(1400 + Math.random() * 300, 0.025, 'square', 0.025);
      else if (kind === 'stop') blip(320, 0.09, 'triangle', 0.09);
      else if (kind === 'win') [523, 659, 784, 1047].forEach((f, i) => blip(f, 0.16, 'triangle', 0.07, i * 0.09));
      else if (kind === 'jackpot') [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => blip(f, 0.14, 'square', 0.05, i * 0.08));
      else if (kind === 'pop') blip(880, 0.05, 'sine', 0.06);
      else if (kind === 'lever') { blip(140, 0.12, 'sawtooth', 0.06); [0.05, 0.09, 0.13].forEach(t => blip(900, 0.02, 'square', 0.03, t)); blip(90, 0.18, 'triangle', 0.1, 0.18); }
    } catch (e) { /* ignore */ }
  };

  /* ---------- Конфетти ---------- */
  const canvas = document.getElementById('confetti');
  const c2d = canvas.getContext('2d');
  let parts = [];
  let raf = 0;
  const COLORS = ['#27f227', '#ffb020', '#ff5a5f', '#4fc3ff', '#b46bff', '#ffffff'];
  FX.confetti = function (amount) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = amount || 120;
    for (let i = 0; i < n; i++) {
      const fromLeft = i % 2 === 0;
      parts.push({
        x: fromLeft ? -10 : innerWidth + 10,
        y: innerHeight * (0.45 + Math.random() * 0.2),
        vx: (fromLeft ? 1 : -1) * (4 + Math.random() * 8),
        vy: -(8 + Math.random() * 10),
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.4,
        w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
        c: COLORS[(Math.random() * COLORS.length) | 0],
        life: 0,
      });
    }
    if (!raf) raf = requestAnimationFrame(step);
  };
  function step() {
    c2d.clearRect(0, 0, innerWidth, innerHeight);
    parts.forEach(p => {
      p.life++;
      p.vy += 0.35; p.vx *= 0.985; p.vy *= 0.99;
      p.x += p.vx; p.y += p.vy; p.r += p.vr;
      c2d.save();
      c2d.translate(p.x, p.y); c2d.rotate(p.r);
      c2d.fillStyle = p.c;
      c2d.globalAlpha = Math.max(0, 1 - p.life / 160);
      c2d.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.life / 6)));
      c2d.restore();
    });
    parts = parts.filter(p => p.y < innerHeight + 40 && p.life < 160);
    raf = parts.length ? requestAnimationFrame(step) : 0;
    if (!raf) c2d.clearRect(0, 0, innerWidth, innerHeight);
  }

  /* ---------- Встряска телефона ---------- */
  let shakeCb = null, last = null, lastFire = 0, shakeStarted = false, tgListener = false;
  function onAccel(x, y, z) {
    if (last) {
      const d = Math.abs(x - last.x) + Math.abs(y - last.y) + Math.abs(z - last.z);
      const now = Date.now();
      if (d > 28 && now - lastFire > 1800) { lastFire = now; shakeCb && shakeCb(); }
    }
    last = { x, y, z };
  }
  FX.onShake = function (cb) {
    shakeCb = cb;
    FX.setShake(Store.state.settings.shake);
  };
  FX.setShake = function (on) {
    if (inTelegram && vOk('8.0') && tg.Accelerometer) {
      if (on && !shakeStarted) {
        if (!tgListener) {
          tgListener = true;
          tg.onEvent('accelerometerChanged', () => {
            const a = tg.Accelerometer; onAccel(a.x, a.y, a.z);
          });
        }
        last = null;
        tg.Accelerometer.start({ refresh_rate: 60 }, ok => { shakeStarted = !!ok; });
        shakeStarted = true;
      } else if (!on && shakeStarted) {
        tg.Accelerometer.stop(); shakeStarted = false;
      }
      return;
    }
    // Фолбэк для обычного браузера
    if (on && !shakeStarted) {
      window.addEventListener('devicemotion', motion);
      shakeStarted = true;
    } else if (!on && shakeStarted) {
      window.removeEventListener('devicemotion', motion);
      shakeStarted = false;
    }
  };
  function motion(e) {
    const a = e.accelerationIncludingGravity;
    if (a && a.x != null) onAccel(a.x, a.y, a.z);
  }
  // iOS Safari вне Telegram просит разрешение на датчики
  FX.requestMotionPermission = function () {
    if (!inTelegram && window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function') {
      DeviceMotionEvent.requestPermission().catch(() => {});
    }
  };

  /* ---------- Ссылки / шаринг ---------- */
  FX.openLink = function (url) {
    if (inTelegram) tg.openLink(url); else window.open(url, '_blank');
  };
  FX.share = function (text) {
    const url = (window.APP_CONFIG && APP_CONFIG.botUrl) || location.href.split('#')[0];
    const share = 'https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(text);
    if (inTelegram) tg.openTelegramLink(share);
    else if (navigator.share) navigator.share({ text, url }).catch(() => {});
    else window.open(share, '_blank');
  };

  window.FX = FX;
})();
