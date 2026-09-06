/* Drives the fixture in a real browser and asserts the companion script
   boots cleanly and does what it claims. */
import { chromium } from 'playwright';
import path from 'node:path';
import fs, { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

// Reads the single pixel out of a 1x1 PNG screenshot. Playwright hands back
// PNG bytes and there is no image decoder to hand, but a 1x1 image is one
// zlib stream holding a filter byte and one RGB triple, which is little
// enough to unpack directly.
function pixelOf(png) {
  // The image data can arrive split across several IDAT chunks; they are one
  // zlib stream between them, so they have to be joined before inflating.
  const parts = [];
  for (let off = 8; off + 8 <= png.length; ) {
    const len = png.readUInt32BE(off);
    const type = png.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') parts.push(png.subarray(off + 8, off + 8 + len));
    if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!parts.length) throw new Error('no IDAT in screenshot');
  const raw = zlib.inflateSync(Buffer.concat(parts));
  // byte 0 is the row filter; a 1px row cannot reference a neighbour, so
  // every filter type reduces to the raw value here.
  return { r: raw[1], g: raw[2], b: raw[3] };
}

const ROOT = path.dirname(fileURLToPath(import.meta.url));
/* Screenshots are test output, not documentation. They land in an ignored
   directory because browser rendering is not byte-deterministic — writing
   them next to tracked files meant every single test run dirtied the repo.
   The one the README embeds lives in docs/ and is regenerated deliberately. */
const OUT = path.join(ROOT, 'output');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || !detail ? '' : ' — ' + detail));
};

/* Some environments ship a Chromium build that doesn't match the revision
   Playwright pins. Use an explicit binary when one is actually present, and
   otherwise let Playwright pick its own — which is what CI wants. */
function chromiumPath() {
  const candidates = [
    process.env.JH_CHROME,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p));
}

const explicit = chromiumPath();
const ctx0 = (p, fn) => p.evaluate(fn);

const browser = await chromium.launch(explicit ? { executablePath: explicit } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleErrors = [];
const isFixtureNoise = (text) =>
  // The stub ApiClient hands out /fake/... image URLs that intentionally 404.
  /ERR_FILE_NOT_FOUND|\/fake\//.test(text);
page.on('console', (m) => {
  if (m.type() === 'error' && !isFixtureNoise(m.text())) consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

await page.goto('file://' + path.join(ROOT, 'fixture.html'));
await page.waitForTimeout(900);

// --- boot -------------------------------------------------------------
check('no console errors or uncaught exceptions',
  consoleErrors.length === 0, consoleErrors.join(' | '));

check('window.JellyHulu is exposed',
  await page.evaluate(() => !!(window.JellyHulu && window.JellyHulu.version)));

check('theme marker on <html>',
  await page.evaluate(() => document.documentElement.classList.contains('jellyhulu')));

check('settings projected as data attributes',
  await page.evaluate(() => document.documentElement.getAttribute('data-jh-density') === 'comfortable'));

// --- fonts & tokens ---------------------------------------------------
check('Figtree is the resolved body font',
  await page.evaluate(() => getComputedStyle(document.body).fontFamily.includes('Figtree')));

check('accent token resolves to Hulu green',
  await page.evaluate(() => getComputedStyle(document.documentElement)
    .getPropertyValue('--jh-accent').trim().toLowerCase() === '#1ce783'));

check('app background is the near-black ground',
  await page.evaluate(() => getComputedStyle(document.body).backgroundColor === 'rgb(11, 12, 15)'));

// --- hero -------------------------------------------------------------
await page.waitForSelector('.jh-hero', { timeout: 4000 }).catch(() => {});
check('hero carousel was built from the API', await page.locator('.jh-hero').count() === 1);
check('hero has one slide per item', await page.locator('.jh-hero-slide').count() === 3);
check('first slide is active', await page.locator('.jh-hero-slide.is-active').count() === 1);
check('resume slide shows a Resume button',
  (await page.locator('.jh-hero-slide.is-active .jh-btn-primary').innerText()).trim() === 'Resume');
check('resume progress bar is rendered at the right width',
  await page.evaluate(() => {
    const i = document.querySelector('.jh-hero-progress > i');
    return !!i && getComputedStyle(i).width !== '0px';
  }));
check('header goes transparent over the hero',
  await page.evaluate(() => document.querySelector('.skinHeader').classList.contains('jh-over-hero')));

// --- cards ------------------------------------------------------------
check('cards were enhanced',
  await page.locator('.card[data-jh-enhanced]').count() >= 3);
check('Top 10 rail got ranked numerals',
  await page.locator('.jh-badge-top10').count() === 2);
check('rank numeral text is correct',
  (await page.locator('.jh-badge-top10').first().innerText()).trim() === '1');
check('Recently Added rail got a New badge',
  await page.locator('.jh-badge-new').count() === 1);
check('in-card metadata block was injected',
  await page.locator('.jh-card-info').count() >= 3);
check('card info reuses the existing title',
  (await page.locator('.card[data-id="item-1"] .jh-card-info-title').innerText()).trim() === 'The Bear');

// Guards the other direction of the drawer fix: narrowing the rail selectors
// to horizontal scrollers must not stop an actual rail laying out as a row.
check('rail cards lay out horizontally',
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.scrollSlider > .card')];
    if (cards.length < 2) return false;
    const a = cards[0].getBoundingClientRect();
    const b = cards[1].getBoundingClientRect();
    return b.left > a.left + 20 && Math.abs(b.top - a.top) < 4;
  }));

// Regression: the numeral used to hang off the left of the tile, where the
// frame's overflow:hidden clipped it away entirely.
check('Top 10 numeral is not clipped by the card frame',
  await page.evaluate(() => {
    const badge = document.querySelector('.jh-badge-top10');
    const frame = badge.closest('.cardScalable');
    const b = badge.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    return b.width > 20 && b.left >= f.left - 1 && b.bottom <= f.bottom + 1;
  }));

// Regression: .emby-scrollbuttons is position:absolute, and without a
// positioned ancestor it anchored to the viewport instead of the rail.
check('rail scroll buttons are anchored to their own section',
  await page.evaluate(() => {
    const buttons = document.querySelector('.emby-scrollbuttons');
    const section = buttons.closest('.verticalSection');
    const b = buttons.getBoundingClientRect();
    const s = section.getBoundingClientRect();
    return b.left >= s.left - 1 && b.right <= s.right + 1 && b.top >= s.top - 1;
  }));

check('rail scroll buttons clear the section heading',
  await page.evaluate(() => {
    const buttons = document.querySelector('.emby-scrollbuttons button');
    const title = document.querySelector('.verticalSection .sectionTitle');
    return buttons.getBoundingClientRect().top >= title.getBoundingClientRect().bottom - 2;
  }));

check('nothing overlays the centre of a rail card',
  await page.evaluate(() => {
    const frame = document.querySelector('.card[data-id="item-1"] .cardScalable');
    const r = frame.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && !!hit.closest('.card[data-id="item-1"]');
  }));

// Regression: library sections wrap their heading in a link, and styling that
// link as a hover-revealed "see all" control hid the heading itself.
check('library section headings are visible at rest',
  await ctx0(page, () => {
    const link = document.querySelector('.sectionTitleTextButton');
    const title = link && link.querySelector('.sectionTitle');
    if (!title) return false;
    const cs = getComputedStyle(link);
    const box = title.getBoundingClientRect();
    return Number(cs.opacity) === 1 && box.width > 20 && box.height > 8;
  }));

check('heading is not restyled as a small uppercase control',
  await ctx0(page, () => {
    const title = document.querySelector('.sectionTitleTextButton .sectionTitle');
    const cs = getComputedStyle(title);
    return cs.textTransform !== 'uppercase' && parseFloat(cs.fontSize) > 16;
  }));

check('the chevron, not the heading, is what hides until hover',
  await ctx0(page, () => {
    const icon = document.querySelector('.sectionTitleTextButton .material-icons');
    return !!icon && Number(getComputedStyle(icon).opacity) === 0;
  }));

// --- hover ------------------------------------------------------------
const card = page.locator('.card[data-id="item-1"]');
await card.hover();
// Hovering scrolls the card into view, and .jh-scrolling deliberately
// suppresses hover transforms while a scroll is in flight. Wait past it.
await page.waitForTimeout(500);
check('card scales up on hover',
  await page.evaluate(() => {
    const m = new DOMMatrix(getComputedStyle(
      document.querySelector('.card[data-id="item-1"] .cardScalable')).transform);
    return m.a > 1.05;
  }));
check('overlay becomes visible on hover',
  await page.evaluate(() => Number(getComputedStyle(
    document.querySelector('.card[data-id="item-1"] .cardOverlayContainer')).opacity) > 0.9));

// Preview ladder: no local trailer, so it must fall back to trickplay tiles.
await page.waitForTimeout(1400);
check('trickplay preview mounts when there is no trailer',
  await page.locator('.card[data-id="item-1"].jh-preview-playing .jh-card-preview').count() === 1);

await page.mouse.move(5, 5);
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(OUT, 'screenshot-home.png') });
check('preview is torn down on leave',
  await page.locator('.jh-card-preview').count() === 0);

// --- settings panel ---------------------------------------------------
check('settings launcher injected into the header',
  await page.locator('.headerRight .jh-settings-button').count() === 1);

await page.locator('.jh-settings-button').click();
await page.waitForTimeout(350);
check('panel opens', await page.locator('.jh-settings-overlay.is-open').count() === 1);

await page.locator('.jh-seg-item[data-value="cinematic"]').first().click();
check('density setting applies to <html>',
  await page.evaluate(() => document.documentElement.getAttribute('data-jh-density') === 'cinematic'));
check('density setting widens cards',
  await page.evaluate(() => parseInt(getComputedStyle(document.documentElement)
    .getPropertyValue('--jh-card-w-portrait'), 10) === 210));

await page.locator('.jh-swatch[data-value="#00E0FF"]').click();
check('accent swatch recolours the theme',
  await page.evaluate(() => getComputedStyle(document.documentElement)
    .getPropertyValue('--jh-accent').trim().toLowerCase() === '#00e0ff'));
check('on-accent text flips to stay legible',
  await page.evaluate(() => getComputedStyle(document.documentElement)
    .getPropertyValue('--jh-on-accent').trim() === '#0B0C0F'));

check('settings persist to localStorage',
  await page.evaluate(() => {
    const raw = localStorage.getItem('jellyhulu.settings.v1.user-abc');
    return !!raw && JSON.parse(raw).density === 'cinematic';
  }));

await page.locator('.jh-settings-footer .jh-btn-flat').click();
await page.waitForTimeout(120);
check('reset restores defaults',
  await page.evaluate(() => document.documentElement.getAttribute('data-jh-density') === 'comfortable'));

await page.keyboard.press('Escape');
await page.waitForTimeout(320);
check('Escape closes the panel',
  await page.locator('.jh-settings-overlay.is-open').count() === 0);

// --- drawer scrolling --------------------------------------------------
// The rail styling matched bare .emby-scroller and .scrollSlider, but
// Jellyfin uses emby-scroller for VERTICAL containers too — including the
// navigation drawer. `display: flex` (row by default) laid the drawer's items
// out sideways, so the container overflowed horizontally and there was
// nothing to scroll vertically.
{
  const ctx = await browser.newPage({ viewport: { width: 1440, height: 700 } });
  await ctx.goto('file://' + path.join(ROOT, 'fixture.html'));
  await ctx.waitForTimeout(500);

  for (const id of ['drawerPlain', 'drawerScroller']) {
    // Exactly what NavDrawer.open() does: show the drawer, mark it open, and
    // raise the mask. Testing the drawer without the mask tests a state the
    // client is never in.
    await ctx.evaluate((n) => {
      document.getElementById(n).classList.remove('hide');
      document.getElementById(n).classList.add('drawer-open');
      const mask = document.querySelector('.tmla-mask');
      mask.classList.remove('hide');
      mask.classList.add('backdrop');
    }, id);
    await ctx.waitForTimeout(120);

    const r = await ctx.evaluate((n) => {
      const drawer = document.getElementById(n);
      const items = [...drawer.querySelectorAll('.navMenuOption')];
      const box = drawer.querySelector('.mainDrawer-scrollContainer');
      const a = items[0].getBoundingClientRect();
      const b = items[1].getBoundingClientRect();
      box.scrollTop = 200;
      const db = drawer.getBoundingClientRect();
      const bb = box.getBoundingClientRect();
      return {
        stacked: b.top > a.top + 4,
        overflows: box.scrollHeight > box.clientHeight + 4,
        scrolled: box.scrollTop > 0,
        fills: bb.width >= db.width - 1 && bb.height >= db.height - 1,
        cw: Math.round(bb.width), chh: Math.round(bb.height),
        dw: Math.round(db.width), dh: Math.round(db.height),
        // Where a click and a wheel actually land. The mask is a full-viewport
        // overlay at z-index 1098 that closes the drawer when clicked, so if
        // the drawer stacks below it every gesture meant for the menu hits the
        // mask instead: links do nothing (the drawer just closes) and the
        // wheel finds nothing scrollable. Hit-testing is the only way to see
        // this — every box measurement above passes either way.
        atLink: (() => {
          const t = document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2);
          return t ? (drawer.contains(t) ? 'drawer' : t.className || t.tagName) : 'nothing';
        })(),
        atDrawer: (() => {
          const t = document.elementFromPoint(db.left + db.width / 2, db.top + db.height / 2);
          return t ? (drawer.contains(t) ? 'drawer' : t.className || t.tagName) : 'nothing';
        })(),
      };
    }, id);

    check(`${id}: nav items stack vertically`, r.stacked);
    check(`${id}: content overflows vertically`, r.overflows);
    check(`${id}: the drawer actually scrolls`, r.scrolled);
    // A scroll container narrower or shorter than the drawer leaves a strip
    // where the wheel lands on .mainDrawer instead — which is not scrollable,
    // so the gesture chains to the page and the drawer looks frozen even
    // though its scrollbar is right there.
    check(`${id}: the scroll container fills the drawer`, r.fills,
      `container ${r.cw}x${r.chh} vs drawer ${r.dw}x${r.dh}`);
    check(`${id}: a click on a nav link reaches the drawer`, r.atLink === 'drawer',
      `hit ${r.atLink}`);
    check(`${id}: a wheel over the drawer reaches the drawer`, r.atDrawer === 'drawer',
      `hit ${r.atDrawer}`);

    await ctx.evaluate((n) => {
      document.getElementById(n).classList.add('hide');
      document.getElementById(n).classList.remove('drawer-open');
      const mask = document.querySelector('.tmla-mask');
      mask.classList.add('hide');
      mask.classList.remove('backdrop');
    }, id);
  }

  await ctx.close();
}

// --- video playback surface -------------------------------------------
// The video element is document.body.firstChild — beneath the whole app
// shell — and is visible only because the OSD marks <html> .transparentDocument
// so the shell stops painting. A theme that paints an opaque background on
// anything spanning the viewport above it (the .skinBody wrapper, the OSD page
// itself) hides the picture completely while audio, controls and the clock
// carry on, which reads as "playback is broken" rather than as a CSS problem.
//
// Hit-testing cannot see this: a covering element is returned by
// elementFromPoint whether it is opaque or transparent. So this samples the
// pixel that actually got painted.
{
  const ctx = await browser.newPage({ viewport: { width: 1440, height: 700 } });
  await ctx.goto('file://' + path.join(ROOT, 'player.html'));
  await ctx.waitForTimeout(400);

  const shot = await ctx.screenshot({ clip: { x: 719, y: 349, width: 1, height: 1 } });
  const px = pixelOf(shot);
  // The poster is solid magenta. Anything else at the centre of the screen
  // means something is painted over the video.
  const visible = px.r > 200 && px.g < 60 && px.b > 200;
  check('the video surface is not painted over', visible,
    `centre pixel rgb(${px.r}, ${px.g}, ${px.b}) — expected magenta`);

  // The pointer must land where it does in stock Jellyfin, which is the OSD
  // page rather than the video: .mainAnimatedPage covers the viewport, and
  // the OSD is what binds click-to-pause. Verified against a real 10.11.11
  // client with the theme disabled, where elementFromPoint at the centre of
  // the screen returns div#videoOsdPage. So the assertion is that no theme
  // chrome has been interposed, not that the video is on top.
  const hit = await ctx.evaluate(() => {
    const t = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    if (!t) return 'nothing';
    if (t.closest('.videoPlayerContainer')) return 'video';
    if (t.closest('#videoOsdPage')) return 'osd page';
    return `${t.tagName.toLowerCase()}.${(t.className || '').toString().split(' ')[0]}`;
  });
  check('the pointer lands on the player, not on theme chrome',
    hit === 'osd page' || hit === 'video', `hit ${hit}`);

  await ctx.close();
}

// --- duplicate hero regression ----------------------------------------
// Hero.build is async, and one navigation fires the page lifecycle several
// times (viewshow, hashchange, the mutation observer). If the "do we already
// have a hero?" check only runs before the await, two builds both pass it and
// both insert — and because each build overwrites the module's node/timer,
// only the last one ever animates. That is exactly what a user sees: two
// heroes, the top one moving, the one below it frozen.
{
  const ctx = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { window.__JH_API_DELAY__ = 400; });
  await ctx.goto('file://' + path.join(ROOT, 'fixture.html'));

  // Fire more lifecycle events while the first build is still awaiting.
  await ctx.waitForTimeout(120);
  await ctx.evaluate(() => {
    for (let i = 0; i < 3; i++) {
      document.dispatchEvent(new CustomEvent('viewshow', { bubbles: true }));
    }
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  await ctx.waitForTimeout(1600);

  const count = await ctx.locator('.jh-hero').count();
  check('exactly one hero after concurrent page events', count === 1, `found ${count}`);

  check('the surviving hero is the one that animates',
    await ctx.evaluate(() => {
      const heroes = [...document.querySelectorAll('.jh-hero')];
      // A running carousel is not paused and has an active dot whose fill is
      // actually animating.
      return heroes.length === 1
        && !heroes[0].classList.contains('is-paused')
        && !!heroes[0].querySelector('.jh-hero-dot.is-active');
    }));

  await ctx.close();
}

// --- server defaults (the Jellyfin plugin's route) ---------------------
// The plugin publishes window.JELLYHULU_DEFAULTS before the bundle loads.
// They must sit between the built-in defaults and a user's own choices.
{
  const ctx = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    window.JELLYHULU_DEFAULTS = {
      accent: '#FF4D8D',
      density: 'compact',
      hero: 'off',
      bogusKey: 'ignored',
    };
  });
  await ctx.goto('file://' + path.join(ROOT, 'fixture.html'));
  await ctx.waitForTimeout(700);

  check('server default accent is applied',
    await ctx.evaluate(() => getComputedStyle(document.documentElement)
      .getPropertyValue('--jh-accent').trim().toLowerCase() === '#ff4d8d'));
  check('server default density is applied',
    await ctx.evaluate(() => document.documentElement.getAttribute('data-jh-density') === 'compact'));
  check('server default can switch the hero off',
    await ctx.locator('.jh-hero').count() === 0);
  check('unknown keys from the server are ignored',
    await ctx.evaluate(() => !('bogusKey' in window.JellyHulu.settings.all())));

  // A user's own choice must still win over the server's default.
  await ctx.evaluate(() => window.JellyHulu.settings.set('density', 'cinematic'));
  await ctx.waitForTimeout(120);
  check('a user setting overrides the server default',
    await ctx.evaluate(() => document.documentElement.getAttribute('data-jh-density') === 'cinematic'));

  // ...and reset must return to the server's default, not the built-in one.
  await ctx.evaluate(() => window.JellyHulu.reset());
  await ctx.waitForTimeout(120);
  check('reset returns to the server default, not the built-in one',
    await ctx.evaluate(() => document.documentElement.getAttribute('data-jh-density') === 'compact'));

  await ctx.close();
}

// --- header measurement -----------------------------------------------
check('header height is measured onto the offset token',
  await page.evaluate(() => {
    const measured = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--jh-header-h'));
    const actual = document.querySelector('.skinHeader').getBoundingClientRect().height;
    return Math.abs(measured - actual) <= 1;
  }));

// Regression: the measurement used to be written back into the same token the
// header sizes itself from, so each pass could only ratchet the header taller.
check('measuring the header does not grow it',
  await page.evaluate(async () => {
    const h = () => document.querySelector('.skinHeader').getBoundingClientRect().height;
    const before = h();
    for (let i = 0; i < 5; i++) {
      window.dispatchEvent(new Event('resize'));
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
    }
    return Math.abs(h() - before) < 1;
  }));

// Regression: the header's library-name title inherited page-heading sizing
// and an h3's default margins, which tripled the header's height.
check('header stays close to its configured height',
  await page.evaluate(() => {
    const configured = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--jh-header-height'));
    const actual = document.querySelector('.skinHeader').getBoundingClientRect().height;
    return actual >= configured - 1 && actual <= configured + 8;
  }));

check('pages clear the measured header',
  await page.evaluate(() => {
    const page = document.querySelector('.page');
    const headerH = document.querySelector('.skinHeader').getBoundingClientRect().height;
    // The home page opens with a hero, which deliberately bleeds under the
    // header, so it is the one page that must NOT be padded.
    return getComputedStyle(page).paddingTop === '0px' && headerH > 0;
  }));

// --- a11y -------------------------------------------------------------
check('skip link is present', await page.locator('.jh-skip-link').count() === 1);
check('skip link is hidden until focused',
  await page.evaluate(() => {
    const l = document.querySelector('.jh-skip-link');
    return l.getBoundingClientRect().bottom < 0;
  }));
check('route announcer live region exists',
  await page.locator('[role="status"][aria-live="polite"]').count() >= 1);

// --- no layout overflow ----------------------------------------------
check('page does not scroll horizontally',
  await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

// --- viewport sweep ---------------------------------------------------
// The theme has to hold up from a small phone to a TV. Horizontal overflow is
// the failure that actually happens, so every width is checked for it.
const VIEWPORTS = [
  { name: 'small phone', width: 380, height: 760 },
  { name: 'phone',       width: 430, height: 900 },
  { name: 'tablet',      width: 834, height: 1112 },
  { name: 'laptop',      width: 1440, height: 900 },
  { name: 'ultrawide',   width: 2560, height: 1080 },
];

for (const vp of VIEWPORTS) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.waitForTimeout(220);
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`no horizontal overflow at ${vp.name} (${vp.width}px)`, overflow <= 1,
    `overflows by ${overflow}px`);
}

// TV mode is a whole second layout; make sure it engages and stays contained.
await page.setViewportSize({ width: 1920, height: 1080 });
await page.evaluate(() => window.JellyHulu.settings.set('tv', 'on'));
await page.waitForTimeout(260);
check('TV mode enlarges the card grid',
  await page.evaluate(() => parseInt(getComputedStyle(document.documentElement)
    .getPropertyValue('--jh-card-w-portrait'), 10) === 220));
check('TV mode drops blur for weak GPUs',
  await page.evaluate(() => getComputedStyle(document.documentElement)
    .getPropertyValue('--jh-glass-blur').trim() === '0px'));
check('no horizontal overflow in TV mode',
  await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1));
await page.screenshot({ path: path.join(OUT, 'screenshot-tv.png') });

await page.evaluate(() => window.JellyHulu.settings.set('tv', 'auto'));
await page.setViewportSize({ width: 430, height: 900 });
await page.waitForTimeout(260);
await page.screenshot({ path: path.join(OUT, 'screenshot-mobile.png') });

await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(220);

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
