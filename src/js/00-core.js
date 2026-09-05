/* ==========================================================================
   JellyHulu — core
   Namespace, settings store, DOM helpers and the Jellyfin integration points
   every other module builds on.

   Design rules for this bundle:
   · Never throw into Jellyfin. Every entry point is guarded; a failure in one
     feature must not take down the others or the app itself.
   · Never assume the API client exists or has a given method — jellyfin-web
     changes between releases and this has to survive 10.10 and 10.11.
   · Never poll. Everything is event- or observer-driven.
   ========================================================================== */

const JH = {
  version: '__VERSION__',
  ready: false,
  modules: [],
};

/* --------------------------------------------------------------------------
   Logging — quiet unless the user opts in with ?jhdebug or localStorage.
   -------------------------------------------------------------------------- */
const DEBUG = (() => {
  try {
    return location.search.includes('jhdebug') ||
           localStorage.getItem('jellyhulu.debug') === '1';
  } catch (_) {
    return false;
  }
})();

const log = (...args) => { if (DEBUG) console.log('%c[JellyHulu]', 'color:#1CE783', ...args); };
const warn = (...args) => { if (DEBUG) console.warn('[JellyHulu]', ...args); };

/* Wraps a function so a throw is logged and swallowed rather than escaping
   into Jellyfin's own event handlers. */
function safe(fn, label) {
  return function (...args) {
    try {
      return fn.apply(this, args);
    } catch (err) {
      warn('error in ' + (label || fn.name || 'anonymous'), err);
      return undefined;
    }
  };
}

/* --------------------------------------------------------------------------
   DOM helpers
   -------------------------------------------------------------------------- */
const $  = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach((key) => {
      const value = attrs[key];
      if (value == null || value === false) return;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key === 'style' && typeof value === 'object') {
        // Custom properties are invisible to Object.assign on a style object;
        // they have to go through setProperty.
        Object.keys(value).forEach((prop) => {
          if (prop.startsWith('--')) node.style.setProperty(prop, value[prop]);
          else node.style[prop] = value[prop];
        });
      }
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else node.setAttribute(key, value === true ? '' : value);
    });
  }
  (children || []).forEach((child) => {
    if (child == null) return;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  });
  return node;
}

function debounce(fn, wait) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

/* Coalesces bursts of calls into one per animation frame. Used for anything
   that reads layout during scroll. */
function rafThrottle(fn) {
  let queued = false;
  let lastArgs;
  return function (...args) {
    lastArgs = args;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn.apply(this, lastArgs);
    });
  };
}

/* --------------------------------------------------------------------------
   Settings store
   Per-user so each household member gets their own feel, keyed off the
   Jellyfin user id when one is available.
   -------------------------------------------------------------------------- */
const DEFAULTS = {
  accent:    '#1CE783',
  density:   'comfortable',   // compact | comfortable | cinematic
  motion:    'full',          // full | subtle | off
  previews:  'on',            // on | off
  hero:      'on',
  badges:    'on',
  snap:      'auto',        // auto | on | off — 'auto' picks by input device
  tv:        'auto',          // auto | on | off
  power:     'auto',          // auto | low
  contrast:  'normal',        // normal | high
  heroDwell: 9,               // seconds
};

const Settings = {
  _cache: null,

  key() {
    let uid = '';
    try {
      if (window.ApiClient && typeof window.ApiClient.getCurrentUserId === 'function') {
        uid = window.ApiClient.getCurrentUserId() || '';
      }
    } catch (_) { /* not signed in yet */ }
    return 'jellyhulu.settings.v1' + (uid ? '.' + uid : '');
  },

  all() {
    if (this._cache) return this._cache;
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem(this.key()) || '{}') || {};
    } catch (_) { stored = {}; }
    this._cache = Object.assign({}, DEFAULTS, stored);
    return this._cache;
  },

  get(name) { return this.all()[name]; },

  set(name, value) {
    const all = this.all();
    all[name] = value;
    this._cache = all;
    try {
      localStorage.setItem(this.key(), JSON.stringify(all));
    } catch (_) { /* private mode, quota — settings just won't persist */ }
    this.apply();
    document.dispatchEvent(new CustomEvent('jellyhulu:settingchange', {
      detail: { name, value },
    }));
  },

  reset() {
    this._cache = Object.assign({}, DEFAULTS);
    try { localStorage.removeItem(this.key()); } catch (_) {}
    this.apply();
    document.dispatchEvent(new CustomEvent('jellyhulu:settingchange', {
      detail: { name: '*', value: null },
    }));
  },

  /* Projects settings onto <html> as data attributes and custom properties.
     All the visual work is done by CSS reading these — this function never
     touches a component directly. */
  apply() {
    const s = this.all();
    const root = document.documentElement;

    root.setAttribute('data-jh-density', s.density);
    root.setAttribute('data-jh-motion', s.motion);
    root.setAttribute('data-jh-previews', s.previews);
    root.setAttribute('data-jh-hero', s.hero);
    root.setAttribute('data-jh-badges', s.badges);
    root.setAttribute('data-jh-snap', s.snap);
    root.setAttribute('data-jh-contrast', s.contrast);

    if (s.tv === 'auto') root.removeAttribute('data-jh-tv');
    else root.setAttribute('data-jh-tv', s.tv);

    if (s.power === 'auto') root.removeAttribute('data-jh-power');
    else root.setAttribute('data-jh-power', s.power);

    if (s.accent && s.accent !== DEFAULTS.accent) {
      root.style.setProperty('--jh-accent', s.accent);
      root.style.setProperty('--jh-accent-hover', lighten(s.accent, 0.18));
      root.style.setProperty('--jh-accent-pressed', lighten(s.accent, -0.12));
      root.style.setProperty('--jh-accent-muted', toRgba(s.accent, 0.16));
      root.style.setProperty('--jh-accent-faint', toRgba(s.accent, 0.08));
      root.style.setProperty('--jh-on-accent', readableOn(s.accent));
    } else {
      ['--jh-accent', '--jh-accent-hover', '--jh-accent-pressed',
       '--jh-accent-muted', '--jh-accent-faint', '--jh-on-accent']
        .forEach((prop) => root.style.removeProperty(prop));
    }

    root.style.setProperty('--jh-hero-dwell', s.heroDwell + 's');
  },
};

/* --------------------------------------------------------------------------
   Colour maths for the accent picker
   -------------------------------------------------------------------------- */
function parseHex(hex) {
  const clean = String(hex).replace('#', '').trim();
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean;
  const int = parseInt(full, 16);
  if (Number.isNaN(int) || full.length !== 6) return null;
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function lighten(hex, amount) {
  const c = parseHex(hex);
  if (!c) return hex;
  const shift = (v) => Math.max(0, Math.min(255, Math.round(
    amount >= 0 ? v + (255 - v) * amount : v * (1 + amount)
  )));
  return '#' + [shift(c.r), shift(c.g), shift(c.b)]
    .map((v) => v.toString(16).padStart(2, '0')).join('');
}

function toRgba(hex, alpha) {
  const c = parseHex(hex);
  return c ? `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})` : hex;
}

/* WCAG relative luminance, so text on a custom accent stays legible whatever
   colour the user picks. */
function readableOn(hex) {
  const c = parseHex(hex);
  if (!c) return '#0B0C0F';
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  return L > 0.42 ? '#0B0C0F' : '#FFFFFF';
}

/* --------------------------------------------------------------------------
   Jellyfin API access
   Everything goes through here so there is one place to adapt when the
   client changes shape.
   -------------------------------------------------------------------------- */
const Api = {
  client() {
    const c = window.ApiClient;
    return (c && typeof c.getUrl === 'function' && typeof c.getJSON === 'function') ? c : null;
  },

  userId() {
    const c = this.client();
    try { return c && c.getCurrentUserId ? c.getCurrentUserId() : null; } catch (_) { return null; }
  },

  isSignedIn() { return !!(this.client() && this.userId()); },

  get(path, params) {
    const c = this.client();
    if (!c) return Promise.reject(new Error('no ApiClient'));
    return c.getJSON(c.getUrl(path, params || {}));
  },

  imageUrl(itemId, options) {
    const c = this.client();
    if (!c || !itemId) return null;
    try {
      return c.getImageUrl(itemId, options || {});
    } catch (_) {
      return null;
    }
  },

  /* Direct media URL with the session's own token appended — needed for a
     <video src>, which cannot carry an Authorization header. */
  videoUrl(itemId, params) {
    const c = this.client();
    if (!c || !itemId) return null;
    try {
      const query = Object.assign({ Static: true, api_key: c.accessToken() }, params || {});
      return c.getUrl('Videos/' + itemId + '/stream.mp4', query);
    } catch (_) {
      return null;
    }
  },
};

/* --------------------------------------------------------------------------
   Page lifecycle
   Jellyfin is a hash-routed SPA that fires a 'viewshow' event on each page
   element. Modules subscribe here rather than each wiring up their own
   observers.
   -------------------------------------------------------------------------- */
const Pages = {
  _handlers: [],

  on(fn) { this._handlers.push(safe(fn, 'page handler')); },

  emit(page) {
    this._handlers.forEach((fn) => fn(page));
  },

  current() {
    return $('.mainAnimatedPage:not(.hide)') ||
           $('.page:not(.hide)') ||
           document.body;
  },

  /* Which Jellyfin view is on screen, normalised to a short name. */
  route() {
    const hash = (location.hash || '').toLowerCase();
    if (!hash || hash === '#/' || hash.startsWith('#/home')) return 'home';
    if (hash.startsWith('#/details')) return 'details';
    if (hash.startsWith('#/list') || hash.startsWith('#/movies') ||
        hash.startsWith('#/tv') || hash.startsWith('#/music')) return 'library';
    if (hash.startsWith('#/search')) return 'search';
    if (hash.startsWith('#/video')) return 'video';
    if (hash.startsWith('#/login') || hash.startsWith('#/selectserver')) return 'login';
    if (hash.startsWith('#/dashboard') || hash.startsWith('#/configurationpage')) return 'dashboard';
    if (hash.startsWith('#/livetv')) return 'livetv';
    return 'other';
  },

  start() {
    // Jellyfin's own signal, the most reliable one when it fires.
    document.addEventListener('viewshow', safe((e) => {
      this.emit(e.target || Pages.current());
    }, 'viewshow'));

    // Hash routing covers navigations that don't emit viewshow.
    window.addEventListener('hashchange', debounce(safe(() => {
      this.emit(Pages.current());
    }, 'hashchange'), 60));

    // Last resort: content swapped into the page container without either
    // event. Debounced hard so a rail rendering 200 cards fires once.
    const host = $('.mainAnimatedPages') || document.body;
    const observer = new MutationObserver(debounce(safe(() => {
      this.emit(Pages.current());
    }, 'mutation'), 220));

    observer.observe(host, { childList: true, subtree: false });
  },
};

/* --------------------------------------------------------------------------
   Device capability sniff, used to auto-engage low-power mode.
   Deliberately conservative: it only ever turns effects *off*, and only when
   the signal is unambiguous.
   -------------------------------------------------------------------------- */
function detectLowPower() {
  if (Settings.get('power') !== 'auto') return;

  let weak = false;

  const cores = navigator.hardwareConcurrency;
  if (typeof cores === 'number' && cores > 0 && cores <= 2) weak = true;

  const mem = navigator.deviceMemory;
  if (typeof mem === 'number' && mem > 0 && mem <= 2) weak = true;

  const conn = navigator.connection;
  if (conn && (conn.saveData === true || /^(slow-2g|2g)$/.test(conn.effectiveType || ''))) {
    weak = true;
  }

  // A TV browser or set-top stick: almost always GPU-limited.
  if (document.documentElement.classList.contains('layout-tv')) weak = true;

  if (weak) {
    document.documentElement.setAttribute('data-jh-power', 'low');
    log('low-power mode engaged automatically');
  }
}
