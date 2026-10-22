#!/usr/bin/env node
/**
 * Capture the raw screenshots the store slides are built from, by running
 * the real extension in Firefox against real sites.
 *
 * The sites are made-up demos in scripts/demo-sites, served locally under
 * made-up domains (Firefox resolves them to localhost), so no real brand
 * appears on the slides. Firefox runs headless (so the window can be any
 * size, and nothing takes over the screen), in dark mode, with Mirrorly
 * installed temporarily. Window 1 is the desktop tab; window 2 holds the
 * sidebar page, paired with window 1 (sidebar.html?window=other), large
 * enough that phones are drawn at 100%.
 *
 * Writes scripts/output/<name>.png, and for phone captures <name>.json with
 * the boxes (in phone CSS px) that slide callouts point at.
 *
 * Usage:
 *   node scripts/capture.js            # everything
 *   node scripts/capture.js kiln lineup  # only shots whose name contains these
 *
 * Needs Firefox; set FIREFOX_BIN if it isn't at the macOS default path.
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { Builder, By } = require('selenium-webdriver');
const firefox = require('selenium-webdriver/firefox');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'output');
const UUID = '6d1f6a0e-4c1b-4b8e-9d1c-6b9a3f2e7c11';
// Paired with the desktop window, with 9:41 in every status bar as in Apple's
// own product shots.
const SIDEBAR = `moz-extension://${UUID}/sidebar/sidebar.html?window=other&clock=9:41`;
const FIREFOX_BIN = process.env.FIREFOX_BIN || '/Applications/Firefox.app/Contents/MacOS/firefox';

// Each demo site's folder in scripts/demo-sites, by the domain it's shown under.
const PORT = 8765;
const DEMO_SITES = {
  'driftwood.travel': 'driftwood',
  'themeridian.news': 'meridian',
  'kilncoffee.co.uk': 'kiln',
  'app.pulsehq.io': 'pulse',
};
const SITES = {
  driftwood: `http://driftwood.travel:${PORT}/`,
  meridian: `http://themeridian.news:${PORT}/`,
  kiln: `http://kilncoffee.co.uk:${PORT}/`,
  pulse: `http://app.pulsehq.io:${PORT}/`,
};

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };

function serveDemoSites() {
  const server = http.createServer((req, res) => {
    const site = DEMO_SITES[(req.headers.host || '').split(':')[0]];
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html');
    const file = site && path.join(__dirname, 'demo-sites', site, path.normalize(rel));
    if (!file || !file.startsWith(path.join(__dirname, 'demo-sites', site)) || !fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Firefox -----------------------------------------------------------

async function launch() {
  const xpi = path.join(os.tmpdir(), 'mirrorly-capture.xpi');
  fs.rmSync(xpi, { force: true });
  execSync(`zip -r -X "${xpi}" manifest.json background.js content.js shared.js styles.js touch.js icons sidebar`, { cwd: ROOT, stdio: 'ignore' });

  const options = new firefox.Options()
    .setBinary(FIREFOX_BIN)
    .addArguments('-headless')
    .setPreference('extensions.webextensions.uuids', JSON.stringify({ 'mirrorly@dazecoop': UUID }))
    .setPreference('layout.css.devPixelsPerPx', '2')
    .setPreference('ui.prefersReducedMotion', 1)
    // Dark mode for Firefox, the sidebar and the desktop page.
    .setPreference('ui.systemUsesDarkTheme', 1)
    .setPreference('layout.css.prefers-color-scheme.content-override', 0)
    // The demo sites' domains point at the local server, over plain http.
    .setPreference('network.dns.localDomains', Object.keys(DEMO_SITES).join(','))
    .setPreference('dom.security.https_first', false)
    .setPreference('dom.security.https_only_mode', false);
  // System access lets the driver open the extension's own (moz-extension:) page.
  const service = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).setFirefoxService(service).build();
  await driver.installAddon(xpi, true);
  return driver;
}

// --- Pages ---------------------------------------------------------------

// Cookie and consent banners, dismissed by their button text.
const CONSENT = /^(only necessary|reject all|reject|decline|necessary only|accept all|accept all cookies|accept|allow all|agree|i agree|got it|ok|continue)$/i;

// Pop-ups that aren't part of the page being shown: feedback surveys,
// newsletter prompts, app banners. Hidden by their text.
const POPUPS = /was this page helpful|newsletter|sign up for|subscribe|we use cookies|cookie settings|your privacy|get the app/i;

async function dismissBanners(driver) {
  await driver.executeScript(`
    const consent = new RegExp(arguments[0], 'i');
    const popups = new RegExp(arguments[1], 'i');
    for (const b of document.querySelectorAll('button, [role=button], a')) {
      if (consent.test((b.textContent || '').trim()) && b.offsetParent) b.click();
    }
    for (const el of document.querySelectorAll('body *')) {
      const pos = getComputedStyle(el).position;
      if ((pos === 'fixed' || pos === 'sticky') && el.offsetHeight < innerHeight * 0.7 && popups.test(el.textContent || '')) {
        el.style.setProperty('display', 'none', 'important');
      }
    }`, CONSENT.source, POPUPS.source);
}

class Rig {
  constructor(driver) {
    this.driver = driver;
  }

  async start() {
    const d = this.driver;
    await d.manage().window().setRect({ width: 1280, height: 860 });
    this.desktop = await d.getWindowHandle();
    await d.switchTo().newWindow('window');
    await d.manage().window().setRect({ width: 1500, height: 1400 });
    this.sidebar = await d.getWindowHandle();
    await d.get(SIDEBAR);
    await sleep(1500);
  }

  async inDesktop(fn) {
    await this.driver.switchTo().window(this.desktop);
    try {
      return await fn();
    } finally {
      await this.driver.switchTo().window(this.sidebar);
    }
  }

  // Runs fn inside the phone frame of pane `index`.
  async inPhone(index, fn) {
    const frames = await this.driver.findElements(By.css('.viewport iframe'));
    await this.driver.switchTo().frame(frames[index]);
    try {
      return await fn();
    } finally {
      await this.driver.switchTo().defaultContent();
    }
  }

  // Applies settings (and devices) through the extension's own storage, then
  // reloads the sidebar page so they take effect.
  async configure(settings) {
    await this.driver.executeScript('return browser.storage.local.set(arguments[0])', {
      panelOpen: false, appearance: 'light', textSize: 17, touchMode: true, softKeyboard: true, mobileUA: true,
      syncScroll: true, syncClicks: true, syncInputs: true, syncNav: true, ...settings,
    });
    await this.driver.navigate().refresh();
    await sleep(1200);
  }

  async resize(width, height) {
    await this.driver.manage().window().setRect({ width, height });
    await sleep(1500);
  }

  // Sizes the current window so its page is exactly width x height.
  async resizeInner(width, height) {
    await this.driver.manage().window().setRect({ width, height });
    await sleep(500);
    const [iw, ih] = await this.driver.executeScript('return [innerWidth, innerHeight]');
    await this.driver.manage().window().setRect({ width: 2 * width - iw, height: 2 * height - ih });
    await sleep(1500);
  }

  // Taps the text field `selector` in pane `index`'s page (a real click, so
  // the keyboard opens), after an optional click on `opener` to reveal it.
  async focusField(index, selector, opener) {
    await this.inPhone(index, async () => {
      if (opener) {
        await this.driver.findElement(By.css(opener)).click();
        await sleep(1500);
      }
      for (const field of await this.driver.findElements(By.css(selector))) {
        if (await field.isDisplayed()) {
          await field.click();
          break;
        }
      }
    });
    await sleep(1500);
  }

  // Types on the drawn keyboard of pane `index`.
  async typeOnKeyboard(index, text) {
    const pane = (await this.driver.findElements(By.css('.pane')))[index];
    for (const ch of text) {
      const keys = ch !== ch.toLowerCase() ? ['shift', ch.toLowerCase()] : [ch];
      for (const k of keys) {
        await pane.findElement(By.css(`.kb-key[data-key="${k}"]`)).click();
        await sleep(120);
      }
    }
    await sleep(1800);
  }

  async open(url, { wait = 6000 } = {}) {
    await this.inDesktop(async () => {
      await this.driver.get(url);
      await sleep(1500);
      await dismissBanners(this.driver);
    });
    await sleep(wait);
    const panes = (await this.driver.findElements(By.css('.viewport iframe'))).length;
    for (let i = 0; i < panes; i++) await this.inPhone(i, () => dismissBanners(this.driver));
    await sleep(1500);
  }

  async scrollDesktop(y) {
    await this.inDesktop(() => this.driver.executeScript('window.scrollTo(0, arguments[0])', y));
    await sleep(1500);
  }

  // The fingertip (touch mode) would otherwise show wherever the mouse last was.
  async hideFingers() {
    await this.driver.executeScript("document.querySelectorAll('.finger').forEach((f) => f.hidden = true)");
    const panes = (await this.driver.findElements(By.css('.viewport iframe'))).length;
    for (let i = 0; i < panes; i++) {
      await this.inPhone(i, () => this.driver.executeScript("document.querySelector('mirrorly-finger')?.style.setProperty('display', 'none', 'important')"));
    }
  }

  async save(name, element, boxesScript) {
    await this.hideFingers();
    // The sidebar's address line, as it reads for a real site.
    await this.driver.executeScript(`const u = document.getElementById('url');
      if (u) u.textContent = u.textContent.replace('http://', 'https://').replace(':${PORT}', '');`);
    fs.writeFileSync(path.join(OUT, `${name}.png`), await element.takeScreenshot(), 'base64');
    if (boxesScript) {
      const boxes = await this.driver.executeScript(boxesScript, element);
      fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(boxes, null, 2));
    }
    console.log(`wrote scripts/output/${name}.png`);
  }

  // The phone of pane `index`, with boxes for its parts relative to the phone.
  async savePhone(name, index = 0) {
    const phone = (await this.driver.findElements(By.css('.pane .phone')))[index];
    await this.save(name, phone, PHONE_BOXES);
  }

  async body() {
    return this.driver.findElement(By.css('body'));
  }

  // The desktop tab, with a page width x height (the sidebar's window stays
  // as it is).
  async saveDesktop(name, width, height) {
    await this.inDesktop(async () => {
      await this.resizeInner(width, height);
      const png = await this.driver.takeScreenshot();
      fs.writeFileSync(path.join(OUT, `${name}.png`), png, 'base64');
    });
    console.log(`wrote scripts/output/${name}.png`);
  }
}

// Boxes of the phone's parts, in phone CSS px (before the phone's own scale).
const PHONE_BOXES = `
  const phone = arguments[0];
  const r0 = phone.getBoundingClientRect();
  const k = phone.offsetWidth / r0.width;
  const box = (sel) => {
    const el = phone.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: (r.left - r0.left) * k, y: (r.top - r0.top) * k, w: r.width * k, h: r.height * k };
  };
  return {
    _size: { w: phone.offsetWidth, h: phone.offsetHeight },
    _radius: parseFloat(getComputedStyle(phone).borderTopLeftRadius) || 0,
    screen: box('.screen'), island: box('.island'), status: box('.sb'),
    toolbar: box('.saf-bar, .fx-bar, .cri-bottom, .cr-bar, .land-bar'),
    keyboard: box('.kb'), accessory: box('.kb-bar, .kb-pill, .kb-site'), key: box('.kb-key[data-key="a"]'),
    home: box('.hw-home'), page: box('.viewport'),
  };`;

// --- Shots ----------------------------------------------------------------

const IPHONE = { device: 'iphone-16-pro', frame: 'safari' };
const PIXEL = { device: 'pixel', frame: 'chrome' };

// The phones in the line-up slide: one each, drawn at the same scale there.
const LINEUP = [
  ['phone-se-kiln', { device: 'iphone-se', frame: 'safari' }, 'kiln', 'light'],
  ['phone-pro-driftwood', IPHONE, 'driftwood', 'dark'],
  ['phone-galaxy-pulse', { device: 'galaxy-ultra', frame: 'chrome' }, 'pulse', 'dark'],
  ['phone-pixel-meridian', PIXEL, 'meridian', 'light'],
];

// Sidebar and desktop captures are taken at the size the slide's drawn
// window shows them (compose-slides.js), so the phone fits the sidebar as it
// would for real. 500px is as narrow as Firefox makes a window.
const SHOTS = {
  async 'driftwood-browser'(rig) {
    await rig.configure({ devices: [IPHONE], appearance: 'dark' });
    await rig.resizeInner(500, 900);
    await rig.open(SITES.driftwood);
    await rig.saveDesktop('desktop-driftwood', 1020, 900);
    await rig.save('sidebar-driftwood', await rig.body(), SIDEBAR_BOXES);
  },

  async 'meridian-pair'(rig) {
    await rig.configure({ devices: [IPHONE, PIXEL], appearance: 'dark' });
    await rig.resizeInner(900, 1100);
    await rig.open(SITES.meridian);
    await rig.scrollDesktop(560);
    await rig.saveDesktop('desktop-meridian', 1100, 1100);
    await rig.save('sidebar-meridian', await rig.body(), SIDEBAR_BOXES);
  },

  async 'kiln-keyboard'(rig) {
    await rig.configure({ devices: [IPHONE], appearance: 'dark' });
    await rig.resizeInner(500, 1000);
    await rig.open(SITES.kiln);
    await rig.focusField(0, '#q', '#open-search');
    await rig.typeOnKeyboard(0, 'Cold');
    await rig.save('sidebar-kiln', await rig.body(), SIDEBAR_BOXES);
  },

  async lineup(rig) {
    await rig.resize(1500, 1400);
    for (const [name, device, site, appearance] of LINEUP) {
      await rig.configure({ devices: [device], appearance });
      await rig.open(SITES[site]);
      await rig.savePhone(name);
    }
  },

  // The settings panel, open, at sidebar width, with the phone below it.
  async settings(rig) {
    await rig.configure({ devices: [IPHONE], panelOpen: true, appearance: 'dark' });
    await rig.resizeInner(500, 1300);
    await rig.open(SITES.pulse, { wait: 3000 });
    await rig.save('sidebar-settings', await rig.body(), SETTINGS_BOXES);
  },
};

// Boxes of the first phone's parts, relative to the sidebar page.
const SIDEBAR_BOXES = `
  const page = arguments[0];
  const r0 = page.getBoundingClientRect();
  const box = (sel) => {
    const el = page.querySelector('.pane ' + sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left - r0.left, y: r.top - r0.top, w: r.width, h: r.height };
  };
  return {
    _size: { w: r0.width, h: r0.height },
    phone: box('.phone'), island: box('.island'), toolbar: box('.saf-bar, .fx-bar, .cri-bottom, .cr-bar'),
    keyboard: box('.kb'), accessory: box('.kb-bar, .kb-pill, .kb-site'), key: box('.kb-key[data-key="a"]'),
    page: box('.viewport'), bar: { x: 0, y: 0, w: r0.width, h: page.querySelector('.bar').offsetHeight },
  };`;

// Boxes of each row in the settings panel, keyed by setting.
const SETTINGS_BOXES = `
  const bar = arguments[0];
  const r0 = bar.getBoundingClientRect();
  const out = { _size: { w: r0.width, h: r0.height } };
  const add = (key, el) => {
    const r = el.getBoundingClientRect();
    out[key] = { x: r.left - r0.left, y: r.top - r0.top, w: r.width, h: r.height };
  };
  for (const input of bar.querySelectorAll('[data-setting]')) add(input.dataset.setting, input.closest('.toggle'));
  add('summary', bar.querySelector('#summary'));
  add('textSize', bar.querySelector('#text-size-field'));
  add('appearance', bar.querySelector('.segmented'));
  return out;`;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.argv.slice(2);
  const server = await serveDemoSites();
  const driver = await launch();
  try {
    const rig = new Rig(driver);
    await rig.start();
    for (const [name, shot] of Object.entries(SHOTS)) {
      if (only.length && !only.some((o) => name.includes(o))) continue;
      console.log(`· ${name}`);
      await shot(rig);
    }
  } finally {
    await driver.quit();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
