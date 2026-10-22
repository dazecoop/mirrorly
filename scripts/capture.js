#!/usr/bin/env node
/**
 * Capture the raw screenshots the store slides are built from, by running
 * the real extension in Firefox against real sites.
 *
 * Firefox runs headless (so the window can be any size) with Mirrorly
 * installed temporarily. Window 1 is the desktop tab; window 2 holds the
 * sidebar page, paired with window 1 (sidebar.html?window=other), large
 * enough that phones are drawn at 100%.
 *
 * Writes scripts/output/<name>.png, and for phone captures <name>.json with
 * the boxes (in phone CSS px) that slide callouts point at.
 *
 * Usage:
 *   node scripts/capture.js            # everything
 *   node scripts/capture.js nasa lego  # only shots whose name contains these
 *
 * Needs Firefox; set FIREFOX_BIN if it isn't at the macOS default path.
 */
const fs = require('fs');
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

const SITES = {
  airbnb: 'https://www.airbnb.co.uk/',
  lego: 'https://www.lego.com/en-gb',
  wiki: 'https://en.wikipedia.org/wiki/Apollo_11',
  nasa: 'https://www.nasa.gov/',
  natgeo: 'https://www.nationalgeographic.com/',
};

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
    .setPreference('ui.prefersReducedMotion', 1);
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

  async saveDesktop(name) {
    await this.inDesktop(async () => {
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

const SHOTS = {
  // The desktop page and a sidebar the width of a real one, for the
  // browser-window slide.
  async 'airbnb-browser'(rig) {
    await rig.configure({ devices: [IPHONE] });
    await rig.resize(460, 960);
    await rig.open(SITES.airbnb);
    await rig.inDesktop(() => rig.driver.manage().window().setRect({ width: 1100, height: 1250 }));
    await rig.scrollDesktop(420);
    await rig.saveDesktop('desktop-airbnb');
    await rig.inDesktop(() => rig.driver.manage().window().setRect({ width: 1280, height: 860 }));
    await rig.save('sidebar-airbnb', await rig.driver.findElement(By.css('body')));
    await rig.resize(1500, 1400);
  },

  async 'nasa-pair'(rig) {
    await rig.configure({ devices: [IPHONE, { device: 'pixel', frame: 'chrome' }] });
    await rig.open(SITES.nasa);
    await rig.savePhone('phone-nasa-safari', 0);
    await rig.savePhone('phone-nasa-pixel', 1);
  },

  async 'wiki-keyboard'(rig) {
    await rig.configure({ devices: [IPHONE] });
    await rig.open(SITES.wiki);
    await rig.focusField(0, 'input[type=search], input.search', '#searchIcon, .search-toggle');
    await rig.typeOnKeyboard(0, 'Saturn V');
    await rig.savePhone('phone-wiki-keyboard');
  },

  async 'wiki-gboard'(rig) {
    await rig.configure({ devices: [{ device: 'galaxy-ultra', frame: 'chrome' }] });
    await rig.open(SITES.wiki);
    await rig.focusField(0, 'input[type=search], input.search', '#searchIcon, .search-toggle');
    await rig.typeOnKeyboard(0, 'moon'); // Gboard capitalises the first letter itself
    await rig.savePhone('phone-wiki-gboard');
  },

  async 'lego-pixel'(rig) {
    await rig.configure({ devices: [{ device: 'pixel', frame: 'chrome' }] });
    await rig.open(SITES.lego, { wait: 9000 });
    await rig.savePhone('phone-lego-pixel');
  },

  async 'natgeo-firefox'(rig) {
    await rig.configure({ devices: [{ device: 'iphone-16', frame: 'firefox' }], appearance: 'dark' });
    await rig.open(SITES.natgeo, { wait: 9000 });
    await rig.savePhone('phone-natgeo-firefox');
  },

  async 'natgeo-chrome'(rig) {
    await rig.configure({ devices: [{ device: 'iphone-16-pro-max', frame: 'chrome-ios' }] });
    await rig.open(SITES.natgeo, { wait: 9000 });
    await rig.savePhone('phone-natgeo-chrome');
  },

  async 'nasa-landscape'(rig) {
    await rig.configure({ devices: [{ ...IPHONE, landscape: true }] });
    await rig.open(SITES.nasa);
    await rig.savePhone('phone-nasa-landscape');
  },

  async 'se-airbnb'(rig) {
    await rig.configure({ devices: [{ device: 'iphone-se', frame: 'safari' }] });
    await rig.open(SITES.airbnb);
    await rig.savePhone('phone-airbnb-se');
  },

  // The settings panel, open, at sidebar width.
  async settings(rig) {
    await rig.configure({ devices: [IPHONE], panelOpen: true });
    await rig.resize(460, 1200);
    await rig.open(SITES.nasa, { wait: 3000 });
    await rig.save('sidebar-settings', await rig.driver.findElement(By.css('.bar')), SETTINGS_BOXES);
    await rig.resize(1500, 1400);
  },
};

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
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
