'use strict';

// The sidebar shows up to Mirrorly.MAX_DEVICES mobile views of the active tab,
// side by side. Sync and phone settings are shared; each view (a Pane) has
// its own device and browser.

const panesEl = document.getElementById('panes');
const placeholder = document.getElementById('placeholder');
const urlLabel = document.getElementById('url');
const summary = document.getElementById('summary');
const summaryText = document.getElementById('summary-text');
const settingsPanel = document.getElementById('settings');
const textSizeSelect = document.getElementById('text-size');
const addDeviceButton = document.getElementById('add-device');
const paneTemplate = document.getElementById('pane-template');
const notice = document.getElementById('notice');
const noticeText = document.getElementById('notice-text');


// Allows everything a normal page needs except navigating the sidebar itself,
// which frame-busting scripts would otherwise do.
const SANDBOX =
  'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox ' +
  'allow-modals allow-downloads allow-pointer-lock allow-presentation';

const BEZEL = 12;
// Space around the phone in capture mode, enough for its outline.
const CAPTURE_MARGIN = 8;
// The tallest screenshot, in image px.
const MAX_CAPTURE_PX = 16000;
// The largest image (as a base64 data URL) an agent is handed as is.
const AGENT_IMAGE_CHARS = 6_000_000;
const OUTLINE = 4; // the outer ring drawn around the bezel (box-shadow)
const captureId = new URLSearchParams(location.search).get('capture');
// An AI agent's phone (background-agent.js), driven by commands.
const agentSession = new URLSearchParams(location.search).get('agent');
// Both draw one phone at full size in a background tab.
const offscreen = Boolean(captureId || agentSession);

const MESSAGES = {
  loop: {
    title: "This site can't be shown here",
    text: "It kept reloading itself in this view, so it was stopped. Sites do this when they detect they're inside a frame, or don't accept the phone user agent.",
    hint: 'Turning off Phone user agent in the settings sometimes helps.',
    retry: true,
  },
  restricted: {
    title: "Firefox doesn't allow this site here",
    text: 'Firefox stops extensions from working on addons.mozilla.org and some other Mozilla sites, so this page can\'t be shown in a phone view.',
  },
};
const STAGE_PAD = 10;
// The order + Device adds devices in. (Android phones get Chrome, as Safari
// isn't offered for them.)
const NEW_DEVICES = [
  'iphone-se', 'iphone-16-pro', 'pixel', 'galaxy-ultra', 'iphone-16-pro-max', 'galaxy', 'iphone-16e', 'redmi-note',
  'iphone-air', 'pixel-xl', 'ipad-mini',
];
const systemDark = matchMedia('(prefers-color-scheme: dark)');
const SYNC_NAMES = { syncScroll: 'scrolling', syncNav: 'pages', syncClicks: 'taps', syncInputs: 'typing' };

let settings;
let windowId;
let port;
let pageUrl = null; // the page every view should be showing
let tabCount = 1;
let nextSlot = 0;
const panes = [];

function isDark() {
  return settings.appearance === 'dark' || (settings.appearance === 'auto' && systemDark.matches);
}

function save(changes) {
  Object.assign(settings, changes);
  browser.storage.local.set(changes);
}

function saveDevices() {
  save({ devices: panes.map((pane) => pane.config) });
}

// The part of the screen the page gets, below the status bar and clear of
// any browser toolbar it can't scroll under.
function geometry(d, kind) {
  const W = d.width;
  const H = d.height;
  const area = (left, top, width, height) => ({ left, top, width, height });
  if (kind === 'screen' || d.kind === 'fit') return area(0, 0, W, H);
  if (d.landscape) return landscapeGeometry(d, kind);
  switch (kind) {
    case 'safari':
      if (d.kind === 'ipad') return area(0, d.safeTop + 50, W, H - d.safeTop - 50);
      return area(0, d.safeTop, W, H - d.safeTop);
    case 'chrome-ios':
      return area(0, d.safeTop + 50.33, W, H - d.safeTop - 50.33 - (44 + d.safeBottom));
    case 'firefox':
      return area(0, d.safeTop, W, H - d.safeTop - (110 + d.safeBottom));
    case 'chrome':
      return area(0, d.safeTop + 56, W, H - d.safeTop - 56 - d.safeBottom);
    default:
      return area(0, 0, W, H);
  }
}

// In landscape, iPhones with a camera cutout keep the page clear of it on both
// sides, as Safari does for pages that don't opt into the full screen.
function landscapeGeometry(d, kind) {
  const W = d.width;
  const H = d.height;
  const { toolbar, homeStrip } = Mirrorly.LANDSCAPE;
  if (d.kind === 'android') return { left: 0, top: d.safeTop + 56, width: W, height: H - d.safeTop - 56 - d.safeBottom };
  if (d.kind === 'ipad') return { left: 0, top: d.safeTop + 50, width: W, height: H - d.safeTop - 50 };
  const side = d.cutout ? d.safeTop : 0;
  const bottom = d.safeBottom ? homeStrip : 0;
  const top = kind === 'safari' ? 0 : toolbar;
  return { left: side, top, width: W - side * 2, height: H - top - bottom };
}

// Turns a portrait device on its side: the screen swaps width and height, and
// the top bezel (camera, earpiece) ends up on the left.
function landscapeOf(d) {
  return { ...d, width: d.height, height: d.width, landscape: true };
}

// env(safe-area-inset-bottom) for pages with viewport-fit=cover. Safari 26
// counts its floating toolbar, and a gap above it, in the inset: 99 on an
// iPhone 17 Pro, found by matching Airbnb's bottom bar to the phone.
function safeAreaBottom(d, kind) {
  if (kind !== 'safari' || d.kind !== 'iphone' || d.landscape) return 0;
  return Math.max(d.safeBottom, 10) + 48 + 17;
}

function bezelOf(d) {
  const b = d.bezel || { side: BEZEL, top: BEZEL, bottom: BEZEL, radius: (d.radius || 0) + BEZEL };
  return d.landscape
    ? { left: b.top, right: b.bottom, top: b.side, bottom: b.side, radius: b.radius }
    : { left: b.side, right: b.side, top: b.top, bottom: b.bottom, radius: b.radius };
}

const colorCanvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
function isDarkColor(color) {
  colorCanvas.fillStyle = '#fff';
  colorCanvas.fillStyle = color;
  colorCanvas.fillRect(0, 0, 1, 1);
  const [r, g, b] = colorCanvas.getImageData(0, 0, 1, 1).data;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 140;
}

// ?clock=9:41 fixes the status bar time (for marketing screenshots).
const fixedClock = new URLSearchParams(location.search).get('clock');

function clock() {
  if (fixedClock) return fixedClock;
  const now = new Date();
  return `${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function fillDeviceSelect(select) {
  const groups = new Map();
  for (const d of Mirrorly.DEVICES) {
    if (!groups.has(d.group)) {
      const group = document.createElement('optgroup');
      group.label = d.group;
      groups.set(d.group, group);
      select.append(group);
    }
    groups.get(d.group).append(new Option(d.width ? `${d.label} (${d.width}×${d.height})` : d.label, d.id));
  }
}

class Pane {
  constructor(config) {
    this.slot = nextSlot++;
    this.config = { device: 'iphone-16-pro', frame: 'safari', customWidth: 402, customHeight: 874, ...config };
    this.frame = null;
    this.currentUrl = null;
    this.tint = 'rgb(255, 255, 255)';
    this.layoutWidth = null; // set when the page has no width=device-width viewport tag

    this.el = paneTemplate.content.firstElementChild.cloneNode(true);
    const $ = (selector) => this.el.querySelector(selector);
    this.deviceSelect = $('.device');
    this.frameSelect = $('.frame');
    this.customRow = $('.custom');
    this.customWidth = $('.custom-width');
    this.customHeight = $('.custom-height');
    this.sizeLabel = $('.size');
    this.stage = $('.stage');
    this.phone = $('.phone');
    this.hardware = $('.hardware');
    this.screen = $('.screen');
    this.viewport = $('.viewport');
    this.overlay = $('.overlay');
    this.finger = $('.finger');
    this.blockedEl = $('.blocked');
    this.blocked = false;
    this.keyboard = null; // { enter, layer, shift } while a text field in the page has focus
    this.listenToKeyboard();
    this.listenToShotMenu($('.shoot'), $('.shot-menu'));
    $('.rotate').addEventListener('click', () => {
      this.config.landscape = !this.config.landscape;
      saveDevices();
      // The screen size the page sees is fixed when the frame is created.
      this.rebuild();
      layoutAll();
    });

    fillDeviceSelect(this.deviceSelect);
    this.deviceSelect.value = this.device().id;
    this.customWidth.value = this.config.customWidth;
    this.customHeight.value = this.config.customHeight;
    this.fillFrameSelect();

    this.deviceSelect.addEventListener('change', () => {
      this.config.device = this.deviceSelect.value;
      saveDevices();
      this.fillFrameSelect();
      this.rebuild();
      layoutAll();
    });
    this.frameSelect.addEventListener('change', () => {
      const frameSettings = () => [this.uaKey(), ...this.pageInsets()].join('|');
      const before = frameSettings();
      this.config.frame = this.frameSelect.value;
      saveDevices();
      // The user agent and insets are fixed when the frame is created.
      if (frameSettings() !== before) this.rebuild();
      layoutAll();
    });
    const onCustomSize = () => {
      const w = Math.round(Number(this.customWidth.value));
      const h = Math.round(Number(this.customHeight.value));
      if (!(w >= 200 && w <= 3000 && h >= 200 && h <= 3000)) return;
      Object.assign(this.config, { customWidth: w, customHeight: h });
      saveDevices();
      layoutAll();
      // The screen size the page sees is fixed when the frame is created.
      clearTimeout(this.customTimer);
      this.customTimer = setTimeout(() => this.rebuild(), 800);
    };
    this.customWidth.addEventListener('input', onCustomSize);
    this.customHeight.addEventListener('input', onCustomSize);
    $('.remove').addEventListener('click', () => removePane(this));
    $('.retry').addEventListener('click', () => this.rebuild());

    this.trackFinger();
    new ResizeObserver(layoutAll).observe(this.stage);
  }

  device() {
    const d = Mirrorly.device(this.config);
    const turned = this.config.landscape && d.kind !== 'fit' ? landscapeOf(d) : d;
    // A full-page screenshot: the screen as tall as the page.
    return this.pageHeight ? { ...turned, height: this.pageHeight } : turned;
  }

  frameKind() {
    return this.pageHeight ? 'screen' : Mirrorly.frame(this.config);
  }

  uaKey() {
    return settings.mobileUA ? Mirrorly.uaKey(this.config) : '';
  }

  fillFrameSelect() {
    const kind = this.device().kind;
    this.frameSelect.replaceChildren(...Mirrorly.FRAMES_BY_KIND[kind].map((id) => new Option(Mirrorly.FRAMES[id], id)));
    this.frameSelect.value = this.frameKind();
    this.frameSelect.disabled = kind === 'fit';
    this.el.querySelector('.rotate').hidden = kind === 'fit';
    this.customRow.hidden = this.config.device !== 'custom';
  }

  // What the browser's bars cover of the page: the safe-area inset Safari
  // reports, and how much of the page's bottom its keyboard bars float over
  // (the page centres a focused field in what's left).
  pageInsets() {
    const d = this.device();
    const kind = this.frameKind();
    const kb = MirrorlyChrome.supportsKeyboard(d, kind) ? MirrorlyChrome.keyboardLayout(d, kind) : null;
    return [safeAreaBottom(d, kind), kb ? kb.viewBottom - kb.pageBottom : 0];
  }

  // The frame's name tells the content script inside it that it is a mobile
  // view, which window it belongs to, how to present itself (user agent,
  // screen size, pixel ratio, text size, touch, insets), and the token that
  // proves to the background script it is one of this sidebar's frames.
  makeFrame() {
    this.frame?.remove();
    const d = this.device();
    const token = crypto.randomUUID();
    const portrait = Mirrorly.device(this.config);
    const screenSize = d.landscape && d.kind === 'android' ? [d.width, d.height] : [portrait.width, portrait.height];
    this.frame = document.createElement('iframe');
    this.frame.name = [
      Mirrorly.FRAME_PREFIX,
      windowId,
      this.uaKey(),
      token,
      screenSize[0] || '',
      screenSize[1] || '',
      d.dpr || '',
      ['iphone', 'ipad', 'fit'].includes(d.kind) ? settings.textSize : '',
      settings.touchMode ? '1' : '',
      ...this.pageInsets(),
    ].join('|');
    this.frame.setAttribute('sandbox', SANDBOX);
    this.layoutWidth = null;
    this.viewport.append(this.frame);
    port.postMessage({
      type: 'frame',
      slot: this.slot,
      token,
      frameId: browser.runtime.getFrameId(this.frame),
      uaKey: this.uaKey(),
    });
    this.phone.hidden = false;
    this.layout();
  }

  load(url) {
    if (this.frame && this.currentUrl === url && !this.blocked) return;
    // A stopped frame refuses further loads; another page gets a fresh one.
    if (this.blocked) {
      this.currentUrl = url;
      this.rebuild();
      return;
    }
    if (!this.frame) this.makeFrame();
    this.navigate(url);
  }

  navigate(url) {
    this.currentUrl = url;
    this.setLoading(true);
    this.frame.src = url;
    port.postMessage({ type: 'loading', slot: this.slot, url });
    this.renderOverlay();
  }

  // Dims the page and runs a sheen across the phone while a page loads, so
  // phones that finish at different times show it. Never in screenshots.
  setLoading(on) {
    clearTimeout(this.loadingTimer);
    this.phone.classList.toggle('loading', on && !offscreen);
    // A page that never says it's loaded still stops looking busy.
    if (on) this.loadingTimer = setTimeout(() => this.setLoading(false), 15000);
  }

  showBlank() {
    this.setLoading(false);
    this.frame?.remove();
    this.frame = null;
    this.currentUrl = null;
    this.phone.hidden = true;
    port.postMessage({ type: 'removeFrame', slot: this.slot });
    this.layout();
  }

  reload() {
    if (this.blocked) this.rebuild();
    else if (this.frame && this.currentUrl) this.navigate(this.currentUrl);
  }

  // The background script stopped this view because the page kept reloading,
  // or Firefox doesn't let extensions run on the site.
  showMessage(kind) {
    this.setLoading(false);
    const text = MESSAGES[kind];
    this.blocked = true;
    this.blockedEl.querySelector('.blocked-title').textContent = text.title;
    this.blockedEl.querySelector('.blocked-text').textContent = text.text;
    this.blockedEl.querySelector('.hint').textContent = text.hint || '';
    this.blockedEl.querySelector('.retry').hidden = !text.retry;
    this.blockedEl.hidden = false;
  }

  showRestricted(url) {
    this.frame?.remove();
    this.frame = null;
    this.currentUrl = url;
    port.postMessage({ type: 'removeFrame', slot: this.slot });
    this.showMessage('restricted');
    this.phone.hidden = false;
    this.layout();
  }

  // The Screenshot button opens a menu: the phone with its frame, or just
  // the page, as much as is on screen or all of it.
  listenToShotMenu(button, menu) {
    menu.id = `shot-menu-${this.slot}`;
    button.popoverTargetElement = menu;
    menu.addEventListener('beforetoggle', (e) => {
      button.setAttribute('aria-expanded', String(e.newState === 'open'));
      if (e.newState !== 'open') return;
      menu.querySelector('.framed-only').hidden = !this.framed();
      // Below the button, kept inside the sidebar.
      const r = button.getBoundingClientRect();
      menu.style.top = `${r.bottom + 4}px`;
      menu.style.left = `${Math.max(4, Math.min(r.left, innerWidth - 168))}px`;
    });
    for (const item of menu.querySelectorAll('[data-shot]')) {
      item.addEventListener('click', () => {
        menu.hidePopover();
        this.screenshot(item.dataset.shot);
      });
    }
  }

  // mode: 'frame' (the phone as drawn), 'screen' (the page on screen, no
  // frame or browser bars) or 'full' (the whole page, no frame).
  screenshot(mode = 'frame') {
    if (!this.currentUrl || this.blocked) return;
    // "Fit sidebar" has no fixed size, so capture it at its current one.
    const config =
      this.device().kind === 'fit'
        ? { device: 'custom', frame: 'screen', customWidth: this.stage.clientWidth, customHeight: this.stage.clientHeight }
        : this.config;
    port.postMessage({ type: 'capture', slot: this.slot, config, url: this.currentUrl, mode });
    showNotice(mode === 'full' ? 'Taking a full-page screenshot…' : 'Taking a screenshot…');
  }

  rebuild() {
    const url = this.currentUrl || pageUrl;
    if (!url) return;
    this.blocked = false;
    this.blockedEl.hidden = true;
    this.makeFrame();
    this.navigate(url);
  }

  destroy() {
    port.postMessage({ type: 'removeFrame', slot: this.slot });
    this.el.remove();
  }

  domain() {
    try {
      return new URL(this.currentUrl).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  keyboardShown() {
    return settings.softKeyboard && Boolean(this.keyboard) && MirrorlyChrome.supportsKeyboard(this.device(), this.frameKind());
  }

  // Keys on the drawn keyboard. Pressing them mustn't move focus out of the
  // page's text field, so mousedown's default action (focusing) is cancelled.
  // (Cancelling pointerdown instead would suppress mousedown, and with it the
  // chance to stop the focus change.)
  listenToKeyboard() {
    let held = null;
    const release = () => {
      if (!held) return;
      held.key.classList.remove('pressed');
      held.popup?.remove();
      held = null;
      if (this.renderOnRelease) {
        this.renderOnRelease = false;
        this.renderOverlay();
      }
    };
    this.overlay.addEventListener('mousedown', (e) => {
      if (!this.keyboard) return;
      // Any click on the drawn phone (including the gaps between keys) would
      // otherwise take focus from the page's field and close the keyboard.
      e.preventDefault();
      const target = e.target.closest?.('[data-key]');
      if (!target || e.button !== 0) return;
      release();
      held = { key: target, popup: null };
      target.classList.add('pressed');
      // Letters pop up above the finger while held, as on iOS.
      if ('char' in target.dataset) {
        const popup = document.createElement('div');
        popup.className = 'kb-popup';
        popup.textContent = target.textContent;
        Object.assign(popup.style, {
          left: `${target.offsetLeft - 10.5}px`,
          top: `${target.offsetTop - 65}px`,
          width: `${target.offsetWidth + 21}px`,
          height: '61px',
        });
        target.parentElement.append(popup);
        held.popup = popup;
      }
      this.pressKey(target.dataset.key);
    });
    addEventListener('mouseup', release);
  }

  pressKey(key) {
    const k = this.keyboard;
    let changed = true;
    if (key === 'shift') k.shift = !k.shift;
    else if (key === 'layer') k.layer = k.layer === 'letters' ? 'numbers' : 'letters';
    else if (key === 'numbers' || key === 'symbols') k.layer = key;
    else if (key === 'emoji') changed = false;
    else {
      port.postMessage({ type: 'key', slot: this.slot, key: k.shift && key.length === 1 ? key.toUpperCase() : key });
      changed = false;
      if (key.length === 1 && k.shift) {
        k.shift = false;
        changed = true;
      }
      // Like iOS, a space or return from the 123 keys goes back to letters.
      if (k.layer !== 'letters' && (key === ' ' || key === 'enter')) {
        k.layer = 'letters';
        changed = true;
      }
    }
    // Re-rendering replaces the held key and its popup, so it waits until
    // the key is released.
    if (changed) this.renderOnRelease = true;
  }

  // Runs the keyboard's slide on the freshly rendered element. A re-render
  // mid-slide picks the animation up where it was, rather than restarting it.
  animateKeyboard() {
    const layer = this.overlay.querySelector('.kb-layer');
    const slide = this.keyboardSlide;
    if (!layer || !slide) return;
    const elapsed = performance.now() - slide.start;
    const inward = slide.direction === 'in';
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : inward ? 340 : 260;
    if (elapsed >= duration) {
      if (inward) this.keyboardSlide = null;
      else layer.style.transform = `translateY(${layer.dataset.slide}px)`;
      return;
    }
    const away = `translateY(${layer.dataset.slide}px)`;
    layer.animate(inward ? [{ transform: away }, { transform: 'none' }] : [{ transform: 'none' }, { transform: away }], {
      duration,
      delay: -elapsed,
      easing: inward ? 'cubic-bezier(.2, .9, .25, 1)' : 'cubic-bezier(.4, 0, .9, .6)',
      fill: 'both',
    });
  }

  // Slides the keyboard up (resizing the page at once) or down (resizing it
  // once the keyboard is out of the way), as iOS does.
  setKeyboard(msg) {
    clearTimeout(this.keyboardHideTimer);
    if (msg.show) {
      const appearing = !this.keyboard || this.keyboardLeaving;
      this.keyboardLeaving = false;
      const kind = msg.kind || 'text';
      // Gboard starts a text field capitalised; the iOS keyboard (as on Wikipedia's search) doesn't.
      const shift = this.device().kind === 'android' && kind === 'text';
      this.keyboard = { enter: msg.enter, kind, autofill: Boolean(msg.autofill), layer: kind === 'number' ? 'numbers' : 'letters', shift };
      if (appearing) this.keyboardSlide = { direction: 'in', start: performance.now() };
      this.layout();
      return;
    }
    if (!this.keyboard || this.keyboardLeaving) return;
    if (!this.keyboardShown()) {
      this.keyboard = null;
      return;
    }
    this.keyboardLeaving = true;
    this.keyboardSlide = { direction: 'out', start: performance.now() };
    this.renderOverlay();
    this.keyboardHideTimer = setTimeout(() => {
      this.keyboard = null;
      this.keyboardLeaving = false;
      this.keyboardSlide = null;
      this.layout();
    }, 260);
  }

  renderOverlay() {
    const d = this.device();
    const kind = this.frameKind();
    this.renderHardware(d, kind);
    if (d.kind === 'fit' || (kind === 'screen' && !this.keyboardShown())) {
      this.overlay.replaceChildren();
      return;
    }
    const html = MirrorlyChrome.render({
      d,
      frame: kind,
      dark: isDark(),
      tint: this.tint,
      tintDark: isDarkColor(this.tint),
      domain: this.domain(),
      time: clock(),
      tabs: tabCount,
      keyboard: this.keyboardShown() ? this.keyboard : null,
    });
    this.overlay.replaceChildren(...new DOMParser().parseFromString(html, 'text/html').body.childNodes);
    this.animateKeyboard();
  }

  // Earpiece, camera and Home button on phones that have them.
  renderHardware(d, kind) {
    if (!d.homeButton || kind === 'screen') {
      this.hardware.replaceChildren();
      return;
    }
    const b = bezelOf(d);
    const W = d.width + b.left + b.right;
    const H = d.height + b.top + b.bottom;
    const part = (cls, style) => {
      const el = document.createElement('div');
      el.className = cls;
      Object.assign(el.style, style);
      return el;
    };
    if (d.landscape) {
      this.hardware.replaceChildren(
        part('hw-speaker', { left: `${b.left / 2 - 3}px`, top: `${H / 2 - 26}px`, width: '6px', height: '52px' }),
        part('hw-camera', { left: `${b.left / 2 - 5}px`, top: `${H / 2 + 42}px` }),
        part('hw-home', { left: `${b.left + d.width + b.right / 2 - 27}px`, top: `${H / 2 - 27}px` }),
      );
      return;
    }
    this.hardware.replaceChildren(
      part('hw-speaker', { left: `${W / 2 - 26}px`, top: `${b.top / 2 - 3}px` }),
      part('hw-camera', { left: `${W / 2 - 52}px`, top: `${b.top / 2 - 5}px` }),
      part('hw-home', { left: `${W / 2 - 27}px`, top: `${b.top + d.height + b.bottom / 2 - 27}px` }),
    );
  }

  // A phone with no page in it still gets drawn while it shows a message.
  layout() {
    if (!this.frame && !this.blocked) {
      this.sizeLabel.textContent = '';
      return;
    }
    const d = this.device();
    const kind = this.frameKind();
    const sw = this.stage.clientWidth;
    const sh = this.stage.clientHeight;
    if (this.frame) this.frame.style.colorScheme = isDark() ? 'dark' : 'light';
    this.phone.classList.toggle('touch', settings.touchMode);

    if (d.kind === 'fit') {
      Object.assign(this.phone.style, { width: `${sw}px`, height: `${sh}px`, transform: '', left: '0px', top: '0px', borderRadius: '' });
      Object.assign(this.screen.style, { left: '0px', top: '0px', width: `${sw}px`, height: `${sh}px`, borderRadius: '' });
      Object.assign(this.viewport.style, { top: '0px', width: `${sw}px`, height: `${sh}px` });
      if (this.frame) Object.assign(this.frame.style, { width: `${sw}px`, height: `${sh}px`, transform: '' });
      this.phone.classList.remove('bezel', 'flat');
      this.renderOverlay();
      this.sizeLabel.textContent = `${sw}×${sh}`;
      return;
    }

    const framed = kind !== 'screen';
    const b = framed ? bezelOf(d) : { left: 0, right: 0, top: 0, bottom: 0, radius: 0 };
    const outerW = d.width + b.left + b.right;
    const outerH = d.height + b.top + b.bottom;
    const scale = sharedScale();
    const g = geometry(d, kind);
    // The page shrinks to the space above the keyboard and the browser's bar.
    if (this.keyboardShown()) g.height = MirrorlyChrome.keyboardLayout(d, kind).viewBottom - g.top;
    const offset = offscreen ? CAPTURE_MARGIN : null;

    this.phone.classList.toggle('bezel', framed);
    this.phone.classList.toggle('flat', !framed);
    Object.assign(this.phone.style, {
      width: `${outerW}px`,
      height: `${outerH}px`,
      left: `${offset ?? Math.max(0, (sw - outerW * scale) / 2)}px`,
      top: `${offset ?? STAGE_PAD}px`,
      transform: `scale(${scale})`,
      borderRadius: framed ? `${b.radius}px` : '',
    });
    Object.assign(this.screen.style, {
      left: `${b.left}px`,
      top: `${b.top}px`,
      width: `${d.width}px`,
      height: `${d.height}px`,
      borderRadius: framed ? `${d.radius || 0}px` : '',
      // Safari (and every browser in landscape) fills the edges with the page colour.
      background: kind === 'safari' || d.landscape ? this.tint : '#fff',
    });
    Object.assign(this.viewport.style, { left: `${g.left}px`, top: `${g.top}px`, width: `${g.width}px`, height: `${g.height}px` });

    // iOS lays out pages without a device-width viewport tag wider, then zooms
    // out to fit the screen.
    const pageWidth = this.layoutWidth && this.layoutWidth !== g.width ? this.layoutWidth : g.width;
    const zoom = g.width / pageWidth;
    if (this.frame) Object.assign(this.frame.style, {
      width: `${pageWidth}px`,
      height: `${g.height / zoom}px`,
      transform: zoom !== 1 ? `scale(${zoom})` : '',
    });

    this.renderOverlay();
    const pageSize = framed ? ` · page ${Math.round(g.width)}×${Math.round(g.height)}` : '';
    this.sizeLabel.textContent = `${d.width}×${d.height}${pageSize}${scale < 1 ? ` · ${Math.round(scale * 100)}%` : ''}`;
  }

  framed() {
    return this.device().kind !== 'fit' && this.frameKind() !== 'screen';
  }

  // The area to capture: the whole phone and its outline, just the screen,
  // or (without the frame) just the page.
  captureRect() {
    const withFrame = this.framed() && !this.frameless;
    const r = (withFrame ? this.phone : this.frameless ? this.viewport : this.screen).getBoundingClientRect();
    const pad = withFrame ? OUTLINE : 0;
    return { x: r.left - pad + scrollX, y: r.top - pad + scrollY, width: r.width + pad * 2, height: r.height + pad * 2 };
  }

  // The captured rectangle with the phone's outline cut out (so the corners
  // are transparent), as a canvas.
  async renderCapture(dataUrl) {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    if (this.framed() && !this.frameless) {
      const k = canvas.width / (this.phone.offsetWidth + OUTLINE * 2);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.beginPath();
      ctx.roundRect(0, 0, canvas.width, canvas.height, (bezelOf(this.device()).radius + OUTLINE) * k);
      ctx.fill();
    }
    return canvas;
  }

  // Saves the captured rectangle as a PNG in Downloads/Mirrorly.
  async saveCapture(dataUrl) {
    const canvas = await this.renderCapture(dataUrl);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const url = URL.createObjectURL(blob);
    const d = this.device();
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
    // "iPhone 17 / 17 Pro / 16 Pro" -> "iPhone 17"
    const model = d.label.split(' / ')[0];
    const kind = this.pageHeight ? 'full page' : this.frameless ? 'page' : this.framed() ? Mirrorly.FRAMES[this.frameKind()] : '';
    const name = `${model} ${kind} ${stamp}`
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
    const filename = `Mirrorly/${name}.png`;
    await browser.downloads.download({ url, filename, saveAs: false });
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return filename;
  }

  // The phone's full size with its frame, or null when it has none to fit
  // (no page yet, or "Fit sidebar").
  outerSize() {
    const d = this.device();
    if ((!this.frame && !this.blocked) || d.kind === 'fit') return null;
    const framed = this.frameKind() !== 'screen';
    const b = framed ? bezelOf(d) : { left: 0, right: 0, top: 0, bottom: 0 };
    return { width: d.width + b.left + b.right, height: d.height + b.top + b.bottom };
  }

  // The page's own cursor is hidden in touch mode; this stands in for it over
  // the phone's status bar and toolbars. (Over the page, the content script
  // draws its own.)
  trackFinger() {
    const place = (e) => {
      if (!settings.touchMode || e.target === this.frame) return;
      const rect = this.screen.getBoundingClientRect();
      const scale = rect.width / this.screen.offsetWidth;
      this.finger.hidden = false;
      this.finger.style.translate = `${(e.clientX - rect.left) / scale}px ${(e.clientY - rect.top) / scale}px`;
    };
    this.screen.addEventListener('pointermove', place);
    this.screen.addEventListener('pointerdown', () => this.finger.classList.add('down'));
    addEventListener('pointerup', () => this.finger.classList.remove('down'));
    this.screen.addEventListener('pointerout', (e) => {
      if (!e.relatedTarget || e.relatedTarget === this.frame || !this.screen.contains(e.relatedTarget)) {
        this.finger.hidden = true;
      }
    });
  }
}

// Every phone is drawn at the same scale, so their sizes compare truthfully.
// They shrink to sit side by side in the sidebar, down to MIN_SHARED_SCALE;
// past that they stay at that size (or what the sidebar's height allows) and
// the row scrolls sideways. Screenshots are always taken at full size.
const MIN_SHARED_SCALE = 0.5;
const PANE_MIN = 200;
let scale = 1;

function sharedScale() {
  return offscreen ? 1 : scale;
}

function arrangePanes() {
  if (offscreen) return;
  const sized = panes.filter((pane) => !pane.el.hidden).map((pane) => [pane, pane.outerSize()]);
  // Measured as if the settings panel were closed: opening it leaves the
  // phones their size, running off the bottom, rather than shrinking them.
  const settingsHeight = settingsPanel.getBoundingClientRect().height;
  const height = Math.min(...sized.map(([pane]) => pane.stage.clientHeight)) + settingsHeight - STAGE_PAD * 2;
  const style = getComputedStyle(panesEl);
  const gap = parseFloat(style.columnGap) || 0;
  const width = panesEl.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const column = (width - gap * (sized.length - 1)) / sized.length - STAGE_PAD * 2;
  let byHeight = 1;
  let byWidth = 1;
  for (const [, size] of sized) {
    if (!size) continue;
    byHeight = Math.min(byHeight, height / size.height);
    byWidth = Math.min(byWidth, column / size.width);
  }
  const fits = sized.length < 2 || Math.min(byHeight, byWidth) >= MIN_SHARED_SCALE;
  scale = Math.max(0.05, fits ? Math.min(byHeight, byWidth) : Math.min(byHeight, MIN_SHARED_SCALE));
  for (const [pane, size] of sized) {
    pane.el.style.flex = fits ? '' : `0 0 ${Math.max(PANE_MIN, Math.ceil((size?.width || 0) * scale) + STAGE_PAD * 2)}px`;
  }
}

function layoutAll() {
  arrangePanes();
  for (const pane of panes) pane.layout();
}

// Each stage is watched (Pane), but once the row scrolls the panes have
// fixed widths and the stages no longer change with the sidebar; the row
// itself always does.
if (!offscreen) new ResizeObserver(layoutAll).observe(panesEl);

let noticeTimer = 0;
function showNotice(text) {
  noticeText.textContent = text;
  setNotice(true);
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => setNotice(false), 8000);
}

function setNotice(show) {
  notice.classList.toggle('show', show);
  notice.setAttribute('aria-hidden', String(!show));
}

function showRestricted(url) {
  pageUrl = url;
  urlLabel.textContent = url;
  placeholder.hidden = true;
  for (const pane of panes) {
    pane.el.hidden = false;
    pane.showRestricted(url);
  }
}

function updatePaneControls() {
  addDeviceButton.hidden = panes.length >= Mirrorly.MAX_DEVICES;
  for (const pane of panes) pane.el.querySelector('.remove').hidden = panes.length < 2;
}

function addPane(config) {
  const pane = new Pane(config);
  panes.push(pane);
  panesEl.append(pane.el);
  updatePaneControls();
  return pane;
}

function removePane(pane) {
  if (panes.length < 2) return;
  panes.splice(panes.indexOf(pane), 1);
  pane.destroy();
  saveDevices();
  updatePaneControls();
  layoutAll();
}

function paneForSlot(slot) {
  return panes.find((pane) => pane.slot === slot);
}

function updateSummary() {
  const on = Object.keys(SYNC_NAMES).filter((key) => settings[key]).map((key) => SYNC_NAMES[key]);
  const list = on.length > 1 ? `${on.slice(0, -1).join(', ')} & ${on.at(-1)}` : on[0];
  const dot = document.createElement('span');
  dot.className = on.length ? 'dot' : 'dot off';
  summaryText.replaceChildren(dot, on.length ? `Syncing ${list}` : 'Sync is off');
  summary.title = settings.panelOpen ? 'Hide settings' : 'Show settings';
}

function showSettings(open) {
  settingsPanel.classList.toggle('open', open);
  settingsPanel.inert = !open;
  summary.setAttribute('aria-expanded', String(open));
  updateSummary();
  if (open) updateAgentStatus();
}

// The AI agents row in the settings: off, on and waiting for an agent, or
// connected (and to which app). Kept current while the settings are open.
async function updateAgentStatus() {
  let s;
  try {
    s = await browser.runtime.sendMessage({ type: 'agentStatus' });
  } catch {
    return;
  }
  const state = !s.on ? 'off' : s.connected ? 'on' : 'waiting';
  const apps = [...new Set(s.clients.map(Mirrorly.agentAppName))];
  document.getElementById('agent-dot').dataset.state = state;
  document.getElementById('agent-title').textContent =
    state === 'off' ? 'Off' : state === 'waiting' ? 'On · waiting for an agent' : `Connected${apps.length ? ` to ${apps.join(', ')}` : ''}`;
  document.getElementById('agent-sub').textContent =
    state === 'off'
      ? 'Let coding agents open pages in a phone and screenshot them'
      : s.phones
        ? `${s.phones} agent phone${s.phones > 1 ? 's' : ''} open, in background tabs`
        : 'Pages agents open appear in a background tab';
}

function buildControls() {
  for (const [size, label] of Mirrorly.TEXT_SIZES) textSizeSelect.append(new Option(label, size));
  textSizeSelect.value = settings.textSize;
  textSizeSelect.addEventListener('change', () => {
    save({ textSize: Number(textSizeSelect.value) });
    for (const pane of panes) pane.rebuild();
  });

  document.getElementById('agents').addEventListener('click', () => browser.runtime.openOptionsPage());
  setInterval(() => settings.panelOpen && updateAgentStatus(), 2000);

  showSettings(settings.panelOpen);
  summary.addEventListener('click', () => {
    save({ panelOpen: !settings.panelOpen });
    showSettings(settings.panelOpen);
  });

  for (const radio of document.querySelectorAll('input[name="appearance"]')) {
    radio.checked = radio.value === settings.appearance;
    radio.addEventListener('change', () => {
      save({ appearance: radio.value });
      layoutAll();
    });
  }
  systemDark.addEventListener('change', layoutAll);

  for (const input of document.querySelectorAll('[data-setting]')) {
    const key = input.dataset.setting;
    input.checked = Boolean(settings[key]);
    input.addEventListener('change', () => {
      save({ [key]: input.checked });
      updateSummary();
      // Both are fixed when a frame is created.
      if (key === 'mobileUA' || key === 'touchMode') for (const pane of panes) pane.rebuild();
      if (key === 'softKeyboard') layoutAll();
    });
  }

  document.getElementById('notice-close').addEventListener('click', () => setNotice(false));

  addDeviceButton.addEventListener('click', () => {
    if (panes.length >= Mirrorly.MAX_DEVICES) return;
    // Each new device is one not shown yet, smallest iPhone first.
    const shown = new Set(panes.map((p) => p.config.device));
    const device = NEW_DEVICES.find((id) => !shown.has(id)) || NEW_DEVICES[0];
    const pane = addPane({ device, frame: 'safari' });
    saveDevices();
    if (pageUrl) pane.load(pageUrl);
    pane.el.scrollIntoView({ inline: 'end', behavior: 'smooth' });
  });
}

function showPage(url) {
  pageUrl = url;
  placeholder.hidden = true;
  urlLabel.textContent = url;
  for (const pane of panes) {
    pane.el.hidden = false;
    pane.load(url);
  }
}

function showBlank() {
  pageUrl = null;
  urlLabel.textContent = '';
  placeholder.hidden = false;
  for (const pane of panes) {
    pane.showBlank();
    pane.el.hidden = true;
  }
}

async function countTabs() {
  tabCount = (await browser.tabs.query({ windowId })).length;
  for (const pane of panes) pane.renderOverlay();
}

// --- Capture mode: this page in a background tab, holding one phone at full
// size for a screenshot (see background.js).

function initCapture() {
  document.body.classList.add('capture');
  windowId = `capture-${captureId}`;
  port = browser.runtime.connect({ name: `capture:${captureId}` });
  let pane = null;
  let fullPage = false;
  let started = false;
  let onPageSize = null;

  // The phone's page height, in its layout px.
  const pageSize = (type) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 5000);
      onPageSize = (height) => {
        clearTimeout(timer);
        resolve(height);
      };
      port.postMessage({ type, slot: pane.slot });
    });

  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'setup') {
      fullPage = msg.mode === 'full';
      pane = addPane(msg.config);
      pane.frameless = msg.mode === 'screen';
      document.body.classList.toggle('frameless', pane.frameless);
      pane.load(msg.url);
    } else if (!pane) {
      return;
    } else if (msg.type === 'tint') {
      if (/^rgba?\([\d.,\s%]+\)$/.test(msg.color)) pane.tint = msg.color;
      pane.layout();
    } else if (msg.type === 'viewport') {
      pane.layoutWidth = msg.width;
      pane.layout();
    } else if (msg.type === 'location') {
      pane.currentUrl = msg.url;
      pane.renderOverlay();
    } else if (msg.type === 'pageSize') {
      onPageSize?.(msg.height);
      onPageSize = null;
    } else if (msg.type === 'phoneReady' && !started) {
      started = true;
      // Let late content settle, restore the scroll position (or grow to the
      // whole page), then capture.
      await sleep(900);
      if (fullPage) await growToPage(pane, pageSize);
      else port.postMessage({ type: 'scrollTo', slot: pane.slot });
      // Lazy-loaded images near the new position need a moment.
      await sleep(1500);
      pane.layout();
      const rect = pane.captureRect();
      // Very long pages are saved at a lower pixel ratio, to stay within the
      // largest image Firefox will make.
      const scale = Math.min(pane.device().dpr || 2, MAX_CAPTURE_PX / rect.height);
      port.postMessage({ type: 'captureReady', rect, scale });
    } else if (msg.type === 'captured') {
      try {
        const filename = await pane.saveCapture(msg.dataUrl);
        port.postMessage({ type: 'saved', filename });
      } catch (e) {
        port.postMessage({ type: 'failed', error: String(e.message || e) });
      }
    }
  });
}

// Grows the pane's screen to the page's height (in the screen's px, which
// differ for pages laid out wider and zoomed out), until the page stops
// growing as late content loads into the newly visible part. pageSize(type)
// asks the phone for its page height ('freezeViewport' first, then
// 'measurePage').
async function growToPage(pane, pageSize, repaint) {
  let height = await pageSize('freezeViewport');
  for (let tries = 0; height && tries < 4; tries++) {
    const d = Mirrorly.device(pane.config);
    const width = pane.config.landscape && d.kind !== 'fit' ? d.height : d.width;
    const zoom = pane.layoutWidth ? width / pane.layoutWidth : 1;
    const next = Math.ceil(height * zoom);
    if (Math.abs(next - (pane.pageHeight || 0)) < 2) break;
    pane.pageHeight = next;
    panesEl.style.height = `${next + CAPTURE_MARGIN * 2}px`;
    pane.layout();
    await repaint?.();
    await sleep(1500);
    height = await pageSize('measurePage');
  }
}

// --- Agent mode: an AI agent's phone in a background tab, driven by the
// commands background-agent.js passes on from the MCP server.

function initAgent() {
  document.body.classList.add('capture');
  document.title = 'Mirrorly · AI agent';
  windowId = `agent-${agentSession}`;
  port = browser.runtime.connect({ name: `agent:${agentSession}` });
  let pane = null;
  let queue = Promise.resolve();
  const waiters = new Map(); // message type -> resolve

  // Resolves with the next message of `type` from the phone or background
  // (after calling send), or rejects after `ms`.
  const waitFor = (type, ms, send) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(type);
        reject(new Error(type === 'phoneReady' ? "The page didn't finish loading in time." : `No answer from the phone (${type}).`));
      }, ms);
      waiters.set(type, (msg) => {
        clearTimeout(timer);
        waiters.delete(type);
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg);
      });
      send?.();
    });
  const settle = (type, msg) => waiters.get(type)?.(msg);
  // After the phone's frame is made or resized: background tabs aren't
  // drawn, so the page only learns its new size when the tab is
  // (background-agent.js draws a pixel of it).
  const repaint = async () => {
    await waitFor('repainted', 5000, () => port.postMessage({ type: 'repaint' })).catch(() => {});
    await sleep(150);
  };
  const pageSize = (type) => waitFor('pageSize', 5000, () => port.postMessage({ type, slot: pane.slot })).then((m) => m.height, () => null);
  const scroll = (args) => waitFor('scrolled', 10000, () => port.postMessage({ type: 'agentScroll', slot: pane.slot, ...args }));

  const sameConfig = (a, b) => ['device', 'frame', 'landscape', 'customWidth', 'customHeight'].every((k) => a[k] === b[k]);

  const commands = {
    // Loads `url` in the phone (a new one if the device or browser changed),
    // waits for it, and reports the page.
    async open({ url, device = 'iphone-16-pro', frame = 'safari', landscape = false, appearance = 'light', width, height }) {
      const config = { device, frame, landscape: Boolean(landscape), customWidth: width || 402, customHeight: height || 874 };
      const look = appearance === 'dark' ? 'dark' : 'light';
      if (!pane || !sameConfig(pane.config, config) || settings.appearance !== look) {
        settings.appearance = look;
        pane?.destroy();
        panes.length = 0;
        panesEl.replaceChildren();
        pane = addPane(config);
      }
      const ready = waitFor('phoneReady', 45000);
      pane.blocked = false;
      if (pane.frame) pane.navigate(url);
      else pane.load(url);
      await repaint();
      await ready;
      await repaint();
      await sleep(1000);
      const at = await scroll({ position: 'current' });
      const d = pane.device();
      return {
        url: pane.currentUrl,
        title: at.title,
        device: d.label,
        browser: Mirrorly.FRAMES[pane.frameKind()],
        screen: { width: d.width, height: d.height },
        viewport: { width: Math.round(pane.viewport.offsetWidth), height: at.viewportHeight },
        pageHeight: at.pageHeight,
        y: at.y,
        maxY: at.max,
      };
    },

    async scroll(args) {
      const at = await scroll(args);
      // Lazy-loaded content near the new position.
      await sleep(700);
      return { y: at.y, maxY: at.max, viewportHeight: at.viewportHeight, pageHeight: at.pageHeight, found: at.found };
    },

    // mode: 'frame' | 'screen' (the page as shown, no frame) | 'full' (the
    // whole page). resolution: 'css' (1 image px per CSS px) or 'device'
    // (the phone's own pixel ratio). maxEdge caps the longer side.
    async screenshot({ mode = 'frame', resolution = 'css', maxEdge = MAX_CAPTURE_PX }) {
      const full = mode === 'full';
      const before = full ? await scroll({ position: 'current' }) : null;
      pane.frameless = mode !== 'frame';
      document.body.classList.toggle('frameless', pane.frameless);
      try {
        if (full) await growToPage(pane, pageSize, repaint);
        pane.layout();
        await sleep(full ? 1500 : 300);
        const rect = pane.captureRect();
        const base = resolution === 'device' ? pane.device().dpr || 2 : 1;
        const scale = Math.min(base, Math.min(maxEdge, MAX_CAPTURE_PX) / Math.max(rect.width, rect.height));
        const shot = await waitFor('captured', 30000, () => port.postMessage({ type: 'captureReady', rect, scale }));
        const canvas = await pane.renderCapture(shot.dataUrl);
        const dataUrl = canvas.toDataURL('image/png');
        // Agent apps take images up to about 5 MB; past that, a JPEG to look at
        // (the PNG is still saved).
        let preview = null;
        for (let k = 1, q = 0.85; dataUrl.length > AGENT_IMAGE_CHARS && (!preview || preview.length > AGENT_IMAGE_CHARS) && k > 0.2; k *= 0.75, q = 0.75) {
          const small = document.createElement('canvas');
          small.width = Math.round(canvas.width * k);
          small.height = Math.round(canvas.height * k);
          const ctx = small.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, small.width, small.height);
          ctx.drawImage(canvas, 0, 0, small.width, small.height);
          preview = small.toDataURL('image/jpeg', q);
        }
        return { dataUrl, preview, width: canvas.width, height: canvas.height, scale };
      } finally {
        pane.frameless = false;
        document.body.classList.remove('frameless');
        if (full) {
          // The page's 100vh was fixed for the capture: reload it as it was.
          pane.pageHeight = null;
          panesEl.style.height = '';
          pane.layout();
          // A new frame, so nothing more comes from the old page.
          const ready = waitFor('phoneReady', 45000);
          pane.rebuild();
          await repaint();
          await ready.catch(() => {});
          await repaint();
          // Again once late images have changed the page's height.
          for (const wait of [600, 900]) {
            await sleep(wait);
            await scroll({ y: before.y }).catch(() => {});
          }
        }
      }
    },
  };

  port.onMessage.addListener((msg) => {
    if (msg.type === 'agentCommand') {
      // One at a time, in order.
      queue = queue.then(async () => {
        try {
          if (!commands[msg.cmd]) throw new Error(`Unknown command: ${msg.cmd}`);
          if (msg.cmd !== 'open' && !pane) throw new Error('No page is open yet: call open first.');
          const data = await commands[msg.cmd](msg.args || {});
          port.postMessage({ type: 'agentDone', id: msg.id, data });
        } catch (e) {
          port.postMessage({ type: 'agentDone', id: msg.id, error: String(e.message || e) });
        }
      });
      return;
    }
    if (!pane) return;
    if (msg.type === 'tint') {
      if (/^rgba?\([\d.,\s%]+\)$/.test(msg.color)) pane.tint = msg.color;
      pane.layout();
    } else if (msg.type === 'viewport') {
      pane.layoutWidth = msg.width;
      pane.layout();
    } else if (msg.type === 'location') {
      pane.currentUrl = msg.url;
      pane.renderOverlay();
    } else if (['phoneReady', 'pageSize', 'scrolled', 'captured', 'repainted'].includes(msg.type)) {
      settle(msg.type, msg);
    } else if (msg.type === 'restricted') {
      settle('phoneReady', { error: "Firefox doesn't let extensions work on this site, so Mirrorly can't show it." });
    } else if (msg.type === 'loop') {
      pane.showMessage('loop');
      settle('phoneReady', { error: MESSAGES.loop.text });
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function init() {
  if (captureId || agentSession) {
    settings = await Mirrorly.loadSettings();
    if (captureId) initCapture();
    else initAgent();
    return;
  }
  // ?window=<id> or ?window=other lets the page be opened in a tab for
  // testing, paired with another window.
  const param = new URLSearchParams(location.search).get('window');
  const current = await browser.windows.getCurrent();
  if (param === 'other') {
    const windows = await browser.windows.getAll({ windowTypes: ['normal'] });
    windowId = (windows.find((w) => w.id !== current.id) || current).id;
  } else {
    windowId = param ? Number(param) : current.id;
  }
  settings = await Mirrorly.loadSettings();
  port = browser.runtime.connect({ name: `sidebar:${windowId}` });
  buildControls();
  for (const config of settings.devices.slice(0, Mirrorly.MAX_DEVICES)) addPane(config);
  if (!panes.length) addPane({});

  port.onMessage.addListener((msg) => {
    const pane = paneForSlot(msg.slot);
    if (msg.type === 'notice') {
      showNotice(msg.text);
    } else if (msg.type === 'reloadViews') {
      for (const p of panes) p.reload();
    } else if (msg.type === 'restricted') {
      if (pane) pane.showRestricted(msg.url);
      else showRestricted(msg.url);
    } else if (msg.type === 'load') showPage(msg.url);
    else if (msg.type === 'blank') showBlank();
    else if (!pane) return;
    else if (msg.type === 'location') {
      pane.currentUrl = msg.url;
      if (pane === panes[0]) urlLabel.textContent = msg.url;
      pane.renderOverlay();
    } else if (msg.type === 'tint') {
      // Computed colours only; anything else would end up in markup.
      if (/^rgba?\([\d.,\s%]+\)$/.test(msg.color)) pane.tint = msg.color;
      pane.layout();
    } else if (msg.type === 'viewport') {
      pane.layoutWidth = msg.width;
      pane.layout();
    } else if (msg.type === 'loop') {
      pane.showMessage('loop');
    } else if (msg.type === 'keyboard') {
      pane.setKeyboard(msg);
    } else if (msg.type === 'unloading') {
      pane.setLoading(true);
    } else if (msg.type === 'phoneReady') {
      pane.setLoading(false);
    } else if (msg.type === 'located') {
      const d = pane.device();
      const name = d.id === 'custom' || d.kind === 'fit' ? 'phone' : d.label.split(' / ')[0];
      if (!msg.found) showNotice(`That isn't on the ${name}'s page. It may be left out of the mobile layout.`);
      else if (msg.nearest) showNotice(`That's hidden on the ${name}, so the part of the page around it is shown instead.`);
    }
  });

  setInterval(() => {
    for (const pane of panes) pane.renderOverlay();
  }, 15000);
  for (const event of ['onCreated', 'onRemoved', 'onAttached', 'onDetached']) browser.tabs[event].addListener(countTabs);
  countTabs();
}

init();
