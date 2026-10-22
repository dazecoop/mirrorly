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

// Phone captures are 2x, so a phone `w` px wide on the slide shows at w/426
// of its real size (an iPhone 17 Pro with its frame is 426 CSS px wide).
//
// Each slide lists `shots` (images from scripts/output, placed in slide px,
// optionally tilted) and `callouts` (cards at x/y whose dashed connector
// points at `target` in shot `shot`: a box name from the capture's .json, or
// {fx, fy} fractions of the image).
const SLIDES = [
  {
    file: '01-side-by-side.png',
    layout: 'browser',
    shots: ['sidebar-airbnb.png', 'desktop-airbnb.png'],
    browser: {
      x: 486, y: 84, w: 766, h: 528, sidebarW: 253,
      host: 'airbnb.co.uk', rest: '/',
      tabs: [{ title: 'Airbnb | Holiday rentals', fav: '#ff385c', active: true }, { title: 'NASA', fav: '#0b3d91' }],
    },
    callouts: [
      { id: 'phone', shot: 0, target: { fx: 0.56, fy: 0.6 }, x: 846, y: 300, title: 'The page, as a phone sees it', sub: 'Real iPhone and Android frames', icon: 'phone', color: 'purple' },
      { id: 'page', shot: 1, target: { fx: 0.5, fy: 0.3 }, x: 880, y: 520, title: 'Your desktop tab, in sync', sub: 'Scroll or click either one', icon: 'desktop', color: 'blue' },
    ],
    eyebrow: 'MIRRORLY FOR FIREFOX',
    headline: ['Desktop & mobile,', 'side by side.'],
    subcopy: 'See the page you\'re on as a phone shows it, in Firefox\'s sidebar, right next to the desktop version.',
    more: 'Not a resized tab: real iPhone and Android frames beside the desktop page, with every scroll, tap and keystroke in sync.',
    features: ['Desktop & mobile at once', 'Works on any site', 'Signed-in pages too'],
  },
  {
    file: '02-in-sync.png',
    layout: 'phones',
    shots: [
      { image: 'phone-nasa-pixel.png', x: 778, y: 104, w: 300, tiltY: -16, dim: true },
      { image: 'phone-nasa-safari.png', x: 560, y: 70, w: 316, tiltY: -16, z: 2 },
    ],
    callouts: [
      { id: 'scroll', shot: 1, target: { fx: 0.62, fy: 0.3 }, x: 1000, y: 92, title: 'Scrolling', sub: 'Lines up on the same content', icon: 'scroll', color: 'blue' },
      { id: 'tap', shot: 1, target: { fx: 0.55, fy: 0.5 }, x: 1022, y: 232, title: 'Taps', sub: 'Menus, buttons and toggles', icon: 'tap', color: 'purple' },
      { id: 'type', shot: 0, target: { fx: 0.7, fy: 0.58 }, x: 1030, y: 372, title: 'Typing', sub: 'Text copied into every view', icon: 'keyboard', color: 'pink' },
      { id: 'pages', shot: 0, target: { fx: 0.62, fy: 0.9 }, x: 1022, y: 512, title: 'Pages', sub: 'Links, back, reloads, tabs', icon: 'link', color: 'green' },
    ],
    eyebrow: 'EVERYTHING IN SYNC',
    headline: ['One scroll.', 'Every view.'],
    subcopy: 'Scrolling, taps, typing and page changes are mirrored between the desktop tab and up to two phones, in both directions.',
    more: 'Put an iPhone next to a Pixel and test both layouts against the desktop in one go.',
    features: ['Two phones at once', 'Works both ways', 'Each part can be off'],
  },
  {
    file: '03-real-phones.png',
    layout: 'phones',
    shots: [{ image: 'phone-wiki-keyboard.png', x: 596, y: 44, w: 310 }],
    callouts: [
      { id: 'island', target: 'island', x: 968, y: 54, title: 'Dynamic Island', sub: 'And every status bar', icon: 'island', color: 'blue' },
      { id: 'bar', target: 'accessory', x: 968, y: 318, title: 'Safari\'s keyboard bar', sub: 'Chrome\'s and Firefox\'s too', icon: 'toolbar', color: 'purple' },
      { id: 'kb', target: 'key', x: 968, y: 470, title: 'A keyboard that types', sub: 'iOS keyboard and Gboard', icon: 'keyboard', color: 'pink' },
      { id: 'page', target: { fx: 0.3, fy: 0.25 }, x: 360, y: 610, title: 'Page sized like the phone', sub: 'Viewport, text size, safe areas', icon: 'resize', color: 'green', hidden: true },
    ],
    eyebrow: 'PIXEL-ACCURATE',
    headline: ['Measured from', 'real phones.'],
    subcopy: 'Frames, browser bars, keyboards and safe areas are matched against screenshots from real iPhones, down to iOS\'s text size.',
    more: 'More than a resized window: the page gets the viewport, user agent, pixel ratio and safe areas the phone would give it.',
    features: ['Safari · Chrome · Firefox', 'iOS keyboard & Gboard', 'Light & dark'],
  },
  {
    file: '04-devices.png',
    layout: 'phones',
    shots: [
      { image: 'phone-airbnb-se.png', x: 496, y: 188, w: 214, rotate: -9, dim: true },
      { image: 'phone-natgeo-firefox.png', x: 626, y: 120, w: 226, rotate: -4, z: 2 },
      { image: 'phone-lego-pixel.png', x: 1012, y: 150, w: 228, rotate: 8, dim: true },
      { image: 'phone-wiki-gboard.png', x: 900, y: 104, w: 228, rotate: 4, z: 2 },
      { image: 'phone-natgeo-chrome.png', x: 760, y: 68, w: 252, z: 3 },
    ],
    tags: [
      { text: 'iPhone SE', x: 500, y: 652 },
      { text: 'Firefox', x: 668, y: 620 },
      { text: 'Chrome · Pro Max', x: 800, y: 612 },
      { text: 'Galaxy · Gboard', x: 958, y: 640 },
      { text: 'Pixel', x: 1150, y: 668 },
    ],
    eyebrow: 'EVERY PHONE THAT MATTERS',
    headline: ['iPhone, Pixel,', 'Galaxy & more.'],
    subcopy: 'iPhones from the SE to the 17 Pro Max, Pixel, Galaxy and Redmi, or any custom size, in portrait or landscape.',
    more: 'Draw each one in Safari, Chrome or Firefox, or just the bare screen. Phones with identical screens share an entry, so the list stays short.',
    features: ['27 phones & tablets', 'Custom sizes', 'Portrait & landscape'],
  },
  {
    file: '05-touch-and-tools.png',
    layout: 'phones',
    shots: [
      { image: 'phone-nasa-landscape.png', x: 690, y: 474, w: 540, rotate: -3, z: 1 },
      { image: 'sidebar-settings.png', x: 520, y: 40, w: 420, radius: 14, z: 2 },
    ],
    callouts: [
      { id: 'touch', shot: 1, target: 'touchMode', x: 990, y: 92, title: 'Feels like a touch screen', sub: 'Drag to scroll, no hover', icon: 'hand', color: 'purple' },
      { id: 'keyboard', shot: 1, target: 'softKeyboard', x: 990, y: 210, title: 'Soft keyboard', sub: 'Slides up, synced everywhere', icon: 'keyboard', color: 'pink' },
      { id: 'text', shot: 1, target: 'textSize', x: 990, y: 328, title: 'iOS text size & dark mode', sub: 'Match your own phone', icon: 'type', color: 'blue' },
      { id: 'rotate', shot: 0, target: { fx: 0.8, fy: 0.3 }, x: 1010, y: 690, title: 'Rotate & screenshot', sub: 'PNG with transparent frame', icon: 'camera', color: 'green', hidden: true },
    ],
    eyebrow: 'TOUCH, ROTATE, SCREENSHOT',
    headline: ['Made for testing', 'mobile layouts.'],
    subcopy: 'A fingertip pointer, drag-to-scroll and no hover effects, so the page behaves like it does under a finger.',
    more: 'Rotate any phone, and save PNG screenshots at the phone\'s real resolution with a transparent frame.',
    features: ['Private: nothing leaves Firefox', 'Free', 'Open source'],
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
  { from: '04-devices.png', lift: 60, hideFeatures: true, out: { 'docs/preview-devices.png': 1.25 } },
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
      browser: base.browser && { ...base.browser, y: base.browser.y - 40, h: base.browser.h - 116 },
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
