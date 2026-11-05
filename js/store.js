/* Состояние приложения + сохранение в localStorage */
(function () {
  const KEY = 'foodroulette:v1';
  const uid = () => Math.random().toString(36).slice(2, 9);

  function fresh() {
    return {
      columns: DEFAULTS.columns.map(c => ({
        id: c.id,
        title: c.title,
        enabled: c.enabled,
        items: c.items.map(([name, emoji]) => ({ id: uid(), name, emoji, img: null, weight: 1, enabled: true, no: DEFAULTS.defaultBans(c.id, name) })),
      })),
      people: { enabled: false, names: DEFAULTS.people.slice() },
      history: [],   // { id, ts, picks:[{col, name, emoji, img}], twist, cook, washer }
      favorites: [], // { id, ts, picks }
      positions: {}, // colId -> itemId (где остановился барабан)
      settings: {
        theme: 'auto',
        skin: 'slot', // slot — игровой автомат, classic — минимал
        haptics: true,
        sound: true,
        shake: true,
        twists: false,
        noRepeatDays: 3,
        sanity: true, // «здравый смысл»: не предлагать несочетаемое
      },
      stats: { spins: 0 },
      defaultsVersion: DEFAULTS.version,
    };
  }

  /* Докидываем новые стандартные продукты в уже сохранённый набор (то, что удалил пользователь, не трогаем, если версия не менялась) */
  function mergeNewDefaults(state) {
    if ((state.defaultsVersion || 1) >= DEFAULTS.version) return false;
    DEFAULTS.columns.forEach(dc => {
      const col = state.columns.find(c => c.id === dc.id);
      if (!col) return;
      const have = new Set(col.items.map(i => i.name.toLowerCase()));
      dc.items.forEach(([name, emoji]) => {
        if (!have.has(name.toLowerCase())) {
          col.items.push({ id: uid(), name, emoji, img: null, weight: 1, enabled: true });
        }
      });
    });
    // v3: правила сочетаемости для продуктов, у которых их ещё нет
    state.columns.forEach(col => col.items.forEach(it => {
      if (!Array.isArray(it.no)) it.no = DEFAULTS.defaultBans(col.id, it.name);
    }));
    state.defaultsVersion = DEFAULTS.version;
    return true;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return fresh();
      const data = JSON.parse(raw);
      const base = fresh();
      const state = {
        ...base,
        ...data,
        defaultsVersion: data.defaultsVersion || 1,
        settings: { ...base.settings, ...(data.settings || {}) },
        people: { ...base.people, ...(data.people || {}) },
        stats: { ...base.stats, ...(data.stats || {}) },
      };
      if (mergeNewDefaults(state)) {
        try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
      }
      return state;
    } catch (e) {
      console.warn('state load failed', e);
      return fresh();
    }
  }

  const Store = {
    state: load(),
    uid,
    save() {
      try {
        localStorage.setItem(KEY, JSON.stringify(Store.state));
      } catch (e) {
        // скорее всего переполнение из-за фото
        window.toast && toast('Не хватает места — попробуй удалить пару фото');
      }
    },
    reset() {
      Store.state = fresh();
      Store.save();
    },
    /* Можно ли подать эти продукты вместе (проверяем запреты в обе стороны) */
    compatible(a, b) {
      if (!a || !b || a === b) return true;
      const an = a.name.toLowerCase(), bn = b.name.toLowerCase();
      return !((a.no || []).includes(bn) || (b.no || []).includes(an));
    },
    comboOk(items) {
      for (let i = 0; i < items.length; i++)
        for (let j = i + 1; j < items.length; j++)
          if (!Store.compatible(items[i], items[j])) return false;
      return true;
    },
    /* Переименование: обновляем ссылки в запретах других продуктов */
    renameRefs(oldName, newName) {
      const o = oldName.toLowerCase(), n = newName.toLowerCase();
      if (o === n) return;
      Store.state.columns.forEach(c => c.items.forEach(it => {
        if (it.no) it.no = it.no.map(x => (x === o ? n : x));
      }));
    },
    activeColumns() {
      return Store.state.columns.filter(c => c.enabled && c.items.some(i => i.enabled));
    },

    /* Экспорт без фото, чтобы код получился компактным */
    exportCode() {
      const data = Store.state.columns.map(c => ({
        t: c.title, e: c.enabled ? 1 : 0,
        d: c.id,
        i: c.items.map(i => [i.name, i.emoji, i.weight, i.enabled ? 1 : 0, i.no || []]),
      }));
      const json = JSON.stringify({ v: 1, c: data, p: Store.state.people.names });
      return 'FR1:' + btoa(unescape(encodeURIComponent(json)));
    },
    importCode(code) {
      code = (code || '').trim();
      if (!code.startsWith('FR1:')) throw new Error('bad prefix');
      const json = JSON.parse(decodeURIComponent(escape(atob(code.slice(4)))));
      if (!json || !Array.isArray(json.c) || !json.c.length) throw new Error('bad data');
      const used = new Set();
      Store.state.columns = json.c.slice(0, 4).map((c, idx) => ({
        id: (c.d && /^(side|main|method|sauce)$/.test(c.d) && !used.has(c.d)) ? (used.add(c.d), c.d) : uid(),
        title: String(c.t || 'Колонка ' + (idx + 1)).slice(0, 16),
        enabled: !!c.e,
        items: (c.i || []).slice(0, 80).map(([name, emoji, weight, en, no]) => ({
          id: uid(), name: String(name).slice(0, 24), emoji: emoji || '🍽️', img: null,
          weight: Math.min(3, Math.max(1, +weight || 1)), enabled: en !== 0,
          no: Array.isArray(no) ? no.map(s => String(s).toLowerCase()).slice(0, 120) : [],
        })),
      }));
      if (Array.isArray(json.p)) Store.state.people.names = json.p.slice(0, 12).map(String);
      Store.state.positions = {};
      Store.save();
    },
  };

  window.Store = Store;
})();
