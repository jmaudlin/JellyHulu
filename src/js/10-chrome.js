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
