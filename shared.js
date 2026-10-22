// Shared by the background script, the sidebar page and the content script.
var Mirrorly = {
  DEFAULTS: {
    // One entry per device shown in the sidebar (at most MAX_DEVICES).
    devices: [{ device: 'iphone-16-pro', frame: 'safari', customWidth: 402, customHeight: 874 }],
    appearance: 'auto',
    textSize: 17,
    touchMode: true,
    softKeyboard: true,
    panelOpen: false,
    syncScroll: true,
    syncClicks: true,
    syncInputs: true,
    syncNav: true,
    mobileUA: true,
    // "Let AI agents use Mirrorly": connect to the MCP server on this
    // computer (agent/bridge.js) at ws://127.0.0.1:<agentPort>.
    agentBridge: false,
    agentPort: 47616,
    agentSeenAt: 0, // when an agent's server last connected
  },

  MAX_DEVICES: 10,

  // Safari 26 freezes the iOS version in its UA at 18_6. iPadOS Safari sends a
  // Mac UA by default, so the iPad preset does too.
  UA: {
    ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
    fxios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/145.0 Mobile/15E148 Safari/605.1.15',
    crios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.96 Mobile/15E148 Safari/604.1',
    android: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  },

  PLATFORM: { ios: 'iPhone', fxios: 'iPhone', crios: 'iPhone', android: 'Linux armv81', ipad: 'MacIntel' },
  VENDOR: { ios: 'Apple Computer, Inc.', fxios: 'Apple Computer, Inc.', crios: 'Apple Computer, Inc.', android: 'Google Inc.', ipad: 'Apple Computer, Inc.' },

  // Browsers on iOS all use WebKit, which tracks the system font by size.
  WEBKIT: ['ios', 'fxios', 'crios', 'ipad'],

  // Sizes are CSS px (iOS points). safeTop is the status bar height, safeBottom
  // the home indicator area. islandTop/cutout describe the camera cutout.
  // width 0 = use the sidebar's own size.
  // Phones with identical screens share an entry. bezel (where set) is the
  // body around the screen: home-button iPhones have deep top and bottom bars.
  DEVICES: [
    { id: 'fit', label: 'Fit sidebar', group: 'Other', width: 0, height: 0, ua: 'ios', kind: 'fit' },
    { id: 'iphone-se', label: 'iPhone SE', group: 'iPhone', width: 375, height: 667, dpr: 2, ua: 'ios', kind: 'iphone', radius: 0, safeTop: 20, safeBottom: 0, cutout: null, homeButton: true, bezel: { side: 18, top: 84, bottom: 84, radius: 56 } },
    { id: 'iphone-16e', label: 'iPhone 14 / 16e', group: 'iPhone', width: 390, height: 844, dpr: 3, ua: 'ios', kind: 'iphone', radius: 47.33, safeTop: 47, safeBottom: 34, cutout: 'notch' },
    { id: 'iphone-16', label: 'iPhone 16 / 15 / 14 Pro', group: 'iPhone', width: 393, height: 852, dpr: 3, ua: 'ios', kind: 'iphone', radius: 55, safeTop: 59, safeBottom: 34, cutout: 'island', islandTop: 11 },
    { id: 'iphone-16-pro', label: 'iPhone 17 / 17 Pro / 16 Pro', group: 'iPhone', width: 402, height: 874, dpr: 3, ua: 'ios', kind: 'iphone', radius: 62, safeTop: 62, safeBottom: 34, cutout: 'island', islandTop: 14 },
    // Status bar height estimated from the 17 Pro; Apple doesn't publish it.
    { id: 'iphone-air', label: 'iPhone Air', group: 'iPhone', width: 420, height: 912, dpr: 3, ua: 'ios', kind: 'iphone', radius: 62, safeTop: 62, safeBottom: 34, cutout: 'island', islandTop: 14 },
    { id: 'iphone-14-plus', label: 'iPhone 14 Plus', group: 'iPhone', width: 428, height: 926, dpr: 3, ua: 'ios', kind: 'iphone', radius: 53.33, safeTop: 47, safeBottom: 34, cutout: 'notch' },
    { id: 'iphone-16-plus', label: 'iPhone 16 Plus / 15 Plus / Pro Max 14–15', group: 'iPhone', width: 430, height: 932, dpr: 3, ua: 'ios', kind: 'iphone', radius: 55, safeTop: 59, safeBottom: 34, cutout: 'island', islandTop: 11 },
    { id: 'iphone-16-pro-max', label: 'iPhone 17 Pro Max / 16 Pro Max', group: 'iPhone', width: 440, height: 956, dpr: 3, ua: 'ios', kind: 'iphone', radius: 62, safeTop: 62, safeBottom: 34, cutout: 'island', islandTop: 14 },
    // Android CSS sizes depend on the phone's display-size setting; these are
    // the defaults. The A56 and Redmi figures are estimates from the panel
    // resolution.
    { id: 'galaxy', label: 'Galaxy S25 / S24', group: 'Android', width: 360, height: 780, dpr: 3, ua: 'android', kind: 'android', radius: 36, safeTop: 28, safeBottom: 16, cutout: 'punch' },
    { id: 'galaxy-ultra', label: 'Galaxy S25 Ultra / A56', group: 'Android', width: 412, height: 891, dpr: 2.625, ua: 'android', kind: 'android', radius: 30, safeTop: 30, safeBottom: 16, cutout: 'punch' },
    { id: 'redmi-note', label: 'Redmi Note 14', group: 'Android', width: 393, height: 873, dpr: 2.75, ua: 'android', kind: 'android', radius: 38, safeTop: 30, safeBottom: 16, cutout: 'punch' },
    { id: 'pixel', label: 'Pixel 10 / 9', group: 'Android', width: 412, height: 923, dpr: 2.625, ua: 'android', kind: 'android', radius: 44, safeTop: 32, safeBottom: 16, cutout: 'punch' },
    { id: 'pixel-xl', label: 'Pixel 10 Pro XL / 9 Pro XL', group: 'Android', width: 448, height: 997, dpr: 3, ua: 'android', kind: 'android', radius: 46, safeTop: 34, safeBottom: 16, cutout: 'punch' },
    { id: 'ipad-mini', label: 'iPad mini', group: 'Tablet', width: 744, height: 1133, dpr: 2, ua: 'ipad', kind: 'ipad', radius: 22, safeTop: 24, safeBottom: 20, cutout: null },
    { id: 'custom', label: 'Custom size…', group: 'Other', ua: 'ios', kind: 'iphone', dpr: 3, radius: 55, safeTop: 59, safeBottom: 34, cutout: 'island', islandTop: 11 },
  ],

  // iOS Text Size (Dynamic Type): the body size behind `font: -apple-system-body`.
  TEXT_SIZES: [
    [14, 'Extra small'],
    [15, 'Small'],
    [16, 'Medium'],
    [17, 'Large (default)'],
    [19, 'Extra large'],
    [21, 'XX large'],
    [23, 'XXX large'],
  ],

  FRAMES: {
    safari: 'Safari',
    'chrome-ios': 'Chrome',
    firefox: 'Firefox',
    chrome: 'Chrome',
    screen: 'No frame',
  },

  FRAMES_BY_KIND: {
    fit: ['screen'],
    iphone: ['safari', 'chrome-ios', 'firefox', 'screen'],
    android: ['chrome', 'screen'],
    ipad: ['safari', 'screen'],
  },

  // config is one entry of settings.devices.
  device(config) {
    const d = Mirrorly.DEVICES.find((x) => x.id === config.device) || Mirrorly.DEVICES[0];
    if (d.id !== 'custom') return d;
    return { ...d, width: config.customWidth, height: config.customHeight };
  },

  frame(config) {
    const frames = Mirrorly.FRAMES_BY_KIND[Mirrorly.device(config).kind];
    return frames.includes(config.frame) ? config.frame : frames[0];
  },

  uaKey(config) {
    const frame = Mirrorly.frame(config);
    if (frame === 'firefox') return 'fxios';
    if (frame === 'chrome-ios') return 'crios';
    return Mirrorly.device(config).ua;
  },

  // Settings saved before multi-device support kept one device's choices at
  // the top level.
  async loadSettings() {
    const stored = await browser.storage.local.get(null);
    const settings = { ...Mirrorly.DEFAULTS, ...stored };
    if (!stored.devices && stored.device) {
      settings.devices = [{
        device: stored.device,
        frame: stored.frame || 'safari',
        customWidth: stored.customWidth || 402,
        customHeight: stored.customHeight || 874,
      }];
    }
    for (const key of ['device', 'frame', 'customWidth', 'customHeight']) delete settings[key];
    return settings;
  },

  // Landscape layout (estimates until checked against device screenshots):
  // iPhones drop the status bar, keep a side inset the depth of the camera
  // cutout on both sides, and a strip at the bottom for the home indicator.
  // Chrome and Firefox show one toolbar across the top.
  LANDSCAPE: { toolbar: 50, homeStrip: 21 },

  FRAME_PREFIX: 'mirrorly-phone',

  // An agent app's MCP clientInfo name, as people call the app.
  agentAppName(name) {
    const names = [
      [/^claude-code$/i, 'Claude Code'],
      [/^claude-ai$|claude desktop/i, 'Claude Desktop'],
      [/cursor/i, 'Cursor'],
      [/visual studio code|vscode|copilot/i, 'VS Code'],
    ];
    return names.find(([re]) => re.test(name))?.[1] || name;
  },
};
