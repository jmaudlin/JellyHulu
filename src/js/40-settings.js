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
