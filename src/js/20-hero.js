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
    if (this.built && this.node && document.contains(this.node)) return;
    if (!page) return;

    // Only one hero, and only above the first section. The container's class
    // has moved between Jellyfin releases, so fall back progressively rather
    // than depending on one name.
    const anchor = $('.homeSectionsContainer', page) ||
                   $('.sections', page) ||
                   $('.homeSectionsContainer') ||
                   page;
    if (!anchor || $('.jh-hero', page)) return;

    let items = [];
    try {
      items = await this.fetchItems();
    } catch (err) {
      warn('hero fetch failed', err);
      return;
    }
    if (!items.length) return;

    // The page may have navigated away while we were fetching.
    if (Pages.route() !== 'home') return;

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
    if (this.node && this.node.parentNode) this.node.parentNode.removeChild(this.node);
    if (this.host) this.host.classList.remove('jh-has-hero');
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
