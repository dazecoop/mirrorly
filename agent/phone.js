// One agent session's phone: picks where it runs (the user's Firefox through
// the extension, or headless Firefox), and passes open/scroll/screenshot on.
// The backend chosen by open() is kept for the rest of the session, since the
// phone (its page and scroll position) lives there.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Bridge, DEFAULT_PORT, extensionRecentlySeen } = require('./bridge');
const { Headless } = require('./headless');
const { DEVICES, frameFor, browsersFor } = require('./devices');

// Claude and most agent apps refuse images over 8000px on a side.
const MAX_IMAGE_EDGE = 7900;
const SHOTS_DIR = path.join(os.tmpdir(), 'mirrorly-screenshots');

const VIA_LABEL = { browser: 'your Firefox (the Mirrorly extension)', headless: 'headless Firefox' };

class Phone {
  constructor({ client = 'mirrorly-cli', log = () => {} } = {}) {
    this.session = crypto.randomBytes(8).toString('hex');
    this.log = log;
    this.bridge = new Bridge({ port: Number(process.env.MIRRORLY_PORT) || DEFAULT_PORT, client });
    this.headless = new Headless({ log });
    this.via = null;
    this.page = null; // what open() last reported
  }

  // 'browser' if the extension is (or soon gets) connected, else 'headless'.
  async pick(via) {
    if (via === 'headless') return 'headless';
    await this.bridge.use();
    let connected = await this.bridge.extensionConnected();
    // A bridge that just opened hears from the extension on its next retry
    // (every 5s while its switch is on).
    if (!connected && this.bridge.mode === 'hub') {
      connected = await this.bridge.waitForExtension(via === 'browser' || extensionRecentlySeen() ? 6500 : 1500);
    }
    if (connected) return 'browser';
    if (via === 'browser') {
      throw new Error('Mirrorly in Firefox isn\'t connected. In Firefox, open the Mirrorly sidebar, click the line at the top for its settings, and turn on "Let AI agents use Mirrorly".');
    }
    return 'headless';
  }

  async run(cmd, args) {
    if (this.via === 'headless') return this.headless.command(this.session, cmd, args);
    await this.bridge.use();
    if (!(await this.bridge.extensionConnected())) await this.bridge.waitForExtension(6500);
    return this.bridge.command(this.session, cmd, args);
  }

  async open({ url, device = 'iphone-16-pro', browser = 'safari', appearance = 'light', landscape = false, width, height, via = 'auto' }) {
    if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('url must be an absolute http(s) URL.');
    if (!DEVICES.some((d) => d.id === device)) throw new Error(`Unknown device "${device}". mirrorly_devices lists them.`);
    const frame = frameFor(device, browser);
    if (!frame) throw new Error(`${browser} isn't offered for ${device}; it can be drawn in: ${browsersFor(device).join(', ')}.`);
    if (device === 'custom' && !(width >= 200 && width <= 3000 && height >= 200 && height <= 3000)) {
      throw new Error('A custom device needs width and height (200–3000 CSS px).');
    }
    const chosen = await this.pick(via);
    if (this.via && this.via !== chosen) await this.run('close').catch(() => {});
    this.via = chosen;
    this.page = await this.run('open', { url, device, frame, appearance, landscape, width, height });
    return { ...this.page, via: chosen };
  }

  requireOpen() {
    if (!this.via) throw new Error('No page is open yet: call mirrorly_open first.');
  }

  async scroll(args) {
    this.requireOpen();
    return this.run('scroll', args);
  }

  // Saves the PNG (to `savePath`, or a temp folder) and returns it with a
  // version small enough to hand an agent inline.
  async screenshot({ mode = 'frame', resolution = 'css', savePath } = {}) {
    this.requireOpen();
    const shot = await this.run('screenshot', { mode, resolution, maxEdge: MAX_IMAGE_EDGE });
    const png = Buffer.from(shot.dataUrl.split(',')[1], 'base64');
    let file = savePath;
    if (!file) {
      fs.mkdirSync(SHOTS_DIR, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      file = path.join(SHOTS_DIR, `${stamp}-${(this.page?.device || 'phone').split(' / ')[0].replace(/\W+/g, '-')}-${mode}.png`);
    }
    file = path.resolve(file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, png);
    const preview = shot.preview ? { mimeType: 'image/jpeg', data: shot.preview.split(',')[1] } : { mimeType: 'image/png', data: png.toString('base64') };
    return { file, width: shot.width, height: shot.height, bytes: png.length, preview };
  }

  async status() {
    let extension = null;
    let bridge = { mode: 'none', port: this.bridge.port };
    try {
      await this.bridge.use();
      if (this.bridge.mode === 'hub' && !(await this.bridge.extensionConnected())) await this.bridge.waitForExtension(5500);
      bridge = await this.bridge.status();
      extension = bridge.extension;
    } catch {}
    return { extension, bridge, via: this.via, page: this.page };
  }

  async close() {
    if (this.via) await Promise.race([this.run('close').catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
    await Promise.allSettled([this.bridge.close(), this.headless.close()]);
  }
}

module.exports = { Phone, VIA_LABEL, MAX_IMAGE_EDGE };
