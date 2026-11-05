/* Бесконечный «виртуальный» барабан: 5 DOM-ячеек, позиция — дробный индекс */
(function () {
  const mod = (a, n) => ((a % n) + n) % n;
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  const easeOutBack = t => { const s = 0.9; t -= 1; return t * t * ((s + 1) * t + s) + 1; };

  class Reel {
    constructor(el, items, opts) {
      this.el = el;
      this.items = items;
      this.opts = opts || {};
      this.pos = 0;
      this.anim = null;
      this.lastTick = 0;
      this.nodes = [];
      for (let k = 0; k < 5; k++) {
        const n = document.createElement('div');
        n.className = 'cell';
        n.innerHTML = '<div class="cell-inner"></div>';
        n._idx = null;
        el.appendChild(n);
        this.nodes.push(n);
      }
      const frame = document.createElement('div');
      frame.className = 'frame';
      el.appendChild(frame);
      this.bindDrag();
      this.render();
    }

    get H() { return this.el.clientHeight / 3 || 120; }
    get n() { return this.items.length; }

    itemAt(i) { return this.items[mod(i, this.n)]; }
    current() { return this.itemAt(Math.round(this.pos)); }
    currentIndex() { return mod(Math.round(this.pos), this.n); }

    setItems(items, keepId) {
      this.items = items;
      let idx = keepId ? items.findIndex(i => i.id === keepId) : -1;
      if (idx < 0) idx = 0;
      this.pos = idx;
      this.lastTick = Math.round(this.pos);
      this.nodes.forEach(n => (n._idx = null));
      this.render();
    }

    fill(node, item) {
      const visual = item.img
        ? `<img class="cell-img" src="${item.img}" alt="">`
        : `<div class="cell-emoji">${item.emoji || '🍽️'}</div>`;
      node.firstChild.innerHTML = `${visual}<div class="cell-name">${esc(item.name)}</div>`;
    }

    render() {
      const H = this.H;
      const base = Math.floor(this.pos);
      for (let k = 0; k < 5; k++) {
        const idx = base - 1 + k;
        const node = this.nodes[k];
        if (node._idx !== idx) { this.fill(node, this.itemAt(idx)); node._idx = idx; }
        const y = (idx - this.pos + 1) * H;
        node.style.transform = `translate3d(0,${y}px,0)`;
      }
      const r = Math.round(this.pos);
      if (r !== this.lastTick) {
        this.lastTick = r;
        this.opts.onTick && this.opts.onTick();
      }
    }

    stop() {
      if (this.anim) { cancelAnimationFrame(this.anim.raf); const res = this.anim.resolve; this.anim = null; res && res(false); }
    }

    animateTo(target, duration, ease) {
      this.stop();
      return new Promise(resolve => {
        const from = this.pos;
        const t0 = performance.now();
        const a = { resolve, target };
        this.anim = a;
        const frame = now => {
          if (this.anim !== a) return;
          const t = Math.min(1, (now - t0) / duration);
          this.pos = from + (target - from) * (ease || easeOutCubic)(t);
          this.render();
          if (t < 1) a.raf = requestAnimationFrame(frame);
          else { this.pos = target; this.render(); this.anim = null; resolve(true); }
        };
        a.raf = requestAnimationFrame(frame);
      });
    }

    /* Крутануть до элемента targetIdx, пролетев минимум minCells ячеек */
    spinTo(targetIdx, minCells, duration) {
      const n = this.n;
      const start = Math.round(this.pos);
      let target = start + minCells;
      target += mod(targetIdx - mod(target, n), n);
      return this.animateTo(target, duration, easeOutBack);
    }

    step(dir) {
      if (this.opts.isBusy && this.opts.isBusy()) return;
      const target = Math.round(this.anim ? this.anim.target : this.pos) + dir;
      this.animateTo(target, 220).then(done => done && this.opts.onSettle && this.opts.onSettle());
    }

    bindDrag() {
      const el = this.el;
      let startY = 0, startPos = 0, lastY = 0, lastT = 0, vel = 0, dragging = false, moved = false;
      el.addEventListener('pointerdown', e => {
        if (this.opts.isBusy && this.opts.isBusy()) return;
        this.stop();
        dragging = true; moved = false;
        startY = lastY = e.clientY; startPos = this.pos; lastT = performance.now(); vel = 0;
        el.setPointerCapture(e.pointerId);
      });
      el.addEventListener('pointermove', e => {
        if (!dragging) return;
        const dy = e.clientY - startY;
        if (Math.abs(dy) > 4) moved = true;
        const now = performance.now();
        const dt = Math.max(1, now - lastT);
        vel = 0.8 * vel + 0.2 * ((e.clientY - lastY) / dt); // px/ms
        lastY = e.clientY; lastT = now;
        this.pos = startPos - dy / this.H;
        this.render();
      });
      const end = e => {
        if (!dragging) return;
        dragging = false;
        if (!moved) {
          // тап по верхней/нижней ячейке — шаг
          const rect = el.getBoundingClientRect();
          const y = e.clientY - rect.top;
          if (y < this.H) this.step(-1);
          else if (y > this.H * 2) this.step(1);
          else this.opts.onTapCenter && this.opts.onTapCenter();
          return;
        }
        const fling = -vel * 260 / this.H; // инерция
        const target = Math.round(this.pos + Math.max(-12, Math.min(12, fling)));
        const dist = Math.abs(target - this.pos);
        this.animateTo(target, Math.min(1200, 220 + dist * 70)).then(done => done && this.opts.onSettle && this.opts.onSettle());
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  window.esc = esc;
  window.Reel = Reel;
})();
