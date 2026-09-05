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
