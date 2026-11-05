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
        items: c.items.map(([name, emoji]) => ({ id: uid(), name, emoji, img: null, weight: 1, enabled: true })),
      })),
      people: { enabled: false, names: DEFAULTS.people.slice() },
      history: [],   // { id, ts, picks:[{col, name, emoji, img}], twist, cook, washer }
      favorites: [], // { id, ts, picks }
      positions: {}, // colId -> itemId (где остановился барабан)
      settings: {
        theme: 'auto',
        haptics: true,
        sound: true,
        shake: true,
        twists: false,
        noRepeatDays: 3,
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
    activeColumns() {
      return Store.state.columns.filter(c => c.enabled && c.items.some(i => i.enabled));
    },

    /* Экспорт без фото, чтобы код получился компактным */
    exportCode() {
      const data = Store.state.columns.map(c => ({
        t: c.title, e: c.enabled ? 1 : 0,
        i: c.items.map(i => [i.name, i.emoji, i.weight, i.enabled ? 1 : 0]),
      }));
      const json = JSON.stringify({ v: 1, c: data, p: Store.state.people.names });
      return 'FR1:' + btoa(unescape(encodeURIComponent(json)));
    },
    importCode(code) {
      code = (code || '').trim();
      if (!code.startsWith('FR1:')) throw new Error('bad prefix');
      const json = JSON.parse(decodeURIComponent(escape(atob(code.slice(4)))));
      if (!json || !Array.isArray(json.c) || !json.c.length) throw new Error('bad data');
      Store.state.columns = json.c.slice(0, 4).map((c, idx) => ({
        id: uid(),
        title: String(c.t || 'Колонка ' + (idx + 1)).slice(0, 16),
        enabled: !!c.e,
        items: (c.i || []).slice(0, 60).map(([name, emoji, weight, en]) => ({
          id: uid(), name: String(name).slice(0, 24), emoji: emoji || '🍽️', img: null,
          weight: Math.min(3, Math.max(1, +weight || 1)), enabled: en !== 0,
        })),
      }));
      if (Array.isArray(json.p)) Store.state.people.names = json.p.slice(0, 12).map(String);
      Store.state.positions = {};
      Store.save();
    },
  };

  window.Store = Store;
})();
