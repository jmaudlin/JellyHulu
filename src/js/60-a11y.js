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
