/*!
 * JellyHulu v1.0.4 — a Hulu-inspired theme for Jellyfin (companion script)
 * https://github.com/jmaudlin/JellyHulu
 * Released under the MIT License.
 * Bundled font: Figtree, SIL Open Font License 1.1.
 *
 * Not affiliated with, endorsed by, or connected to Hulu, LLC,
 * The Walt Disney Company, or the Jellyfin project.
 */

(function () {
'use strict';

/* ── 00-core.js ──────────────────────────────────────────────────── */
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
  version: '1.0.4',
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

/* Server-wide defaults, published by the Jellyfin plugin as
   window.JELLYHULU_DEFAULTS before this bundle loads. They sit between the
   built-in defaults and the user's own stored choices, so an administrator
   can set the house style without taking the setting away from anyone. */
function serverDefaults() {
  const supplied = window.JELLYHULU_DEFAULTS;
  if (!supplied || typeof supplied !== 'object') return {};

  // Only keys the theme actually knows about, so a typo in the plugin
  // configuration can't inject an arbitrary attribute value onto <html>.
  const out = {};
  Object.keys(DEFAULTS).forEach((name) => {
    if (Object.prototype.hasOwnProperty.call(supplied, name)) {
      out[name] = supplied[name];
    }
  });
  return out;
}

const Settings = {
  _cache: null,

  /* Defaults plus whatever the server asked for — what "reset" returns to. */
  baseline() {
    return Object.assign({}, DEFAULTS, serverDefaults());
  },

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
    this._cache = Object.assign(this.baseline(), stored);
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
    this._cache = this.baseline();
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

/* ── 10-chrome.js ────────────────────────────────────────────────── */
/* ==========================================================================
   JellyHulu — chrome
   Header transparency, the global "is scrolling" flag, and rail edge
   detection. All of it is scroll-path code, so every handler is passive and
   rAF-throttled, and nothing in here reads layout during a scroll event.
   ========================================================================== */

const Chrome = {
  _railObserver: null,

  start() {
    this.watchScroll();
    this.watchRails();
    this.measureHeader();

    Pages.on(() => {
      // Route changed: re-evaluate whether the header sits over a hero, and
      // re-tag rail edges for whatever just rendered.
      this.updateHeaderMode();
      this.tagRailEdges();
    });
  },

  /* ------------------------------------------------------------------------
     Scroll state
     Two flags on <html>:
       .jh-scrolled  — past the threshold, header goes solid
       .jh-scrolling — a scroll is in flight, CSS suspends hover transitions
     ------------------------------------------------------------------------ */
  watchScroll() {
    const root = document.documentElement;
    let scrollingTimer = null;

    const onScroll = rafThrottle(() => {
      const target = Chrome.scrollHost();
      const y = target === window
        ? (window.scrollY || root.scrollTop || 0)
        : target.scrollTop;

      root.classList.toggle('jh-scrolled', y > 24);

      if (!root.classList.contains('jh-scrolling')) {
        root.classList.add('jh-scrolling');
      }
      clearTimeout(scrollingTimer);
      scrollingTimer = setTimeout(() => {
        root.classList.remove('jh-scrolling');
      }, 140);
    });

    // Jellyfin scrolls either the window or an inner container depending on
    // the view, so both are listened to. Capture catches the inner ones
    // without having to find them first.
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });

    onScroll();
  },

  /* ------------------------------------------------------------------------
     The header's real height changes: a tab row on library pages, TV mode,
     phone breakpoints, a plugin adding a button that wraps. Measuring it and
     writing the token back keeps every page's top padding, every sticky
     offset and every scroll-margin correct without a rule per case.
     ------------------------------------------------------------------------ */
  measureHeader() {
    const apply = rafThrottle(safe(() => {
      const header = $('.skinHeader');
      if (!header) return;
      const height = Math.round(header.getBoundingClientRect().height);
      // Ignore a zero height — the header is hidden in the video player, and
      // writing 0 would collapse the padding on every other page.
      if (height > 0) {
        // Deliberately NOT --jh-header-height: the header sizes itself from
        // that one, so writing a measurement back would feed into the next
        // measurement.
        document.documentElement.style.setProperty('--jh-header-h', height + 'px');
      }
    }, 'measure header'));

    const header = $('.skinHeader');
    if (header && 'ResizeObserver' in window) {
      new ResizeObserver(apply).observe(header);
    } else {
      window.addEventListener('resize', apply, { passive: true });
    }

    Pages.on(apply);
    apply();
  },

  scrollHost() {
    const inner = $('.mainAnimatedPages') || $('.skinBody');
    if (inner && inner.scrollHeight > inner.clientHeight + 4) return inner;
    return window;
  },

  /* ------------------------------------------------------------------------
     Header transparency over a hero or a detail backdrop.
     ------------------------------------------------------------------------ */
  updateHeaderMode() {
    const header = $('.skinHeader');
    if (!header) return;
    const route = Pages.route();
    const overHero = (route === 'home' && Settings.get('hero') === 'on' && !!$('.jh-hero')) ||
                     route === 'details' ||
                     route === 'video';
    header.classList.toggle('jh-over-hero', overHero);
  },

  /* ------------------------------------------------------------------------
     Rail edge tagging.
     A card scaled on hover at the very start or end of a rail would be cut
     off by the scroll container, so those cards scale inward instead. The
     tags are recomputed on scroll because "first visible" changes as the
     rail moves.
     ------------------------------------------------------------------------ */
  watchRails() {
    const retag = debounce(safe(() => this.tagRailEdges(), 'tagRailEdges'), 90);

    document.addEventListener('scroll', (e) => {
      const t = e.target;
      if (t && t.nodeType === 1 && Chrome.isRail(t)) retag();
    }, { passive: true, capture: true });

    window.addEventListener('resize', retag, { passive: true });
  },

  isRail(node) {
    return node.classList && (
      node.classList.contains('emby-scroller') ||
      node.classList.contains('scrollSlider') ||
      node.classList.contains('jh-rail-track') ||
      node.classList.contains('scrollX')
    );
  },

  tagRailEdges() {
    const rails = $$('.emby-scroller, .jh-rail-track');
    if (!rails.length) return;

    rails.forEach((rail) => {
      const cards = $$('.card', rail);
      if (!cards.length) return;

      // One layout read for the rail, then one per card — all reads happen
      // before any write, so this never thrashes.
      const railBox = rail.getBoundingClientRect();
      const edgeZone = Math.min(120, railBox.width * 0.12);

      const updates = cards.map((card) => {
        const box = card.getBoundingClientRect();
        return {
          card,
          start: box.left - railBox.left < edgeZone,
          end: railBox.right - box.right < edgeZone,
        };
      });

      updates.forEach(({ card, start, end }) => {
        card.classList.toggle('jh-edge-start', start && !end);
        card.classList.toggle('jh-edge-end', end && !start);
      });
    });
  },
};

/* --------------------------------------------------------------------------
   Snap detection.
   Scroll-snap is lovely with a trackpad or touch and awful with a notched
   mouse wheel, so it's enabled only once we've seen a fine-grained scroll.
   -------------------------------------------------------------------------- */
const Snap = {
  start() {
    if (Settings.get('snap') !== 'auto') return;

    const decide = (isPrecise) => {
      document.documentElement.setAttribute('data-jh-snap', isPrecise ? 'on' : 'off');
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouch);
    };

    const onWheel = (e) => {
      // A notched wheel reports large, integral deltas; a trackpad reports
      // small fractional ones.
      decide(Math.abs(e.deltaY) < 40 && e.deltaY % 1 !== 0);
    };
    const onTouch = () => decide(true);

    window.addEventListener('wheel', onWheel, { passive: true, once: true });
    window.addEventListener('touchstart', onTouch, { passive: true, once: true });
  },
};

/* ── 20-hero.js ──────────────────────────────────────────────────── */
/* ==========================================================================
   JellyHulu — hero carousel
   Jellyfin has no hero on the home page, so this builds one from the same
   data the home rails use: Continue Watching first (it's what you actually
   came back for), then Next Up, then Recently Added as filler.
   ========================================================================== */

const HERO_FIELDS = [
  'Overview', 'Genres', 'ProductionYear', 'OfficialRating',
  'RunTimeTicks', 'UserData', 'MediaSources', 'Taglines',
].join(',');

const Hero = {
  node: null,
  host: null,
  _building: false,
  slides: [],
  index: 0,
  timer: null,
  built: false,

  start() {
    Pages.on(safe((page) => {
      const isHome = Pages.route() === 'home';
      if (!isHome || Settings.get('hero') !== 'on' || !Api.isSignedIn()) {
        this.teardown();
        return;
      }
      this.build(page);
    }, 'hero page'));

    document.addEventListener('jellyhulu:settingchange', safe((e) => {
      const name = e.detail && e.detail.name;
      if (name === 'hero' || name === '*') {
        this.teardown();
        if (Pages.route() === 'home' && Settings.get('hero') === 'on') {
          this.build(Pages.current());
        }
      }
    }, 'hero setting'));

    // Pause while the tab is hidden — a background carousel burns cycles and,
    // with previews on, bandwidth.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
      else this.resume();
    });
  },

  async build(page) {
    if (!page) return;

    // One navigation fires the page lifecycle several times — viewshow,
    // hashchange, and the mutation observer all land for a single move. This
    // method awaits an API call in the middle, so a check that only runs
    // before the await does not prevent a second build starting inside that
    // window: both pass, both insert, and the page ends up with two heroes.
    // Worse, each build overwrites node/slides/timer, so only the last one
    // ever ticks and the others sit frozen in the DOM.
    //
    // The flag is set synchronously, before any await, which is what makes it
    // an actual mutex rather than another racy check.
    if (this._building) return;
    if (this.node && document.contains(this.node)) return;

    this._building = true;
    try {
      const anchor = $('.homeSectionsContainer', page) ||
                     $('.sections', page) ||
                     $('.homeSectionsContainer') ||
                     page;
      if (!anchor || $('.jh-hero')) return;

      let items;
      try {
        items = await this.fetchItems();
      } catch (err) {
        warn('hero fetch failed', err);
        return;
      }
      if (!items || !items.length) return;

      // Re-check everything that could have changed while we were waiting:
      // the route may have moved on, and another hero may have appeared.
      if (Pages.route() !== 'home') return;
      if (!document.contains(anchor)) return;
      if ($('.jh-hero')) return;

      const hero = this.render(items);
      anchor.insertBefore(hero, anchor.firstChild);

      this.node = hero;
      this.host = page;
      page.classList.add('jh-has-hero');
      this.slides = $$('.jh-hero-slide', hero);
      this.index = 0;
      this.built = true;

      this.wire();
      this.show(0);
      this.resume();

      Chrome.updateHeaderMode();
    } finally {
      this._building = false;
    }
  },

  async fetchItems() {
    const uid = Api.userId();
    const limit = 6;
    const common = {
      Limit: limit,
      Fields: HERO_FIELDS,
      ImageTypeLimit: 1,
      EnableImageTypes: 'Backdrop,Logo,Thumb,Primary',
      EnableTotalRecordCount: false,
    };

    // Three independent requests; a failure in any one must not lose the
    // others, so they're settled rather than raced.
    const results = await Promise.allSettled([
      Api.get('Users/' + uid + '/Items/Resume',
        Object.assign({ MediaTypes: 'Video', Recursive: true }, common)),
      Api.get('Shows/NextUp',
        Object.assign({ UserId: uid }, common)),
      Api.get('Users/' + uid + '/Items/Latest',
        Object.assign({ IncludeItemTypes: 'Movie,Series' }, common)),
    ]);

    const seen = new Set();
    const out = [];
    const labels = ['Continue Watching', 'Next Up', 'Recently Added'];

    results.forEach((result, i) => {
      if (result.status !== 'fulfilled' || !result.value) return;
      const list = Array.isArray(result.value) ? result.value : (result.value.Items || []);
      list.forEach((item) => {
        if (!item || !item.Id || seen.has(item.Id)) return;
        // A hero slide without a backdrop is a grey box — skip it.
        if (!this.backdropFor(item)) return;
        seen.add(item.Id);
        out.push({ item, label: labels[i] });
      });
    });

    return out.slice(0, limit);
  },

  /* ------------------------------------------------------------------------
     Image resolution.
     Episodes carry their series' artwork rather than their own, so the owner
     of each image type has to be resolved per item.
     ------------------------------------------------------------------------ */
  backdropFor(item) {
    if (item.BackdropImageTags && item.BackdropImageTags.length) {
      return Api.imageUrl(item.Id, {
        type: 'Backdrop', maxWidth: 1920, tag: item.BackdropImageTags[0],
      });
    }
    if (item.ParentBackdropItemId && item.ParentBackdropImageTags &&
        item.ParentBackdropImageTags.length) {
      return Api.imageUrl(item.ParentBackdropItemId, {
        type: 'Backdrop', maxWidth: 1920, tag: item.ParentBackdropImageTags[0],
      });
    }
    if (item.SeriesId && item.SeriesPrimaryImageTag) {
      return Api.imageUrl(item.SeriesId, { type: 'Backdrop', maxWidth: 1920 });
    }
    return null;
  },

  logoFor(item) {
    if (item.ImageTags && item.ImageTags.Logo) {
      return Api.imageUrl(item.Id, { type: 'Logo', maxHeight: 220, tag: item.ImageTags.Logo });
    }
    if (item.ParentLogoItemId && item.ParentLogoImageTag) {
      return Api.imageUrl(item.ParentLogoItemId, {
        type: 'Logo', maxHeight: 220, tag: item.ParentLogoImageTag,
      });
    }
    return null;
  },

  titleFor(item) {
    if (item.Type === 'Episode' && item.SeriesName) return item.SeriesName;
    return item.Name || '';
  },

  subtitleFor(item) {
    if (item.Type === 'Episode') {
      const s = item.ParentIndexNumber;
      const e = item.IndexNumber;
      const code = (s != null && e != null) ? `S${s} E${e}` : '';
      return [code, item.Name].filter(Boolean).join(' · ');
    }
    return item.Taglines && item.Taglines.length ? item.Taglines[0] : '';
  },

  metaFor(item) {
    const bits = [];
    if (item.ProductionYear) bits.push(String(item.ProductionYear));
    if (item.RunTimeTicks) bits.push(formatRuntime(item.RunTimeTicks));
    if (item.Genres && item.Genres.length) bits.push(item.Genres.slice(0, 2).join(', '));
    return bits;
  },

  progressFor(item) {
    const pct = item.UserData && item.UserData.PlayedPercentage;
    return (typeof pct === 'number' && pct > 0 && pct < 99) ? pct : null;
  },

  /* ------------------------------------------------------------------------
     Rendering
     ------------------------------------------------------------------------ */
  render(entries) {
    const slides = entries.map((entry, i) => this.renderSlide(entry, i));

    const dots = entries.length > 1
      ? el('div', { class: 'jh-hero-dots', role: 'tablist', 'aria-label': 'Featured titles' },
          entries.map((entry, i) => el('button', {
            class: 'jh-hero-dot' + (i === 0 ? ' is-active' : ''),
            type: 'button',
            role: 'tab',
            'aria-selected': i === 0 ? 'true' : 'false',
            'aria-label': this.titleFor(entry.item),
            'data-index': i,
          }, [el('i')])))
      : null;

    return el('section', {
      class: 'jh-hero',
      'aria-roledescription': 'carousel',
      'aria-label': 'Featured',
    }, [
      el('div', { class: 'jh-hero-slides' }, slides),
      dots,
      entries.length > 1 ? el('button', {
        class: 'jh-hero-nav jh-hero-prev', type: 'button', 'aria-label': 'Previous', html: '&#8249;',
      }) : null,
      entries.length > 1 ? el('button', {
        class: 'jh-hero-nav jh-hero-next', type: 'button', 'aria-label': 'Next', html: '&#8250;',
      }) : null,
    ]);
  },

  renderSlide(entry, i) {
    const item = entry.item;
    const logo = this.logoFor(item);
    const title = this.titleFor(item);
    const sub = this.subtitleFor(item);
    const meta = this.metaFor(item);
    const pct = this.progressFor(item);

    const content = [];

    content.push(el('p', { class: 'jh-eyebrow jh-hero-eyebrow', text: entry.label }));

    if (logo) {
      content.push(el('img', {
        class: 'jh-hero-logo', src: logo, alt: title, loading: i === 0 ? 'eager' : 'lazy',
      }));
    } else {
      content.push(el('h2', { class: 'jh-hero-title', text: title }));
    }

    const metaRow = el('div', { class: 'jh-hero-meta' }, [
      sub ? el('span', { text: sub }) : null,
      item.OfficialRating ? el('span', { class: 'jh-hero-rating', text: item.OfficialRating }) : null,
    ].concat(meta.map((m) => el('span', { text: m }))));
    content.push(metaRow);

    if (item.Overview) {
      content.push(el('p', { class: 'jh-hero-overview', text: item.Overview }));
    }

    content.push(el('div', { class: 'jh-hero-actions' }, [
      el('button', {
        class: 'jh-btn jh-btn-primary',
        type: 'button',
        'data-jh-play': item.Id,
        text: pct != null ? 'Resume' : 'Play',
      }),
      el('a', {
        class: 'jh-btn jh-btn-ghost',
        href: '#/details?id=' + encodeURIComponent(item.Id),
        text: 'More info',
      }),
    ]));

    if (pct != null) {
      content.push(el('div', {
        class: 'jh-hero-progress',
        role: 'progressbar',
        'aria-valuenow': Math.round(pct),
        'aria-valuemin': '0',
        'aria-valuemax': '100',
      }, [el('i', { style: { '--jh-pct': pct + '%' } })]));
    }

    return el('article', {
      class: 'jh-hero-slide' + (i === 0 ? ' is-active' : ''),
      role: 'tabpanel',
      'data-item-id': item.Id,
      'aria-hidden': i === 0 ? 'false' : 'true',
    }, [
      el('div', { class: 'jh-hero-media' }, [
        el('img', {
          class: 'jh-hero-backdrop',
          src: this.backdropFor(item),
          alt: '',
          loading: i === 0 ? 'eager' : 'lazy',
          decoding: 'async',
        }),
      ]),
      el('div', { class: 'jh-hero-scrim' }),
      el('div', { class: 'jh-hero-content' }, content),
    ]);
  },

  /* ------------------------------------------------------------------------
     Behaviour
     ------------------------------------------------------------------------ */
  wire() {
    const hero = this.node;
    if (!hero) return;

    hero.addEventListener('click', safe((e) => {
      const dot = e.target.closest('.jh-hero-dot');
      if (dot) { this.show(Number(dot.dataset.index)); this.restart(); return; }

      if (e.target.closest('.jh-hero-prev')) { this.step(-1); this.restart(); return; }
      if (e.target.closest('.jh-hero-next')) { this.step(1); this.restart(); return; }

      const play = e.target.closest('[data-jh-play]');
      if (play) { e.preventDefault(); playItem(play.getAttribute('data-jh-play')); }
    }, 'hero click'));

    // Hovering or focusing the hero holds the current slide — nothing is more
    // annoying than a carousel that advances while you're reading it.
    hero.addEventListener('mouseenter', () => this.pause());
    hero.addEventListener('mouseleave', () => this.resume());
    hero.addEventListener('focusin', () => this.pause());
    hero.addEventListener('focusout', (e) => {
      if (!hero.contains(e.relatedTarget)) this.resume();
    });

    hero.addEventListener('keydown', safe((e) => {
      if (e.key === 'ArrowLeft')  { this.step(-1); this.restart(); }
      if (e.key === 'ArrowRight') { this.step(1);  this.restart(); }
    }, 'hero keys'));
  },

  show(i) {
    if (!this.slides.length) return;
    const next = ((i % this.slides.length) + this.slides.length) % this.slides.length;

    this.slides.forEach((slide, n) => {
      const active = n === next;
      slide.classList.toggle('is-active', active);
      slide.setAttribute('aria-hidden', active ? 'false' : 'true');
    });

    $$('.jh-hero-dot', this.node).forEach((dot, n) => {
      const active = n === next;
      dot.classList.toggle('is-active', active);
      dot.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    this.index = next;
  },

  step(delta) { this.show(this.index + delta); },

  resume() {
    if (!this.node || this.slides.length < 2) return;
    if (document.hidden) return;
    this.pause();
    this.node.classList.remove('is-paused');
    const dwell = (Number(Settings.get('heroDwell')) || 9) * 1000;
    this.timer = setInterval(safe(() => this.step(1), 'hero tick'), dwell);
  },

  pause() {
    if (this.node) this.node.classList.add('is-paused');
    clearInterval(this.timer);
    this.timer = null;
  },

  restart() { this.resume(); },

  teardown() {
    this.pause();
    // Every hero, not just the tracked one: an orphan left by an earlier
    // build would otherwise stay on the page forever, since nothing else
    // holds a reference to it.
    $$('.jh-hero').forEach((n) => n.parentNode && n.parentNode.removeChild(n));
    $$('.jh-has-hero').forEach((n) => n.classList.remove('jh-has-hero'));
    this.node = null;
    this.host = null;
    this.slides = [];
    this.built = false;
  },
};

/* --------------------------------------------------------------------------
   Playback.
   jellyfin-web does not expose its playbackManager as a stable global, so
   this uses it when present and otherwise navigates to the item and presses
   the page's own Play button once it renders. The fallback keeps the hero's
   Play button honest across versions that don't expose the manager.
   -------------------------------------------------------------------------- */
function playItem(itemId) {
  if (!itemId) return;

  const pm = window.playbackManager;
  if (pm && typeof pm.play === 'function') {
    try {
      pm.play({ ids: [itemId], serverId: Api.client() && Api.client().serverId() });
      return;
    } catch (err) {
      warn('playbackManager.play failed, falling back to navigation', err);
    }
  }

  const target = '#/details?id=' + encodeURIComponent(itemId);
  const pressPlay = () => {
    const btn = $('.mainDetailButtons .btnPlay') ||
                $('.mainDetailButtons .btnResume') ||
                $('.mainDetailButtons .detailButton');
    if (btn) btn.click();
  };

  if (location.hash === target) {
    pressPlay();
  } else {
    // Fire once, after the details page has actually rendered its buttons.
    const observer = new MutationObserver(debounce(() => {
      if (Pages.route() !== 'details') return;
      const btn = $('.mainDetailButtons .btnPlay') || $('.mainDetailButtons .detailButton');
      if (btn) { observer.disconnect(); btn.click(); }
    }, 120));
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 8000);
    location.hash = target;
  }
}

function formatRuntime(ticks) {
  const totalMinutes = Math.round(ticks / 600000000);
  if (!totalMinutes) return '';
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/* ── 30-cards.js ─────────────────────────────────────────────────── */
/* ==========================================================================
   JellyHulu — card enhancements
   Badges, the in-card metadata block, and hover previews.

   Preview strategy, in order of preference:
     1. A local trailer, streamed directly. Best fidelity when the library
        has trailers alongside the media.
     2. Trickplay tiles, animated as a sprite. Jellyfin generates these for
        scrub previews; reusing them costs one already-cached JPEG and works
        for every item that has them — no transcode, no extra bandwidth per
        second of hover.
     3. Nothing. The card keeps its still and its hover-expand.

   All of it is lazy: nothing is requested until a pointer has rested on a
   card past the delay, and everything is cached per item for the session.
   ========================================================================== */

const PREVIEW_CACHE = new Map();

const Cards = {
  hoverTimer: null,
  activeCard: null,
  observer: null,

  start() {
    Pages.on(safe(() => {
      this.enhanceVisible();
      this.watch();
    }, 'cards page'));

    this.bindHover();
  },

  /* ------------------------------------------------------------------------
     Enhancement is applied lazily, as cards scroll into view. On a 5,000
     item grid, enhancing everything up front would be thousands of DOM
     writes for cards nobody will ever look at.
     ------------------------------------------------------------------------ */
  watch() {
    if (this.observer) this.observer.disconnect();

    if (!('IntersectionObserver' in window)) {
      // Very old browser: enhance what's there and stop.
      this.enhanceVisible();
      return;
    }

    this.observer = new IntersectionObserver(safe((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        this.enhance(entry.target);
        this.observer.unobserve(entry.target);
      });
    }, 'card observer'), { rootMargin: '200px' });

    const attach = debounce(safe(() => {
      $$('.card:not([data-jh-enhanced])').forEach((card) => this.observer.observe(card));
    }, 'card attach'), 150);

    attach();

    // Jellyfin appends cards as you page through a library; watch for them.
    const host = $('.mainAnimatedPages') || document.body;
    if (this._domObserver) this._domObserver.disconnect();
    this._domObserver = new MutationObserver(attach);
    this._domObserver.observe(host, { childList: true, subtree: true });
  },

  enhanceVisible() {
    $$('.card:not([data-jh-enhanced])').slice(0, 60).forEach((card) => this.enhance(card));
  },

  enhance(card) {
    if (!card || card.hasAttribute('data-jh-enhanced')) return;
    card.setAttribute('data-jh-enhanced', '1');

    this.addBadges(card);
    this.addInfo(card);
  },

  /* ------------------------------------------------------------------------
     Badges
     Derived from the rail the card sits in rather than from extra API calls
     — the section heading already tells us what the rail means.
     ------------------------------------------------------------------------ */
  addBadges(card) {
    const section = card.closest('.verticalSection, .jh-rail');
    if (!section) return;

    const titleNode = $('.sectionTitle', section);
    const title = (titleNode ? titleNode.textContent : '').toLowerCase();
    const frame = $('.cardScalable', card);
    if (!frame) return;

    const isRanked = /top\s*10|most\s*watched|trending|popular/.test(title);
    const isNew = /recently added|latest|new (releases|this week)/.test(title);

    if (isRanked) {
      const siblings = $$('.card', section);
      const rank = siblings.indexOf(card) + 1;
      if (rank >= 1 && rank <= 10) {
        section.classList.add('jh-rail-top10');
        frame.appendChild(el('span', {
          class: 'jh-badge-top10', 'aria-hidden': 'true', text: String(rank),
        }));
        // The rank is decorative in the DOM but real information, so it also
        // goes to assistive tech.
        card.appendChild(el('span', { class: 'jh-sr-only', text: 'Ranked number ' + rank }));
      }
    } else if (isNew) {
      frame.appendChild(el('span', {
        class: 'jh-badge jh-badge-new jh-badge-corner', text: 'New',
      }));
    }
  },

  /* ------------------------------------------------------------------------
     In-card metadata.
     Reuses the text Jellyfin already rendered beneath the card, so this adds
     no requests at all.
     ------------------------------------------------------------------------ */
  addInfo(card) {
    const frame = $('.cardScalable', card);
    if (!frame || $('.jh-card-info', card)) return;

    const texts = $$('.cardText', card).map((n) => n.textContent.trim()).filter(Boolean);
    if (!texts.length) return;

    const itemId = card.getAttribute('data-id');

    const info = el('div', { class: 'jh-card-info' }, [
      el('div', { class: 'jh-card-info-title', text: texts[0] }),
      texts[1] ? el('div', { class: 'jh-card-info-meta' }, [el('span', { text: texts[1] })]) : null,
      itemId ? el('div', { class: 'jh-card-info-actions' }, [
        el('button', {
          class: 'jh-btn-icon', type: 'button', 'data-jh-play': itemId,
          'aria-label': 'Play ' + texts[0], html: '&#9654;',
        }),
      ]) : null,
    ]);

    frame.appendChild(info);
  },

  /* ------------------------------------------------------------------------
     Hover previews
     ------------------------------------------------------------------------ */
  bindHover() {
    document.addEventListener('click', safe((e) => {
      const play = e.target.closest('.jh-card-info [data-jh-play]');
      if (!play) return;
      e.preventDefault();
      e.stopPropagation();
      playItem(play.getAttribute('data-jh-play'));
    }, 'card play'), true);

    document.addEventListener('pointerover', safe((e) => {
      if (e.pointerType === 'touch') return;
      const card = e.target.closest && e.target.closest('.card');
      if (!card || card === this.activeCard) return;
      this.leave();
      this.enter(card);
    }, 'card pointerover'), { passive: true });

    document.addEventListener('pointerout', safe((e) => {
      const card = e.target.closest && e.target.closest('.card');
      if (!card) return;
      // Ignore moves between children of the same card.
      if (e.relatedTarget && card.contains(e.relatedTarget)) return;
      if (card === this.activeCard) this.leave();
    }, 'card pointerout'), { passive: true });

    // Keyboard/remote users get previews too, on the same delay.
    document.addEventListener('focusin', safe((e) => {
      const card = e.target.closest && e.target.closest('.card');
      if (!card || card === this.activeCard) return;
      this.leave();
      this.enter(card);
    }, 'card focusin'));
  },

  previewsEnabled() {
    if (Settings.get('previews') !== 'on') return false;
    if (Settings.get('motion') === 'off') return false;
    if (document.documentElement.getAttribute('data-jh-power') === 'low') return false;
    const root = getComputedStyle(document.documentElement);
    return root.getPropertyValue('--jh-preview-display').trim() !== 'none';
  },

  enter(card) {
    this.activeCard = card;
    if (!this.previewsEnabled()) return;

    const itemId = card.getAttribute('data-id');
    if (!itemId || !Api.isSignedIn()) return;

    const delay = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--jh-preview-delay'), 10
    ) || 900;

    clearTimeout(this.hoverTimer);
    this.hoverTimer = setTimeout(safe(() => {
      if (this.activeCard !== card) return;
      this.startPreview(card, itemId);
    }, 'preview start'), delay);
  },

  leave() {
    clearTimeout(this.hoverTimer);
    if (this.activeCard) this.stopPreview(this.activeCard);
    this.activeCard = null;
  },

  async startPreview(card, itemId) {
    let preview = PREVIEW_CACHE.get(itemId);

    if (preview === undefined) {
      preview = null;
      try {
        preview = await resolvePreview(itemId);
      } catch (err) {
        warn('preview resolve failed for ' + itemId, err);
      }
      PREVIEW_CACHE.set(itemId, preview);
    }

    // Pointer moved on while we were resolving.
    if (!preview || this.activeCard !== card) return;

    const frame = $('.cardScalable', card);
    if (!frame) return;

    if (preview.kind === 'video') {
      this.mountVideo(card, frame, preview);
    } else if (preview.kind === 'trickplay') {
      this.mountTrickplay(card, frame, preview);
    }
  },

  mountVideo(card, frame, preview) {
    // startPreview awaits a lookup, and its post-await guard only checks that
    // the pointer is still on this card — which is also true if you left and
    // came back while it waited. Two mounts would then both proceed, and only
    // the last is tracked, leaving the first playing invisibly forever.
    // Tearing down first makes mounting idempotent.
    this.stopPreview(card);

    const video = el('video', {
      class: 'jh-card-preview',
      muted: true,
      loop: true,
      playsinline: true,
      preload: 'none',
      'aria-hidden': 'true',
      tabindex: '-1',
    });
    video.muted = true;          // the attribute alone isn't enough in Safari
    video.src = preview.url;

    // If the container can't be decoded in-browser, fall back rather than
    // leaving a black rectangle over the artwork.
    video.addEventListener('error', safe(() => {
      PREVIEW_CACHE.set(preview.itemId, preview.fallback || null);
      this.stopPreview(card);
      if (preview.fallback && this.activeCard === card) {
        this.mountTrickplay(card, frame, preview.fallback);
      }
    }, 'preview video error'), { once: true });

    video.addEventListener('playing', () => {
      card.classList.add('jh-preview-playing');
    }, { once: true });

    frame.appendChild(video);
    card._jhPreview = video;

    const play = video.play();
    if (play && typeof play.catch === 'function') {
      play.catch(() => { /* autoplay blocked — the still stays, which is fine */ });
    }
  },

  /* Animates Jellyfin's trickplay tile sheet as a flipbook. One image
     request, no transcoding, and it works on every item that has scrub
     previews generated. */
  mountTrickplay(card, frame, preview) {
    this.stopPreview(card);   // idempotent, for the reason in mountVideo

    const layer = el('div', { class: 'jh-card-preview', 'aria-hidden': 'true' });
    const info = preview.info;

    // Trickplay thumbnails are 16:9; a poster tile is 2:3. Scaling to fit the
    // width would leave two thirds of a portrait card showing the artwork
    // underneath, so this covers instead — scale by whichever axis needs more,
    // and centre the overflow.
    const boxW = frame.clientWidth;
    const boxH = frame.clientHeight;
    if (!boxW || !boxH) return;
    const scale = Math.max(boxW / info.Width, boxH / info.Height);

    Object.assign(layer.style, {
      backgroundImage: 'url("' + preview.sheetUrl(0) + '")',
      backgroundSize: (info.TileWidth * info.Width) + 'px ' +
                      (info.TileHeight * info.Height) + 'px',
      backgroundRepeat: 'no-repeat',
      width: info.Width + 'px',
      height: info.Height + 'px',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%) scale(' + scale + ')',
      transformOrigin: 'center center',
    });

    frame.appendChild(layer);
    card.classList.add('jh-preview-playing');

    const perSheet = info.TileWidth * info.TileHeight;
    // Start a little way in — the first frames of a title are usually logos
    // and black — and run through the first third.
    let n = Math.floor(info.ThumbnailCount * 0.10);
    const last = Math.floor(info.ThumbnailCount * 0.45);
    let sheet = -1;

    const tick = safe(() => {
      if (n > last) n = Math.floor(info.ThumbnailCount * 0.10);

      const wantSheet = Math.floor(n / perSheet);
      if (wantSheet !== sheet) {
        sheet = wantSheet;
        layer.style.backgroundImage = 'url("' + preview.sheetUrl(sheet) + '")';
      }

      const pos = n % perSheet;
      const col = pos % info.TileWidth;
      const row = Math.floor(pos / info.TileWidth);
      layer.style.backgroundPosition = (-col * info.Width) + 'px ' + (-row * info.Height) + 'px';

      n += 1;
    }, 'trickplay tick');

    tick();
    card._jhPreview = layer;
    card._jhPreviewTimer = setInterval(tick, 220);
  },

  stopPreview(card) {
    if (!card) return;
    card.classList.remove('jh-preview-playing');

    clearInterval(card._jhPreviewTimer);
    card._jhPreviewTimer = null;

    const node = card._jhPreview;
    if (node) {
      if (node.tagName === 'VIDEO') {
        try { node.pause(); node.removeAttribute('src'); node.load(); } catch (_) {}
      }
      if (node.parentNode) node.parentNode.removeChild(node);
    }
    card._jhPreview = null;
  },
};

/* --------------------------------------------------------------------------
   Preview resolution
   One request per item, cached for the session.
   -------------------------------------------------------------------------- */
async function resolvePreview(itemId) {
  const uid = Api.userId();
  if (!uid) return null;

  const item = await Api.get('Users/' + uid + '/Items/' + itemId, {
    Fields: 'Trickplay,MediaSources,LocalTrailerCount',
  });
  if (!item) return null;

  const trickplay = buildTrickplayPreview(item);

  if (item.LocalTrailerCount > 0) {
    try {
      const trailers = await Api.get('Users/' + uid + '/Items/' + itemId + '/LocalTrailers');
      const trailer = Array.isArray(trailers) ? trailers[0] : null;
      if (trailer && trailer.Id) {
        const url = Api.videoUrl(trailer.Id);
        if (url) {
          return { kind: 'video', url, itemId, fallback: trickplay };
        }
      }
    } catch (err) {
      warn('local trailer lookup failed', err);
    }
  }

  return trickplay;
}

/* Jellyfin exposes trickplay as
     item.Trickplay = { <mediaSourceId>: { <width>: { Width, Height,
       TileWidth, TileHeight, ThumbnailCount, Interval, ... } } }
   Widths are strings; the smallest one is plenty for a card. */
function buildTrickplayPreview(item) {
  const sets = item.Trickplay;
  if (!sets || typeof sets !== 'object') return null;

  const sourceIds = Object.keys(sets);
  if (!sourceIds.length) return null;

  const bySize = sets[sourceIds[0]];
  if (!bySize || typeof bySize !== 'object') return null;

  const widths = Object.keys(bySize)
    .map(Number)
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
  if (!widths.length) return null;

  const width = widths[0];
  const info = bySize[String(width)];
  if (!info || !info.ThumbnailCount || !info.TileWidth || !info.TileHeight) return null;

  const client = Api.client();
  if (!client) return null;

  return {
    kind: 'trickplay',
    itemId: item.Id,
    info,
    sheetUrl(index) {
      return client.getUrl(
        'Videos/' + item.Id + '/Trickplay/' + width + '/' + index + '.jpg',
        { api_key: client.accessToken() }
      );
    },
  };
}

/* ── 40-settings.js ──────────────────────────────────────────────── */
/* ==========================================================================
   JellyHulu — settings panel
   A per-user panel opened from a button in Jellyfin's own header. Settings
   are written to <html> attributes and the CSS does the rest, so every
   change is instant and none of it touches Jellyfin's components.
   ========================================================================== */

const ACCENTS = [
  { value: '#1CE783', label: 'Hulu green' },
  { value: '#00E0FF', label: 'Cyan' },
  { value: '#FF4D8D', label: 'Magenta' },
  { value: '#FFB020', label: 'Amber' },
  { value: '#8B7CFF', label: 'Violet' },
  { value: '#FF5C39', label: 'Ember' },
  { value: '#FFFFFF', label: 'Mono' },
];

const Panel = {
  node: null,

  start() {
    this.injectLauncher();

    Pages.on(safe(() => this.injectLauncher(), 'panel launcher'));

    document.addEventListener('keydown', safe((e) => {
      if (e.key === 'Escape' && this.isOpen()) this.close();
    }, 'panel esc'));
  },

  /* ------------------------------------------------------------------------
     Launcher button, placed alongside Jellyfin's own header buttons.
     ------------------------------------------------------------------------ */
  injectLauncher() {
    const host = $('.headerRight');
    if (!host || $('.jh-settings-button', host)) return;

    const button = el('button', {
      class: 'paper-icon-button-light jh-settings-button',
      type: 'button',
      title: 'JellyHulu theme settings',
      'aria-label': 'JellyHulu theme settings',
      onClick: safe(() => this.toggle(), 'panel toggle'),
    }, [
      el('span', { class: 'material-icons', 'aria-hidden': 'true', text: 'tune' }),
    ]);

    // Before the user avatar so it doesn't displace the most-used control.
    const avatar = $('.headerUserButton', host);
    if (avatar) host.insertBefore(button, avatar);
    else host.appendChild(button);
  },

  isOpen() { return !!(this.node && this.node.classList.contains('is-open')); },

  toggle() { this.isOpen() ? this.close() : this.open(); },

  open() {
    if (!this.node) this.build();
    this.node.hidden = false;
    // One frame so the transition has a starting state to animate from.
    requestAnimationFrame(() => {
      this.node.classList.add('is-open');
      const first = $('.jh-seg-item, .jh-swatch, .jh-switch', this.node);
      if (first) first.focus();
    });
    const btn = $('.jh-settings-button');
    if (btn) btn.classList.add('is-open');
  },

  close() {
    if (!this.node) return;
    this.node.classList.remove('is-open');
    const btn = $('.jh-settings-button');
    if (btn) { btn.classList.remove('is-open'); btn.focus(); }
    setTimeout(() => { if (this.node && !this.isOpen()) this.node.hidden = true; }, 260);
  },

  /* ------------------------------------------------------------------------
     Control factories
     ------------------------------------------------------------------------ */
  segmented(name, label, hint, options) {
    const current = Settings.get(name);
    const group = el('div', { class: 'jh-seg', role: 'radiogroup', 'aria-label': label },
      options.map((opt) => el('button', {
        class: 'jh-seg-item' + (opt.value === current ? ' is-active' : ''),
        type: 'button',
        role: 'radio',
        'aria-checked': opt.value === current ? 'true' : 'false',
        'data-value': opt.value,
        text: opt.label,
        onClick: safe(function () {
          Settings.set(name, opt.value);
          $$('.jh-seg-item', group).forEach((b) => {
            const on = b === this;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-checked', on ? 'true' : 'false');
          });
        }, 'seg ' + name),
      })));

    return el('div', { class: 'jh-field' }, [
      el('div', { class: 'jh-field-label', text: label }),
      hint ? el('p', { class: 'jh-field-hint', text: hint }) : null,
      group,
    ]);
  },

  toggleField(name, label, hint) {
    const on = Settings.get(name) === 'on';
    const sw = el('button', {
      class: 'jh-switch',
      type: 'button',
      role: 'switch',
      'aria-checked': on ? 'true' : 'false',
      'aria-label': label,
      onClick: safe(function () {
        const next = this.getAttribute('aria-checked') !== 'true';
        this.setAttribute('aria-checked', next ? 'true' : 'false');
        Settings.set(name, next ? 'on' : 'off');
      }, 'switch ' + name),
    }, [el('i')]);

    return el('div', { class: 'jh-field jh-field-row' }, [
      el('div', {}, [
        el('div', { class: 'jh-field-label', text: label }),
        hint ? el('p', { class: 'jh-field-hint', text: hint }) : null,
      ]),
      sw,
    ]);
  },

  swatches() {
    const current = Settings.get('accent');
    const row = el('div', { class: 'jh-swatches' },
      ACCENTS.map((accent) => el('button', {
        class: 'jh-swatch' + (accent.value.toLowerCase() === String(current).toLowerCase() ? ' is-active' : ''),
        type: 'button',
        'aria-label': accent.label,
        'data-value': accent.value,
        style: { '--jh-swatch-color': accent.value },
        onClick: safe(function () {
          Settings.set('accent', accent.value);
          $$('.jh-swatch', row).forEach((b) => b.classList.toggle('is-active', b === this));
        }, 'swatch'),
      })));
    return row;
  },

  /* ------------------------------------------------------------------------
     Panel construction
     ------------------------------------------------------------------------ */
  build() {
    const body = el('div', { class: 'jh-settings-body' }, [
      el('section', { class: 'jh-settings-group' }, [
        el('h3', { class: 'jh-settings-group-title', text: 'Accent' }),
        this.swatches(),
      ]),

      el('section', { class: 'jh-settings-group' }, [
        el('h3', { class: 'jh-settings-group-title', text: 'Layout' }),
        this.segmented('density', 'Card density',
          'How much fits on screen before you have to scroll.', [
            { value: 'compact', label: 'Compact' },
            { value: 'comfortable', label: 'Comfy' },
            { value: 'cinematic', label: 'Cinematic' },
          ]),
        this.toggleField('hero', 'Featured carousel',
          'A full-width hero on the home page, built from what you were watching.'),
        this.toggleField('badges', 'Rank & new badges',
          'Top 10 numerals and "New" flags on rails that have them.'),
      ]),

      el('section', { class: 'jh-settings-group' }, [
        el('h3', { class: 'jh-settings-group-title', text: 'Motion' }),
        this.segmented('motion', 'Animation',
          'Subtle keeps hover states but shortens everything.', [
            { value: 'full', label: 'Full' },
            { value: 'subtle', label: 'Subtle' },
            { value: 'off', label: 'Off' },
          ]),
        this.toggleField('previews', 'Hover previews',
          'Plays a muted trailer, or animates scrub thumbnails, after you rest on a card.'),
      ]),

      el('section', { class: 'jh-settings-group' }, [
        el('h3', { class: 'jh-settings-group-title', text: 'Display' }),
        this.segmented('tv', 'TV mode',
          'Bigger type and unmissable focus rings for a remote.', [
            { value: 'auto', label: 'Auto' },
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ]),
        this.segmented('power', 'Effects',
          'Low drops blur and shadows on weaker devices.', [
            { value: 'auto', label: 'Auto' },
            { value: 'low', label: 'Low' },
          ]),
        this.segmented('contrast', 'Contrast', null, [
          { value: 'normal', label: 'Normal' },
          { value: 'high', label: 'High' },
        ]),
      ]),
    ]);

    const panel = el('div', {
      class: 'jh-settings-panel',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'jh-settings-title',
    }, [
      el('header', { class: 'jh-settings-header' }, [
        el('h2', { class: 'jh-settings-title', id: 'jh-settings-title', text: 'JellyHulu' }),
        el('button', {
          class: 'paper-icon-button-light',
          type: 'button',
          'aria-label': 'Close settings',
          html: '&times;',
          onClick: safe(() => this.close(), 'panel close'),
        }),
      ]),
      body,
      el('footer', { class: 'jh-settings-footer' }, [
        el('span', { class: 'jh-settings-version', text: 'v' + JH.version }),
        el('button', {
          class: 'jh-btn jh-btn-flat',
          type: 'button',
          text: 'Reset',
          onClick: safe(() => { Settings.reset(); this.rebuild(); }, 'panel reset'),
        }),
      ]),
    ]);

    const overlay = el('div', { class: 'jh-settings-overlay', hidden: true }, [panel]);

    overlay.addEventListener('click', safe((e) => {
      if (e.target === overlay) this.close();
    }, 'panel scrim'));

    // Keep focus inside the panel while it's modal.
    overlay.addEventListener('keydown', safe((e) => {
      if (e.key !== 'Tab') return;
      const focusable = $$('button, [href], input, select, [tabindex]:not([tabindex="-1"])', panel)
        .filter((n) => !n.disabled && n.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }, 'panel trap'));

    document.body.appendChild(overlay);
    this.node = overlay;
  },

  rebuild() {
    const wasOpen = this.isOpen();
    if (this.node && this.node.parentNode) this.node.parentNode.removeChild(this.node);
    this.node = null;
    if (wasOpen) this.open();
  },
};

/* ── 50-tv.js ────────────────────────────────────────────────────── */
/* ==========================================================================
   JellyHulu — TV mode
   Jellyfin sets html.layout-tv when it detects a TV client. That detection
   misses browsers on set-top boxes and game consoles, so this widens it, and
   adds the scroll-into-view behaviour a remote needs.
   ========================================================================== */

const Tv = {
  start() {
    this.detect();
    this.bindFocusScroll();
  },

  detect() {
    if (Settings.get('tv') !== 'auto') return;              // user decided
    if (document.documentElement.classList.contains('layout-tv')) return;  // Jellyfin decided

    const ua = navigator.userAgent || '';
    const looksLikeTv =
      /\b(SmartTV|SMART-TV|GoogleTV|Android *TV|AFT[BMNST]|BRAVIA|Tizen|Web0S|WebOS|NetCast|HbbTV|Viera|AppleTV|CrKey|PlayStation|Xbox)\b/i.test(ua) ||
      // A pointer-less, large, coarse display is a television by any other name.
      (window.matchMedia('(hover: none) and (pointer: coarse)').matches &&
       window.innerWidth >= 1280 && !/Mobi|Android(?!.*TV)|iPhone|iPad/i.test(ua));

    if (looksLikeTv) {
      document.documentElement.setAttribute('data-jh-tv', 'on');
      log('TV mode engaged automatically');
    }
  },

  isTv() {
    return document.documentElement.classList.contains('layout-tv') ||
           document.documentElement.getAttribute('data-jh-tv') === 'on';
  },

  /* ------------------------------------------------------------------------
     A remote moves focus; the browser's default scroll-into-view puts the
     focused card flush against the viewport edge, under the header. This
     centres it instead, horizontally within its rail and vertically in the
     page — which is what makes D-pad navigation feel considered.
     ------------------------------------------------------------------------ */
  bindFocusScroll() {
    document.addEventListener('focusin', rafThrottle(safe((e) => {
      if (!this.isTv()) return;

      const card = e.target.closest && e.target.closest('.card, .listItem, .programCell');
      if (!card) return;

      card.classList.add('jh-spatial-target');

      const rail = card.closest('.emby-scroller, .jh-rail-track, .scrollSlider');
      const behavior = Settings.get('motion') === 'off' ? 'auto' : 'smooth';

      if (rail && rail.scrollWidth > rail.clientWidth) {
        const railBox = rail.getBoundingClientRect();
        const cardBox = card.getBoundingClientRect();
        const delta = (cardBox.left - railBox.left) -
                      (railBox.width / 2 - cardBox.width / 2);
        rail.scrollBy({ left: delta, behavior });
      }

      card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior });
    }, 'tv focus scroll')));
  },
};

/* ── 60-a11y.js ──────────────────────────────────────────────────── */
/* ==========================================================================
   JellyHulu — accessibility additions
   Small things Jellyfin doesn't ship that matter once the header is sticky
   and the home page is mostly horizontal rails.
   ========================================================================== */

const A11y = {
  start() {
    this.skipLink();
    this.announceRoutes();
  },

  /* Without this, a keyboard user tabs through the entire header on every
     page load before reaching any content. */
  skipLink() {
    if ($('.jh-skip-link')) return;

    const link = el('a', {
      class: 'jh-skip-link',
      href: '#',
      text: 'Skip to content',
      onClick: safe((e) => {
        e.preventDefault();
        const target = $('.mainAnimatedPage:not(.hide)') || $('.mainAnimatedPages');
        if (!target) return;
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: false });
      }, 'skip link'),
    });

    document.body.insertBefore(link, document.body.firstChild);
  },

  /* A hash-routed SPA changes the whole page without telling a screen reader.
     A polite live region carrying the new page title fixes that. */
  announceRoutes() {
    const region = el('div', {
      class: 'jh-sr-only',
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
    });
    document.body.appendChild(region);

    Pages.on(debounce(safe(() => {
      const page = Pages.current();
      const title = ($('.pageTitle', page) || $('.sectionTitle', page) || {}).textContent;
      const name = (title || document.title || '').trim();
      if (name) region.textContent = name;
    }, 'announce'), 400));
  },
};

/* ── 99-boot.js ──────────────────────────────────────────────────── */
/* ==========================================================================
   JellyHulu — boot
   Order matters: settings are applied before anything reads them, and the
   modules that only enhance existing DOM start after the page lifecycle is
   listening.
   ========================================================================== */

function boot() {
  if (JH.ready) return;
  JH.ready = true;

  document.documentElement.classList.add('jellyhulu');
  document.documentElement.setAttribute('data-jellyhulu', JH.version);

  safe(() => Settings.apply(), 'settings apply')();
  safe(() => detectLowPower(), 'detect low power')();

  const modules = [
    ['chrome',   Chrome],
    ['snap',     Snap],
    ['tv',       Tv],
    ['a11y',     A11y],
    ['cards',    Cards],
    ['hero',     Hero],
    ['settings', Panel],
  ];

  modules.forEach(([name, mod]) => {
    safe(() => mod.start(), name)();
    JH.modules.push(name);
  });

  safe(() => Pages.start(), 'pages start')();

  // Fire once for whatever is already on screen.
  safe(() => Pages.emit(Pages.current()), 'initial emit')();

  // The API client appears after sign-in, so re-key the settings store and
  // let the hero try again once it does.
  if (!Api.isSignedIn()) {
    const waitForLogin = setInterval(safe(() => {
      if (!Api.isSignedIn()) return;
      clearInterval(waitForLogin);
      Settings._cache = null;
      Settings.apply();
      Pages.emit(Pages.current());
    }, 'login wait'), 1000);
    setTimeout(() => clearInterval(waitForLogin), 120000);
  }

  log('ready', JH.version, JH.modules.join(', '));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

// A small public surface, for users who want to script against the theme.
window.JellyHulu = {
  version: JH.version,
  settings: Settings,
  open() { Panel.open(); },
  close() { Panel.close(); },
  reset() { Settings.reset(); },
};


})();
