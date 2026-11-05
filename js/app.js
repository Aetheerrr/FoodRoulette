/* ==== Рулетка еды — Telegram Mini App ==== */
window.APP_CONFIG = {
  // Ссылка на бота/мини-апп для кнопки «Поделиться», например 'https://t.me/my_food_roulette_bot/app'
  botUrl: '',
  version: '1.0',
};

(function () {
  const S = () => Store.state;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const rnd = arr => arr[(Math.random() * arr.length) | 0];
  const DAY = 86400000;

  let reels = [];           // [{ col, reel, el }]
  const locked = new Set(); // id колонок, которые не крутятся
  let busy = false;
  let currentScreen = 'roulette';
  let editingColId = null;
  let lastResult = null;

  /* ================= Telegram ================= */
  const tg = FX.tg;
  if (FX.inTelegram) {
    tg.ready();
    tg.expand();
    if (FX.vOk('7.7')) tg.disableVerticalSwipes(); // чтобы свайп по барабану не сворачивал приложение
    tg.onEvent('themeChanged', applyTheme);
    tg.BackButton.onClick(goBack);
  }

  /* ================= Тема ================= */
  function applyTheme() {
    const pref = S().settings.theme;
    let theme = pref;
    if (pref === 'auto') {
      if (FX.inTelegram && tg.colorScheme) theme = tg.colorScheme;
      else theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.skin = S().settings.skin || 'slot';
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (FX.inTelegram && FX.vOk('6.1')) {
      try {
        tg.setHeaderColor(bg);
        tg.setBackgroundColor(bg);
        if (FX.vOk('7.10')) tg.setBottomBarColor(bg);
      } catch (e) { /* ignore */ }
    }
  }
  $('#btn-theme').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    S().settings.theme = cur === 'dark' ? 'light' : 'dark';
    Store.save();
    applyTheme();
    FX.haptic('light');
  });

  /* ================= Навигация ================= */
  function showScreen(name) {
    currentScreen = name;
    $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
    $$('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.screen === name));
    document.body.classList.toggle('editing', name === 'editor');
    if (name === 'roulette') buildMachine();
    if (name === 'dishes') renderDishes();
    if (name === 'settings') renderSettings();
    if (FX.inTelegram) name === 'editor' ? tg.BackButton.show() : tg.BackButton.hide();
    window.scrollTo(0, 0);
  }
  function goBack() {
    if (sheetOpen()) return closeSheet();
    if (currentScreen === 'editor') showScreen('settings');
  }
  $$('#tabbar button').forEach(b => b.addEventListener('click', () => {
    FX.haptic('light');
    showScreen(b.dataset.screen);
  }));

  /* ================= Барабаны ================= */
  function buildMachine() {
    reels.forEach(r => r.reel.stop());
    const machine = $('#machine');
    machine.innerHTML = '';
    const cols = Store.activeColumns();
    machine.classList.toggle('cols-4', cols.length >= 4);
    reels = [];
    const holds = $('#holds');
    holds.innerHTML = '';
    updateLed();

    if (!cols.length) {
      machine.innerHTML = `<div class="empty" style="grid-column:1/-1"><span class="big">🫙</span>Нет ни одной включённой колонки.<br>Загляни в настройки ⚙️</div>`;
      return;
    }

    cols.forEach(col => {
      const el = document.createElement('div');
      el.className = 'reel-col' + (locked.has(col.id) ? ' locked' : '');
      el.innerHTML = `
        <div class="reel-head"><span>${esc(col.title)}</span><button class="lock-btn" aria-label="Зафиксировать">${locked.has(col.id) ? '🔒' : '🔓'}</button></div>
        <div class="reel-box">
          <button class="arrow up" aria-label="Вверх">⌃</button>
          <div class="reel"></div>
          <button class="arrow down" aria-label="Вниз" style="transform:rotate(180deg)">⌃</button>
        </div>`;
      machine.appendChild(el);

      const items = col.items.filter(i => i.enabled);
      const entry = { col, el };
      const reel = new Reel($('.reel', el), items, {
        onTick: () => tick(),
        isBusy: () => busy,
        onSettle: () => savePosition(entry),
        onTapCenter: () => spinOne(entry),
      });
      reel.setItems(items, S().positions[col.id]);
      entry.reel = reel;
      reels.push(entry);

      $('.up', el).addEventListener('click', () => reel.step(-1));
      $('.down', el).addEventListener('click', () => reel.step(1));
      $('.lock-btn', el).addEventListener('click', () => toggleLock(entry));

      // Кнопка «Держать» на пульте автомата
      const hold = document.createElement('button');
      hold.className = 'hold' + (locked.has(col.id) ? ' on' : '');
      hold.innerHTML = `<b>${locked.has(col.id) ? '🔒' : '🔓'}</b>Держать`;
      hold.title = col.title;
      hold.addEventListener('click', () => toggleLock(entry));
      holds.appendChild(hold);
      entry.hold = hold;
    });
    // высота ячеек известна только после вставки в DOM
    requestAnimationFrame(() => reels.forEach(r => { r.reel.nodes.forEach(n => (n._idx = null)); r.reel.render(); }));
    updateHint();
  }

  function savePosition(entry) {
    S().positions[entry.col.id] = entry.reel.current().id;
    Store.save();
  }

  function toggleLock(entry) {
    if (busy) return;
    const id = entry.col.id;
    if (locked.has(id)) locked.delete(id); else locked.add(id);
    entry.el.classList.toggle('locked', locked.has(id));
    $('.lock-btn', entry.el).textContent = locked.has(id) ? '🔒' : '🔓';
    if (entry.hold) {
      entry.hold.classList.toggle('on', locked.has(id));
      entry.hold.querySelector('b').textContent = locked.has(id) ? '🔒' : '🔓';
    }
    FX.haptic(locked.has(id) ? 'rigid' : 'soft');
    toast(locked.has(id) ? `«${entry.col.title}» зафиксирована 🔒` : `«${entry.col.title}» снова крутится`);
    FX.sound('pop');
  }

  let lastTickAt = 0;
  function tick() {
    const now = performance.now();
    if (now - lastTickAt < 45) return;
    lastTickAt = now;
    FX.haptic('tick');
    FX.sound('tick');
  }

  function weightedPick(items) {
    const total = items.reduce((s, i) => s + (i.weight || 1), 0);
    let r = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
      r -= items[i].weight || 1;
      if (r <= 0) return i;
    }
    return items.length - 1;
  }

  const comboKey = picks => picks.map(p => p.name.toLowerCase()).join('|');

  function recentCombos() {
    const days = S().settings.noRepeatDays;
    if (!days) return new Set();
    const since = Date.now() - days * DAY;
    return new Set(S().history.filter(h => h.ts >= since).map(h => comboKey(h.picks)));
  }

  /* Выбираем цели для всех барабанов с учётом фиксации и «не повторять» */
  function chooseTargets() {
    const avoid = recentCombos();
    const sane = S().settings.sanity;
    let fallback = null;
    for (let attempt = 0; attempt < 60; attempt++) {
      const targets = sane ? sensibleTargets() : reels.map(r => locked.has(r.col.id) ? r.reel.currentIndex() : weightedPick(r.reel.items));
      if (!targets) continue; // в этот раз не сложилось — пробуем ещё
      const picks = reels.map((r, i) => r.reel.items[targets[i]]);
      if (!avoid.has(comboKey(picks))) return targets;
      fallback = fallback || targets; // нормальное, но недавно готовили
    }
    if (fallback) return fallback;
    // Нормального сочетания нет (например, зафиксировано что-то несочетаемое) — крутим как есть
    toast('С зафиксированным ничего толком не сочетается 🤷 Крутим наугад');
    return reels.map(r => locked.has(r.col.id) ? r.reel.currentIndex() : weightedPick(r.reel.items));
  }

  /* Выбор по очереди: каждая следующая колонка выбирает только из того, что сочетается с уже выбранным */
  function sensibleTargets() {
    const targets = new Array(reels.length);
    const chosen = [];
    reels.forEach((r, i) => {
      if (locked.has(r.col.id)) { targets[i] = r.reel.currentIndex(); chosen.push(r.reel.items[targets[i]]); }
    });
    const order = reels.map((_, i) => i).filter(i => targets[i] === undefined).sort(() => Math.random() - 0.5);
    for (const i of order) {
      const items = reels[i].reel.items;
      const ok = items.map((it, idx) => idx).filter(idx => chosen.every(c => Store.compatible(c, items[idx])));
      if (!ok.length) return null;
      const pick = ok[weightedPick(ok.map(idx => items[idx]))];
      targets[i] = pick;
      chosen.push(items[pick]);
    }
    return targets;
  }

  async function spin() {
    if (busy || !reels.length) return;
    FX.unlockAudio();
    FX.requestMotionPermission();
    if (reels.every(r => locked.has(r.col.id))) {
      toast('Все колонки зафиксированы 🔒');
      FX.haptic('warning');
      return;
    }
    busy = true;
    setSpinning(true);
    FX.haptic('heavy');
    reels.forEach(r => r.el.classList.remove('win'));

    const targets = chooseTargets();
    let order = 0;
    await Promise.all(reels.map((r, i) => {
      if (locked.has(r.col.id)) return Promise.resolve();
      const k = order++;
      return r.reel.spinTo(targets[i], 14 + k * 6 + ((Math.random() * 4) | 0), 1500 + k * 520).then(() => {
        r.el.classList.add('win');
        FX.haptic('medium');
        FX.sound('stop');
      });
    }));

    reels.forEach(r => (S().positions[r.col.id] = r.reel.current().id));
    S().stats.spins++;
    Store.save();
    busy = false;
    setSpinning(false);
    updateLed();
    updateHint();
    setTimeout(showResult, 250);
  }

  async function spinOne(entry) {
    if (busy || locked.has(entry.col.id)) return;
    busy = true;
    FX.unlockAudio();
    entry.el.classList.remove('win');
    const items = entry.reel.items;
    const others = reels.filter(r => r !== entry).map(r => r.reel.current());
    let pool = items.map((_, i) => i);
    if (S().settings.sanity) {
      const ok = pool.filter(i => others.every(o => Store.compatible(o, items[i])));
      if (ok.length) pool = ok;
      else toast('С остальными колонками тут ничего не сочетается 🤷');
    }
    if (pool.length > 1) pool = pool.filter(i => i !== entry.reel.currentIndex()); // чтобы точно что-то поменялось
    const idx = pool[weightedPick(pool.map(i => items[i]))];
    await entry.reel.spinTo(idx, 10 + ((Math.random() * 4) | 0), 1200);
    entry.el.classList.add('win');
    FX.haptic('medium');
    FX.sound('stop');
    savePosition(entry);
    busy = false;
  }

  function currentPicks() {
    return reels.map(r => {
      const it = r.reel.current();
      return { col: r.col.title, colId: r.col.id, name: it.name, emoji: it.emoji, img: it.img || null, weight: it.weight };
    });
  }

  let hintShown = false;
  function updateHint() {
    if (hintShown || S().stats.spins >= 3) return;
    hintShown = true;
    const slot = (S().settings.skin || 'slot') === 'slot';
    setTimeout(() => toast(slot
      ? 'Дёрни рычаг 🎰 или жми КРУТИ. «Держать» оставляет колонку, тап по барабану перекручивает одну. Можно и потрясти телефон 📳'
      : 'Свайпай колонки, тап по центру перекручивает одну, 🔓 фиксирует. А ещё можно потрясти телефон 📳', 5500), 900);
  }

  $('#btn-spin').addEventListener('click', spin);
  $('#btn-spin-slot').addEventListener('click', spin);

  function setSpinning(on) {
    $('#btn-spin').disabled = on;
    $('#btn-spin').textContent = on ? 'Крутим…' : 'Крутить!';
    $('#btn-spin-slot').disabled = on;
  }
  function updateLed() {
    $('#led').textContent = 'ПРОКРУТОК ' + String(S().stats.spins).padStart(4, '0');
  }

  /* Рычаг: потянуть вниз или просто тапнуть */
  (function lever() {
    const el = $('#lever');
    let startY = null, fired = false;
    const pull = () => {
      if (busy || el.classList.contains('pull')) return;
      el.classList.add('pull');
      FX.unlockAudio();
      FX.sound('lever');
      FX.haptic('heavy');
      setTimeout(() => { el.classList.remove('pull'); spin(); }, 230);
    };
    el.addEventListener('pointerdown', e => { startY = e.clientY; fired = false; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', e => {
      if (startY === null || fired) return;
      if (e.clientY - startY > 28) { fired = true; pull(); }
    });
    el.addEventListener('pointerup', () => { if (startY !== null && !fired) pull(); startY = null; });
    el.addEventListener('pointercancel', () => { startY = null; });
  })();
  FX.onShake(() => {
    if (currentScreen === 'roulette' && !sheetOpen() && !busy) spin();
  });

  /* ================= Результат ================= */
  function dishTitle(picks) {
    if (picks.length === 1) return { title: picks[0].name, sub: picks[0].col };
    // «Способ» показываем подписью, остальное — в заголовке
    let mi = picks.findIndex(p => p.colId === 'method');
    if (mi < 0) mi = picks.length - 1;
    const m = picks[mi];
    return {
      title: picks.filter((_, i) => i !== mi).map(p => p.name).join(' + '),
      sub: `${m.col}: ${m.name.toLowerCase()} ${m.emoji || ''}`,
    };
  }
  function visual(p) {
    return p.img ? `<img src="${p.img}" alt="">` : (p.emoji || '🍽️');
  }
  function isFav(picks) {
    const k = comboKey(picks);
    return S().favorites.some(f => comboKey(f.picks) === k);
  }
  function toggleFav(picks) {
    const k = comboKey(picks);
    const i = S().favorites.findIndex(f => comboKey(f.picks) === k);
    if (i >= 0) S().favorites.splice(i, 1);
    else S().favorites.unshift({ id: Store.uid(), ts: Date.now(), picks: picks.map(p => ({ ...p, img: null })) });
    Store.save();
    return i < 0;
  }
  function shareText(picks, extra) {
    const { title, sub } = dishTitle(picks);
    return `🎰 Рулетка решила: сегодня у нас ${picks.map(p => p.emoji).join('')}\n${title} (${sub.toLowerCase()})${extra || ''}`;
  }
  function recipeUrl(picks) {
    return 'https://yandex.ru/search/?text=' + encodeURIComponent(DEFAULTS.recipeQuery(picks));
  }

  function showResult() {
    const picks = currentPicks();
    const set = S().settings;
    const fav = isFav(picks);
    const twist = set.twists ? rnd(DEFAULTS.twists) : null;
    let cook = null, washer = null;
    const names = S().people.names.filter(Boolean);
    if (S().people.enabled && names.length) {
      cook = rnd(names);
      const others = names.filter(n => n !== cook);
      washer = others.length ? rnd(others) : cook;
    }
    lastResult = { picks, twist, cook, washer };

    const { title, sub } = dishTitle(picks);
    const jackpot = fav;
    const weird = !Store.comboOk(reels.map(r => r.reel.current()));
    const quip = jackpot ? '⭐ Это же твоё любимое! Рулетка знает толк.'
      : weird ? (set.sanity ? 'Смелое сочетание… ты точно сам(а) это выкрутил(а)? 🤨' : '🤪 Безумный режим: удачи на кухне!')
      : rnd(DEFAULTS.quips);
    openSheet(`
      <div class="result">
        <div class="big-emojis">${picks.map(p => `<span>${visual(p)}</span>`).join('')}</div>
        <div class="dish">${esc(title)}</div>
        <div class="method">${esc(sub)}</div>
        <div class="quip">${esc(quip)}</div>
        ${twist ? `<div class="twist">Челлендж: ${esc(twist)}</div>` : ''}
        ${cook ? `<div class="duty"><div>👨‍🍳 Готовит<b>${esc(cook)}</b></div><div>🧽 Моет посуду<b>${esc(washer)}</b></div></div>` : ''}
      </div>
      <div class="result-actions">
        <button class="btn" data-act="fav"><span>${fav ? '❤️' : '🤍'}</span>Любимое</button>
        <button class="btn" data-act="recipe"><span>🔎</span>Рецепт</button>
        <button class="btn" data-act="share"><span>📤</span>Поделиться</button>
        <button class="btn" data-act="again"><span>🔄</span>Ещё раз</button>
      </div>
      <button class="btn primary block" data-act="cook" style="height:56px;font-size:17px">Готовлю! ✅</button>
    `);
    if (fav) $('[data-act="fav"]', $('#sheet')).classList.add('on');

    $('#base-neon').textContent = title;
    const cab = $('#cabinet');
    cab.classList.add('jackpot');
    setTimeout(() => cab.classList.remove('jackpot'), jackpot ? 4000 : 1600);
    if (jackpot) { FX.sound('jackpot'); FX.confetti(180); }
    else { FX.sound('win'); FX.confetti(70); }
    FX.haptic('success');

    const body = $('#sheet-body');
    body.onclick = e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'fav') {
        const on = toggleFav(picks);
        b.classList.toggle('on', on);
        b.querySelector('span').textContent = on ? '❤️' : '🤍';
        FX.haptic(on ? 'success' : 'light');
        toast(on ? 'Добавлено в любимые ❤️' : 'Убрано из любимых');
      } else if (act === 'recipe') {
        FX.openLink(recipeUrl(picks));
      } else if (act === 'share') {
        let extra = '';
        if (twist) extra += `\nЧеллендж: ${twist}`;
        if (cook) extra += `\n👨‍🍳 Готовит: ${cook} · 🧽 Моет: ${washer}`;
        FX.share(shareText(picks, extra));
      } else if (act === 'again') {
        closeSheet();
        setTimeout(spin, 300);
      } else if (act === 'cook') {
        S().history.unshift({ id: Store.uid(), ts: Date.now(), picks: picks.map(p => ({ ...p, img: null })), twist, cook, washer });
        S().history = S().history.slice(0, 300);
        Store.save();
        closeSheet();
        updateStreak();
        FX.confetti(160);
        FX.haptic('success');
        const st = streak();
        toast(st > 1 ? `Приятного аппетита! 🔥 Серия: ${st} дн.` : 'Приятного аппетита! 🍽️');
      }
    };
  }

  /* ================= Серия дней ================= */
  function dayKey(ts) { const d = new Date(ts); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
  function streak() {
    const days = new Set(S().history.map(h => dayKey(h.ts)));
    let n = 0;
    let t = Date.now();
    if (!days.has(dayKey(t))) t -= DAY; // серия жива, если вчера готовили
    while (days.has(dayKey(t))) { n++; t -= DAY; }
    return n;
  }
  function updateStreak() {
    const n = streak();
    const el = $('#streak');
    el.textContent = `🔥 ${n} ${plural(n, 'день', 'дня', 'дней')}`;
    el.classList.toggle('show', n > 0);
  }
  $('#streak').addEventListener('click', () => toast('Серия: сколько дней подряд ты готовишь по рулетке'));
  function plural(n, a, b, c) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return a;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return b;
    return c;
  }

  /* ================= Мои блюда ================= */
  let dishesTab = 'history';
  $('#dishes-tabs').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    dishesTab = b.dataset.tab;
    $$('#dishes-tabs button').forEach(x => x.classList.toggle('on', x === b));
    FX.haptic('tick');
    renderDishes();
  });

  function fmtDate(ts) {
    const d = new Date(ts), now = new Date();
    const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    if (dayKey(ts) === dayKey(now)) return 'Сегодня, ' + time;
    if (dayKey(ts) === dayKey(now - DAY)) return 'Вчера, ' + time;
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  }

  function dishCard(entry, kind) {
    const { title, sub } = dishTitle(entry.picks);
    const fav = isFav(entry.picks);
    const extra = [entry.cook ? '👨‍🍳 ' + entry.cook : '', entry.twist ? '🎯 челлендж' : ''].filter(Boolean).join(' · ');
    return `
      <div class="card" data-id="${entry.id}">
        <div class="emojis">${entry.picks.map(p => p.emoji).join('')}</div>
        <div class="info">
          <div class="t">${esc(title)}</div>
          <div class="s">${esc(sub)}${kind === 'history' ? ' · ' + fmtDate(entry.ts) : ''}${extra ? '<br>' + esc(extra) : ''}</div>
        </div>
        <div class="act">
          ${kind === 'fav'
            ? `<button class="mini-btn" data-act="load" title="На барабаны">🎰</button><button class="mini-btn" data-act="unfav" title="Убрать">💔</button>`
            : `<button class="mini-btn" data-act="fav" title="Любимое">${fav ? '❤️' : '🤍'}</button><button class="mini-btn" data-act="del" title="Удалить">🗑️</button>`}
        </div>
      </div>`;
  }

  function renderDishes() {
    const body = $('#dishes-body');
    if (dishesTab === 'history') {
      const h = S().history;
      body.innerHTML = h.length
        ? `<div class="list">${h.map(e => dishCard(e, 'history')).join('')}</div>`
        : `<div class="empty"><span class="big">🍳</span>Тут появятся блюда, которые ты приготовил(а).<br>Крути рулетку и жми «Готовлю!»</div>`;
    } else if (dishesTab === 'fav') {
      const f = S().favorites;
      body.innerHTML = f.length
        ? `<div class="list">${f.map(e => dishCard(e, 'fav')).join('')}</div>`
        : `<div class="empty"><span class="big">❤️</span>Сохраняй удачные сочетания —<br>они станут «джекпотом», если выпадут снова</div>`;
    } else {
      body.innerHTML = renderStats();
    }
  }

  $('#dishes-body').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.closest('.card').dataset.id;
    const act = b.dataset.act;
    if (act === 'del') {
      S().history = S().history.filter(h => h.id !== id);
      Store.save(); updateStreak();
    } else if (act === 'fav') {
      const h = S().history.find(x => x.id === id);
      toggleFav(h.picks);
    } else if (act === 'unfav') {
      S().favorites = S().favorites.filter(f => f.id !== id);
      Store.save();
    } else if (act === 'load') {
      const f = S().favorites.find(x => x.id === id);
      loadCombo(f.picks);
      return;
    }
    FX.haptic('light');
    renderDishes();
  });

  /* Выставить любимое сочетание на барабаны */
  function loadCombo(picks) {
    showScreen('roulette');
    let missing = 0;
    reels.forEach(r => {
      const p = picks.find(x => x.col === r.col.title) || picks[reels.indexOf(r)];
      const idx = p ? r.reel.items.findIndex(i => i.name.toLowerCase() === p.name.toLowerCase()) : -1;
      if (idx < 0) { missing++; return; }
      r.reel.spinTo(idx, 6, 900).then(() => savePosition(r));
    });
    FX.haptic('medium');
    if (missing) toast('Часть продуктов уже удалена из списка');
  }

  function renderStats() {
    const h = S().history;
    const count = {};
    h.forEach(e => e.picks.forEach(p => {
      count[p.col] = count[p.col] || {};
      const key = p.emoji + ' ' + p.name;
      count[p.col][key] = (count[p.col][key] || 0) + 1;
    }));
    const cooks = {};
    h.forEach(e => { if (e.cook) cooks[e.cook] = (cooks[e.cook] || 0) + 1; });

    const block = (title, obj) => {
      const rows = Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (!rows.length) return '';
      const max = rows[0][1];
      return `<div class="top-block"><h4>${esc(title)}</h4>${rows.map(([k, v]) => `
        <div class="bar-row"><span class="lbl">${esc(k)}</span><span class="bar"><i style="width:${(v / max) * 100}%"></i></span><span class="n">${v}</span></div>`).join('')}</div>`;
    };
    const st = streak();
    const best = bestStreak();
    return `
      <div class="stat-grid">
        <div class="stat"><b>${S().stats.spins}</b><span>прокруток</span></div>
        <div class="stat"><b>${h.length}</b><span>блюд приготовлено</span></div>
        <div class="stat"><b>🔥 ${st}</b><span>текущая серия</span></div>
        <div class="stat"><b>🏆 ${best}</b><span>лучшая серия</span></div>
      </div>
      ${Object.entries(count).map(([col, obj]) => block('Топ: ' + col, obj)).join('')}
      ${block('Кто чаще готовит', cooks)}
      ${h.length ? '' : '<div class="empty" style="padding-top:20px">Статистика появится после первого «Готовлю!»</div>'}`;
  }
  function bestStreak() {
    const days = Array.from(new Set(S().history.map(h => { const d = new Date(h.ts); d.setHours(0, 0, 0, 0); return d.getTime(); }))).sort();
    let best = 0, cur = 0, prev = null;
    days.forEach(d => {
      cur = prev !== null && Math.round((d - prev) / DAY) === 1 ? cur + 1 : 1;
      best = Math.max(best, cur); prev = d;
    });
    return best;
  }

  /* ================= Настройки ================= */
  function switchHtml(key, on) {
    return `<label class="switch"><input type="checkbox" data-set="${key}" ${on ? 'checked' : ''}><i></i></label>`;
  }

  function renderSettings() {
    const s = S().settings;
    const cols = S().columns;
    const p = S().people;
    $('#settings-body').innerHTML = `
      <div class="group-title">Колонки рулетки</div>
      <div class="group">
        ${cols.map(c => `
          <div class="row">
            <span class="ico">${esc((c.items[0] && c.items[0].emoji) || '🍽️')}</span>
            <button class="grow" data-edit="${c.id}" style="text-align:left">
              <div style="font-weight:700">${esc(c.title)}</div>
              <div class="sub">${c.items.filter(i => i.enabled).length} из ${c.items.length} · нажми, чтобы изменить</div>
            </button>
            <label class="switch"><input type="checkbox" data-col-on="${c.id}" ${c.enabled ? 'checked' : ''}><i></i></label>
          </div>`).join('')}
        ${cols.length < 4 ? `<button class="row" id="add-col"><span class="ico">➕</span><span class="grow">Добавить колонку</span></button>` : ''}
      </div>

      <div class="group-title">Весёлое</div>
      <div class="group">
        <div class="row"><span class="ico">${s.sanity ? '🧠' : '🤪'}</span><div class="grow">Здравый смысл<div class="sub">${s.sanity ? 'Без «варёного стейка». Выключи — будет безумный режим' : 'Безумный режим: выпадает что угодно'}</div></div>${switchHtml('sanity', s.sanity)}</div>
        <div class="row"><span class="ico">🎯</span><div class="grow">Челлендж от шефа<div class="sub">Случайное условие к блюду</div></div>${switchHtml('twists', s.twists)}</div>
        <div class="row"><span class="ico">👨‍🍳</span><div class="grow">Кто готовит, кто моет<div class="sub">Рулетка выберет дежурных</div></div>
          <label class="switch"><input type="checkbox" id="people-on" ${p.enabled ? 'checked' : ''}><i></i></label></div>
        ${p.enabled ? `
          <div class="tags">${p.names.map((n, i) => `<span class="tag">${esc(n)}<button data-del-person="${i}">×</button></span>`).join('') || '<span class="sub">Добавь участников</span>'}</div>
          <div class="inline-add"><input class="input" id="person-name" maxlength="16" placeholder="Имя"><button class="btn primary" id="add-person">+</button></div>` : ''}
        <div class="row" style="flex-wrap:wrap"><span class="ico">🔁</span><div class="grow">Не повторять блюда<div class="sub">Которые уже готовил(а) недавно</div></div>
          <div class="pills" style="width:100%;padding-left:42px">
            ${[[0, 'Выкл'], [3, '3 дня'], [7, 'Неделю'], [14, '2 недели']].map(([v, l]) => `<button class="pill ${s.noRepeatDays === v ? 'on' : ''}" data-norepeat="${v}">${l}</button>`).join('')}
          </div></div>
      </div>

      <div class="group-title">Ощущения</div>
      <div class="group">
        <div class="row"><span class="ico">📳</span><div class="grow">Вибрация</div>${switchHtml('haptics', s.haptics)}</div>
        <div class="row"><span class="ico">🔊</span><div class="grow">Звуки</div>${switchHtml('sound', s.sound)}</div>
        <div class="row"><span class="ico">🤳</span><div class="grow">Встряхнуть, чтобы крутить</div>${switchHtml('shake', s.shake)}</div>
        <div class="row" style="flex-wrap:wrap"><span class="ico">🎨</span><div class="grow">Оформление</div>
          <div class="pills">${[['slot', '🎰 Автомат'], ['classic', '✨ Минимал']].map(([v, l]) => `<button class="pill ${(s.skin || 'slot') === v ? 'on' : ''}" data-skin="${v}">${l}</button>`).join('')}</div></div>
        <div class="row" style="flex-wrap:wrap"><span class="ico">🌗</span><div class="grow">Тема</div>
          <div class="pills">${[['auto', 'Авто'], ['dark', 'Тёмная'], ['light', 'Светлая']].map(([v, l]) => `<button class="pill ${s.theme === v ? 'on' : ''}" data-theme="${v}">${l}</button>`).join('')}</div></div>
      </div>

      <div class="group-title">Данные</div>
      <div class="group">
        <button class="row" id="export"><span class="ico">📤</span><div class="grow">Поделиться набором<div class="sub">Скопировать код со всеми продуктами</div></div><span class="chev">›</span></button>
        <button class="row" id="import"><span class="ico">📥</span><div class="grow">Загрузить набор по коду</div><span class="chev">›</span></button>
        <button class="row" id="reset"><span class="ico">🧨</span><div class="grow" style="color:var(--danger)">Сбросить всё</div></button>
      </div>
      <div class="version">Рулетка еды v${APP_CONFIG.version} · данные хранятся на этом устройстве</div>
    `;
  }

  $('#settings-body').addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.set) {
      S().settings[t.dataset.set] = t.checked;
      if (t.dataset.set === 'shake') FX.setShake(t.checked);
      if (t.dataset.set === 'sound' && t.checked) { FX.unlockAudio(); FX.sound('pop'); }
      if (t.dataset.set === 'sanity') { Store.save(); renderSettings(); toast(t.checked ? '🧠 Здравый смысл включён' : '🤪 Безумный режим! Возможно всё'); }
    } else if (t.dataset.colOn) {
      const c = S().columns.find(x => x.id === t.dataset.colOn);
      c.enabled = t.checked;
    } else if (t.id === 'people-on') {
      S().people.enabled = t.checked;
      Store.save();
      renderSettings();
    }
    Store.save();
    FX.haptic('light');
  });

  $('#settings-body').addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.edit) return openEditor(t.dataset.edit);
    if (t.dataset.norepeat !== undefined) { S().settings.noRepeatDays = +t.dataset.norepeat; Store.save(); renderSettings(); FX.haptic('tick'); return; }
    if (t.dataset.skin) { S().settings.skin = t.dataset.skin; Store.save(); applyTheme(); renderSettings(); FX.haptic('tick'); return; }
    if (t.dataset.theme) { S().settings.theme = t.dataset.theme; Store.save(); applyTheme(); renderSettings(); FX.haptic('tick'); return; }
    if (t.dataset.delPerson !== undefined) { S().people.names.splice(+t.dataset.delPerson, 1); Store.save(); renderSettings(); return; }
    if (t.id === 'add-person') return addPerson();
    if (t.id === 'add-col') {
      const id = Store.uid();
      S().columns.push({ id, title: 'Новая', enabled: true, items: [] });
      Store.save();
      return openEditor(id);
    }
    if (t.id === 'export') return exportSheet();
    if (t.id === 'import') return importSheet();
    if (t.id === 'reset') return confirmAsk('Сбросить все продукты, историю и избранное?', () => {
      Store.reset(); locked.clear(); applyTheme(); updateStreak(); renderSettings(); toast('Всё сброшено');
    });
  });
  $('#settings-body').addEventListener('keydown', e => { if (e.target.id === 'person-name' && e.key === 'Enter') addPerson(); });

  function addPerson() {
    const inp = $('#person-name');
    const v = inp.value.trim();
    if (!v) return;
    if (S().people.names.length >= 12) return toast('Максимум 12 человек');
    S().people.names.push(v);
    Store.save();
    renderSettings();
    setTimeout(() => $('#person-name') && $('#person-name').focus(), 30);
  }

  function exportSheet() {
    const code = Store.exportCode();
    openSheet(`
      <h3>Поделиться набором</h3>
      <p class="sub" style="color:var(--muted);margin:-6px 0 12px;font-size:14px">Отправь этот код другу — он вставит его в «Загрузить набор». Фото в код не попадают.</p>
      <textarea class="input" readonly id="code-out">${code}</textarea>
      <div class="sheet-actions"><button class="btn primary" id="copy-code">Скопировать</button><button class="btn" id="send-code">Отправить в чат</button></div>`);
    $('#copy-code').onclick = () => copy(code);
    $('#send-code').onclick = () => FX.share('Мой набор для «Рулетки еды» 🎰 — вставь код в Настройки → Загрузить набор:\n\n' + code);
  }
  function importSheet() {
    openSheet(`
      <h3>Загрузить набор</h3>
      <textarea class="input" id="code-in" placeholder="Вставь код, начинающийся с FR1:"></textarea>
      <p style="color:var(--muted);font-size:13px">Текущие колонки и продукты будут заменены. История и избранное останутся.</p>
      <div class="sheet-actions"><button class="btn" id="cancel">Отмена</button><button class="btn primary" id="do-import">Загрузить</button></div>`);
    $('#cancel').onclick = closeSheet;
    $('#do-import').onclick = () => {
      try {
        Store.importCode($('#code-in').value);
        locked.clear();
        closeSheet();
        renderSettings();
        toast('Набор загружен! 🎉');
        FX.haptic('success');
      } catch (e) {
        toast('Не получилось прочитать код 🤔');
        FX.haptic('error');
      }
    };
  }
  function copy(text) {
    const done = () => { toast('Скопировано 📋'); FX.haptic('success'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
    function fallback() {
      const ta = $('#code-out');
      if (ta) { ta.select(); document.execCommand('copy'); done(); }
    }
  }

  /* ================= Редактор колонки ================= */
  function col() { return S().columns.find(c => c.id === editingColId); }

  function openEditor(id) {
    editingColId = id;
    showScreen('editor');
    $('#editor-title').value = col().title;
    renderEditor();
  }
  $('#btn-editor-back').addEventListener('click', goBack);
  $('#editor-title').addEventListener('input', e => {
    col().title = e.target.value.trim() || 'Без названия';
    Store.save();
  });

  function renderEditor() {
    const c = col();
    const weightStars = w => w > 1 ? '★'.repeat(w - 1) : '';
    $('#editor-body').innerHTML = `
      <p style="color:var(--muted);font-size:13.5px;margin:0 0 12px">Нажми на продукт, чтобы поменять название, эмодзи, фото или шанс выпадения.</p>
      <div class="item-grid">
        ${c.items.map(i => `
          <button class="item ${i.enabled ? '' : 'off'}" data-item="${i.id}">
            ${i.weight > 1 ? `<span class="w">${weightStars(i.weight)}</span>` : ''}
            ${i.img ? `<img class="cell-img" src="${i.img}" alt="">` : `<span class="cell-emoji">${i.emoji}</span>`}
            <span class="nm">${esc(i.name)}</span>
          </button>`).join('')}
        <button class="item add" data-item="new"><b>+</b>Добавить</button>
      </div>
      <div class="editor-actions">
        ${S().columns.length > 1 ? `<button class="btn danger block" id="del-col">Удалить колонку</button>` : ''}
      </div>`;
  }

  $('#editor-body').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.item) return itemSheet(b.dataset.item === 'new' ? null : b.dataset.item);
    if (b.id === 'del-col') {
      confirmAsk(`Удалить колонку «${col().title}» со всеми продуктами?`, () => {
        S().columns = S().columns.filter(c => c.id !== editingColId);
        Store.save();
        showScreen('settings');
      });
    }
  });

  function itemSheet(itemId) {
    const c = col();
    const existing = itemId ? c.items.find(i => i.id === itemId) : null;
    const draft = existing ? { ...existing, no: (existing.no || []).slice() } : { id: Store.uid(), name: '', emoji: '🍽️', img: null, weight: 1, enabled: true, no: [] };

    // Продукты других колонок и текущие запреты (в любую сторону)
    const otherCols = S().columns.filter(x => x.id !== c.id && x.items.length);
    const banSel = new Set();
    if (existing) otherCols.forEach(oc => oc.items.forEach(o => { if (!Store.compatible(existing, o)) banSel.add(o.id); }));
    const bansHtml = otherCols.map(oc => `
      <div class="ban-col">${esc(oc.title)}</div>
      <div class="pills">${oc.items.map(o => `<button class="pill ${banSel.has(o.id) ? 'ban' : ''}" data-ban="${o.id}">${o.emoji} ${esc(o.name)}</button>`).join('')}</div>`).join('');

    const pv = () => draft.img ? `<img src="${draft.img}" alt="">` : draft.emoji;
    openSheet(`
      <h3>${existing ? 'Продукт' : 'Новый продукт'}</h3>
      <div class="preview">
        <div class="pv" id="pv">${pv()}</div>
        <div class="btns">
          <button class="btn" id="photo">📷 ${draft.img ? 'Другое фото' : 'Загрузить фото'}</button>
          <button class="btn" id="photo-del" style="${draft.img ? '' : 'display:none'}">Убрать фото</button>
        </div>
      </div>
      <div class="form-row"><label>Название</label><input class="input" id="item-name" maxlength="24" value="${esc(draft.name)}" placeholder="Например, Плов" style="width:100%"></div>
      <div class="form-row"><label>Эмодзи</label>
        <div class="emoji-pick" id="emoji-pick">${DEFAULTS.emojiPalette.map(em => `<button data-em="${em}" class="${em === draft.emoji ? 'on' : ''}">${em}</button>`).join('')}</div>
      </div>
      <div class="form-row"><label>Шанс выпадения</label>
        <div class="pills" id="weight">${[[1, 'Обычный'], [2, '★ Чаще'], [3, '★★ Любимое']].map(([v, l]) => `<button class="pill ${draft.weight === v ? 'on' : ''}" data-w="${v}">${l}</button>`).join('')}</div>
      </div>
      <div class="row" style="padding:10px 2px;border:0"><div class="grow">Участвует в рулетке</div>
        <label class="switch"><input type="checkbox" id="item-on" ${draft.enabled ? 'checked' : ''}><i></i></label></div>
      ${otherCols.length ? `<details class="bans">
        <summary>🚫 Не сочетается с… <b id="ban-count">${banSel.size || ''}</b></summary>
        <p class="ban-hint">Отмеченное красным рулетка не поставит вместе с этим продуктом (если включён «Здравый смысл»).</p>
        <div id="ban-list">${bansHtml}</div>
      </details>` : ''}
      <div class="sheet-actions">
        ${existing ? '<button class="btn danger" id="item-del">Удалить</button>' : ''}
        <button class="btn primary" id="item-save">Сохранить</button>
      </div>`);

    const refreshPv = () => {
      $('#pv').innerHTML = pv();
      $('#photo-del').style.display = draft.img ? '' : 'none';
      $('#photo').textContent = '📷 ' + (draft.img ? 'Другое фото' : 'Загрузить фото');
    };
    $('#emoji-pick').onclick = e => {
      const b = e.target.closest('[data-em]');
      if (!b) return;
      draft.emoji = b.dataset.em;
      $$('#emoji-pick button').forEach(x => x.classList.toggle('on', x === b));
      if (!draft.img) refreshPv();
      FX.haptic('tick');
    };
    $('#weight').onclick = e => {
      const b = e.target.closest('[data-w]');
      if (!b) return;
      draft.weight = +b.dataset.w;
      $$('#weight button').forEach(x => x.classList.toggle('on', x === b));
      FX.haptic('tick');
    };
    if ($('#ban-list')) $('#ban-list').onclick = e => {
      const b = e.target.closest('[data-ban]');
      if (!b) return;
      const id = b.dataset.ban;
      if (banSel.has(id)) banSel.delete(id); else banSel.add(id);
      b.classList.toggle('ban', banSel.has(id));
      $('#ban-count').textContent = banSel.size || '';
      FX.haptic('tick');
    };
    $('#photo').onclick = () => pickPhoto(img => { draft.img = img; refreshPv(); });
    $('#photo-del').onclick = () => { draft.img = null; refreshPv(); };
    $('#item-save').onclick = () => {
      draft.name = $('#item-name').value.trim();
      draft.enabled = $('#item-on').checked;
      if (!draft.name) { toast('Напиши название'); $('#item-name').focus(); return; }
      if (existing && existing.name !== draft.name) Store.renameRefs(existing.name, draft.name);
      // Применяем запреты: отмеченное — в свой список, снятое — убираем с обеих сторон
      const me = draft.name.toLowerCase();
      const oldMe = existing ? existing.name.toLowerCase() : me;
      otherCols.forEach(oc => oc.items.forEach(o => {
        const on = o.name.toLowerCase();
        if (banSel.has(o.id)) {
          if (!draft.no.includes(on) && !(o.no || []).includes(me)) draft.no.push(on);
        } else {
          draft.no = draft.no.filter(x => x !== on);
          if (o.no) o.no = o.no.filter(x => x !== me && x !== oldMe);
        }
      }));
      if (existing) Object.assign(existing, draft); else c.items.push(draft);
      Store.save();
      closeSheet();
      renderEditor();
      FX.haptic('success');
    };
    if (existing) $('#item-del').onclick = () => {
      c.items = c.items.filter(i => i.id !== existing.id);
      Store.save();
      closeSheet();
      renderEditor();
      FX.haptic('medium');
    };
    if (!existing) setTimeout(() => $('#item-name').focus(), 350);
  }

  /* Фото: обрезаем до квадрата 160×160 и жмём в JPEG, чтобы влезло в localStorage */
  function pickPhoto(cb) {
    const input = $('#file-input');
    input.value = '';
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => {
        const size = 160;
        const cv = document.createElement('canvas');
        cv.width = cv.height = size;
        const s = Math.min(img.width, img.height);
        cv.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        URL.revokeObjectURL(url);
        cb(cv.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => toast('Не удалось открыть картинку');
      img.src = url;
    };
    input.click();
  }

  /* ================= Sheet / toast / confirm ================= */
  function openSheet(html) {
    $('#sheet-body').onclick = null;
    $('#sheet-body').innerHTML = html;
    $('#sheet').scrollTop = 0;
    $('#sheet').classList.add('show');
    $('#sheet-backdrop').classList.add('show');
    if (FX.inTelegram) tg.BackButton.show();
  }
  function closeSheet() {
    $('#sheet').classList.remove('show');
    $('#sheet-backdrop').classList.remove('show');
    if (FX.inTelegram && currentScreen !== 'editor') tg.BackButton.hide();
  }
  function sheetOpen() { return $('#sheet').classList.contains('show'); }
  $('#sheet-backdrop').addEventListener('click', closeSheet);
  $('.sheet-grip').addEventListener('click', closeSheet);

  function confirmAsk(text, yes) {
    if (FX.inTelegram && FX.vOk('6.2')) {
      tg.showConfirm(text, ok => ok && yes());
    } else if (confirm(text)) yes();
  }

  let toastTimer = 0;
  window.toast = function (text, ms) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2200);
  };

  /* ================= Старт ================= */
  applyTheme();
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
  updateStreak();
  showScreen('roulette');
  window.addEventListener('resize', () => reels.forEach(r => { r.reel.nodes.forEach(n => (n._idx = null)); r.reel.render(); }));
})();
