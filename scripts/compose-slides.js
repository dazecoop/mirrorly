#!/usr/bin/env node
/**
 * Compose the raw captures (scripts/output/*.png, from capture.js) into the
 * 1280x800 marketing screenshots for the Firefox Add-ons listing, and the
 * 2:1 social/README/docs previews.
 *
 * Usage:
 *   node scripts/capture.js                 # scripts/output/*.png
 *   node scripts/compose-slides.js firefox  # -> store-assets/firefox/0N-*.png
 *   node scripts/compose-slides.js social   # -> store-assets/social-preview.png and
 *                                           #    docs/social-preview.png, docs/preview-*.png
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const MODE = process.argv[2] === 'social' ? 'social' : 'firefox';
const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(__dirname, 'output');
const TEMPLATE_PATH = path.join(__dirname, 'lib', 'slide-template.html');
const DEST_DIR = path.join(ROOT, 'store-assets', 'firefox');

// Each slide lists `shots` (images from scripts/output) and `callouts`
// (cards at x/y whose dashed connector points at `target` in shot `shot`: a
// box name from the capture's .json, {box, fx, fy} for a point in that box,
// or {fx, fy} fractions of the image). Cards sit across the edge of the
// window or panel, with `anchor` naming the side the connector leaves from.
//
// Browser slides draw the window at the captures' real size, scaled by
// `scale`; it may run off the slide.
const DRIFTWOOD_TAB = { title: 'Driftwood · Stays worth the journey', fav: '#ff6b4a' };
const MERIDIAN_TAB = { title: 'The Meridian · News and sport', fav: '#c41e2a' };
const PULSE_TAB = { title: 'Overview · Pulse', fav: '#10b981' };

const SLIDES = [
  {
    file: '01-side-by-side.png',
    layout: 'browser',
    shots: ['sidebar-driftwood.png', 'desktop-driftwood.png'],
    browser: {
      x: 520, y: 182, scale: 0.6, desktopW: 1020, host: 'driftwood.travel', rest: '/',
      tabs: [{ ...DRIFTWOOD_TAB, active: true }, PULSE_TAB],
    },
    callouts: [
      { id: 'phone', target: { box: 'phone', fx: 0.5, fy: 0.03 }, x: 540, y: 138, anchor: 'bottom', title: 'The page, as a phone shows it', sub: 'Real iPhone and Android frames', icon: 'phone', color: 'purple' },
      { id: 'page', shot: 1, target: { fx: 0.32, fy: 0.08 }, x: 942, y: 138, anchor: 'bottom', title: 'Your desktop tab, in sync', sub: 'Scroll or click either one', icon: 'desktop', color: 'blue' },
    ],
    eyebrow: 'MIRRORLY FOR FIREFOX',
    headline: ['Desktop & mobile,', 'side by side.'],
    subcopy: 'See the page you\'re on as a phone shows it, in Firefox\'s sidebar, right next to the desktop version.',
    more: 'Not a resized tab: real iPhone and Android frames beside the desktop page, with every scroll, tap and keystroke in sync.',
    features: ['Desktop & mobile at once', 'Works on localhost', 'Signed-in pages too'],
  },
  {
    file: '02-in-sync.png',
    layout: 'browser',
    shots: ['sidebar-meridian.png', 'desktop-meridian.png'],
    browser: {
      x: 540, y: 196, scale: 0.56, desktopW: 1100, host: 'themeridian.news', rest: '/',
      tabs: [{ ...MERIDIAN_TAB, active: true }, DRIFTWOOD_TAB],
    },
    callouts: [
      { id: 'tap', target: { box: 'page', fx: 0.25, fy: 0.08 }, x: 548, y: 152, anchor: 'bottom', title: 'Taps', sub: 'Menus, buttons, toggles', icon: 'tap', color: 'purple' },
      { id: 'pages', target: { fx: 0.6, fy: 0.27 }, x: 790, y: 152, anchor: 'bottom', title: 'Pages', sub: 'Links, back, reloads', icon: 'link', color: 'pink' },
      { id: 'scroll', shot: 1, target: { fx: 0.1, fy: 0.12 }, x: 1022, y: 152, anchor: 'bottom', title: 'Scrolling', sub: 'Same content, all views', icon: 'scroll', color: 'blue' },
    ],
    eyebrow: 'EVERYTHING IN SYNC',
    headline: ['One scroll.', 'Every view.'],
    subcopy: 'Scrolling, taps, typing and page changes are mirrored between the desktop tab and every phone, in both directions.',
    more: 'Put an iPhone next to a Pixel, or up to ten devices side by side, and test every layout against the desktop in one go.',
    features: ['Up to ten devices', 'Works both ways', 'Each part can be off'],
  },
  {
    file: '03-real-phones.png',
    layout: 'browser',
    shots: ['sidebar-kiln.png'],
    browser: { panel: true, x: 604, y: 58, scale: 0.74 },
    callouts: [
      { id: 'island', target: 'island', x: 944, y: 200, anchor: 'left', title: 'Dynamic Island', sub: 'And every status bar', icon: 'island', color: 'blue' },
      { id: 'bar', target: { box: 'keyboard', fx: 0.93, fy: -0.1 }, x: 944, y: 470, anchor: 'left', title: 'Safari\'s keyboard bar', sub: 'Chrome\'s and Firefox\'s too', icon: 'toolbar', color: 'purple' },
      { id: 'kb', target: { box: 'keyboard', fx: 0.82, fy: 0.42 }, x: 944, y: 610, anchor: 'left', title: 'A keyboard that types', sub: 'iOS keyboard and Gboard', icon: 'keyboard', color: 'pink' },
    ],
    eyebrow: 'MEASURED, NOT GUESSED',
    headline: ['True to the', 'real phone.'],
    subcopy: 'Frames, browser bars, keyboards and safe areas are matched against screenshots from real iPhones, down to iOS\'s text size.',
    more: 'The page gets the viewport, user agent, pixel ratio and safe areas the phone would give it.',
    features: ['Safari · Chrome · Firefox', 'iOS keyboard & Gboard', 'Light & dark'],
  },
  {
    file: '04-devices.png',
    layout: 'lineup',
    lineup: { x: 520, baseline: 690, scale: 0.46, gap: 26 },
    shots: [
      { image: 'phone-se-kiln.png', tag: 'iPhone SE' },
      { image: 'phone-pro-driftwood.png', tag: 'iPhone 17 Pro' },
      { image: 'phone-galaxy-pulse.png', tag: 'Galaxy S25 Ultra' },
      { image: 'phone-pixel-meridian.png', tag: 'Pixel 10' },
    ],
    eyebrow: 'EVERY PHONE THAT MATTERS',
    headline: ['iPhone, Pixel,', 'Galaxy & more.'],
    subcopy: 'iPhones from the SE to the 17 Pro Max, Pixel, Galaxy and Redmi, the iPad mini, or any custom size.',
    more: 'Drawn at the same scale, so sizes compare honestly. Each in Safari, Chrome or Firefox, or just the bare screen.',
    features: ['27 phones & tablets', 'Custom sizes', 'Portrait & landscape'],
  },
  {
    file: '05-touch-and-tools.png',
    layout: 'browser',
    shots: ['sidebar-settings.png'],
    browser: { panel: true, x: 500, y: 40, scale: 0.96 },
    callouts: [
      { id: 'sync', target: { box: 'syncScroll', fx: 0.93 }, x: 970, y: 168, anchor: 'left', title: 'Choose what syncs', sub: 'Scrolling, pages, taps, typing', icon: 'scroll', color: 'blue' },
      { id: 'touch', target: { box: 'touchMode', fx: 0.93 }, x: 970, y: 330, anchor: 'left', title: 'Feels like a touch screen', sub: 'Drag to scroll, no hover', icon: 'hand', color: 'purple' },
      { id: 'keyboard', target: { box: 'softKeyboard', fx: 0.93 }, x: 970, y: 470, anchor: 'left', title: 'Soft keyboard', sub: 'Slides up, synced everywhere', icon: 'keyboard', color: 'pink' },
      { id: 'text', target: { box: 'appearance', fx: 0.99 }, x: 970, y: 610, anchor: 'left', title: 'iOS text size & dark mode', sub: 'Match your own phone', icon: 'type', color: 'green' },
    ],
    eyebrow: 'SETTINGS',
    headline: ['Made for testing', 'mobile layouts.'],
    subcopy: 'A fingertip pointer, drag-to-scroll and no hover effects, so the page behaves like it does under a finger.',
    more: 'Rotate any phone, and save screenshots at its real resolution: with the frame, just the page, or the whole page.',
    features: ['Private: nothing leaves Firefox', 'Free', 'Open source'],
  },
  {
    file: '06-ai-agents.png',
    layout: 'agent',
    shots: ['agent-kiln-se.png'],
    agent: {
      x: 520, y: 118, w: 710, shotW: 192,
      title: 'Agent session · ~/sites/kiln',
      ask: 'Check the homepage on a small iPhone and fix anything that looks off.',
      before: [{ name: 'mirrorly_open', args: 'http://localhost:3000 · iPhone SE · Safari' }, { name: 'mirrorly_screenshot', args: 'mode: frame → 838×1686 PNG' }],
      reply: '<p>On the <strong>iPhone SE</strong>, Safari\'s toolbar sits over both buttons in the hero, so neither can be tapped.</p>'
        + '<p>Fixed in <code>hero.css</code>: the buttons now leave room for the toolbar and the safe area.</p>'
        + '<p>Checked again on the iPhone SE and iPhone 17: both clear.</p>',
      after: [{ name: 'mirrorly_screenshot', args: 'iPhone SE · after the fix' }],
      // Where the screenshot shows the problem (fractions of its height).
      mark: { fy0: 0.82, fy1: 0.9 },
      status: { x: 960, y: 88, title: 'Mirrorly · AI agents', sub: 'Connected to Claude Code' },
    },
    eyebrow: 'AI AGENTS · MCP',
    headline: ['Your AI agent,', 'on a real phone.'],
    subcopy: 'Claude Code, Cursor and other agents open your site in a phone, scroll, take screenshots, and fix what looks wrong.',
    more: 'One command to set up. Works on localhost, runs in your Firefox (signed in) or headless, and nothing leaves your computer.',
    features: ['MCP server & CLI', 'Works on localhost', 'Free & local'],
  },
];

const CTA_TEXT = 'Add to Firefox — Free';

// 2:1 versions for the GitHub social preview, the README and the docs site.
// `out` maps each output file to the device scale it's written at.
const SOCIAL = [
  {
    from: '01-side-by-side.png',
    eyebrow: 'MOBILE PREVIEW FOR FIREFOX',
    subcopy: 'See the page you\'re on as a real phone shows it, beside the desktop tab and kept in sync. Free and open source.',
    out: { 'store-assets/social-preview.png': 2, 'docs/social-preview.png': 1.25 },
  },
  { from: '02-in-sync.png', out: { 'docs/preview-sync.png': 1.25 } },
  { from: '03-real-phones.png', out: { 'docs/preview-real-phones.png': 1.25 } },
  { from: '06-ai-agents.png', out: { 'docs/preview-agents.png': 1.25 } },
  { from: '04-devices.png', lift: 96, hideFeatures: true, out: { 'docs/preview-devices.png': 1.25 } },
];
const SOCIAL_CTA = 'Free & open source';

function dataUri(file) {
  const p = path.isAbsolute(file) ? file : path.join(OUTPUT_DIR, file);
  if (!fs.existsSync(p)) {
    console.error(`Missing ${path.relative(ROOT, p)} — run \`node scripts/capture.js\` first.`);
    process.exit(1);
  }
  return `data:image/${p.endsWith('.svg') ? 'svg+xml' : 'png'};base64,${fs.readFileSync(p).toString('base64')}`;
}

function boxesFor(file) {
  const p = path.join(OUTPUT_DIR, file.replace(/\.png$/, '.json'));
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

async function renderSlide(page, template, slide, opts) {
  await page.setContent(template, { waitUntil: 'load' });
  const files = slide.shots.map((s) => (typeof s === 'string' ? s : s.image));
  const visible = { ...slide, callouts: (slide.callouts || []).filter((c) => !c.hidden) };
  await page.evaluate((s, o) => window.render(s, o), visible, {
    ...opts,
    logo: dataUri(path.join(ROOT, 'icons', 'icon.svg')),
    images: files.map(dataUri),
    boxes: files.map(boxesFor),
  });
  await page.evaluate(() => Promise.all([...document.images].filter((i) => i.src).map((img) =>
    img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))));
}

async function storeSlides(browser, template) {
  // Clear old slides first so a renumbered set never leaves stale files for
  // the listing to pick up. Only PNGs: the folder also holds description.md
  // and the icon.
  fs.mkdirSync(DEST_DIR, { recursive: true });
  fs.readdirSync(DEST_DIR).filter((f) => /^\d\d-.*\.png$/.test(f)).forEach((f) => fs.rmSync(path.join(DEST_DIR, f)));
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  for (let i = 0; i < SLIDES.length; i++) {
    await renderSlide(page, template, SLIDES[i], { cta: CTA_TEXT, index: i, total: SLIDES.length });
    const outPath = path.join(DEST_DIR, SLIDES[i].file);
    await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width: 1280, height: 800 } });
    console.log(`wrote ${path.relative(ROOT, outPath)}`);
  }
}

async function socialImages(browser, template) {
  for (const social of SOCIAL) {
    const base = SLIDES.find((s) => s.file === social.from);
    // The 2:1 canvas is 160px shorter; move everything on the stage up to suit.
    const lift = (y) => y - (social.lift ?? 70);
    const slide = {
      ...base,
      ...social,
      shots: base.shots.map((s) => (typeof s === 'string' ? s : { ...s, y: lift(s.y) })),
      browser: base.browser && { ...base.browser, y: lift(base.browser.y) },
      lineup: base.lineup && { ...base.lineup, baseline: lift(base.lineup.baseline) },
      agent: base.agent && { ...base.agent, y: lift(base.agent.y), status: base.agent.status && { ...base.agent.status, y: lift(base.agent.status.y) } },
      callouts: (base.callouts || []).map((c) => ({ ...c, y: lift(c.y) })),
      tags: (base.tags || []).map((t) => ({ ...t, y: lift(t.y) })),
    };
    for (const [file, scale] of Object.entries(social.out)) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 640, deviceScaleFactor: scale });
      await renderSlide(page, template, slide, { cta: SOCIAL_CTA, index: 0, total: 0, social: true });
      const outPath = path.join(ROOT, file);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width: 1280, height: 640 } });
      await page.close();
      console.log(`wrote ${file}`);
    }
  }
}

async function main() {
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const browser = await puppeteer.launch({ headless: true });
  try {
    if (MODE === 'social') await socialImages(browser, template);
    else await storeSlides(browser, template);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
