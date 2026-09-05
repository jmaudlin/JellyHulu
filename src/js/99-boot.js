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
