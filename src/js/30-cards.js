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
