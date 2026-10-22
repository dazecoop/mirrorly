// Mirrorly MCP server (stdio). Gives an AI agent a phone to look through:
//   mirrorly_open        load a URL in a phone (device, browser, light/dark)
//   mirrorly_scroll      scroll it: top, bottom, px, or to an element
//   mirrorly_screenshot  take a screenshot, returned as an image and saved
//   mirrorly_devices     the devices and browsers it can draw
//   mirrorly_status      where the phone runs, and what's open
//
// MCP over stdio is newline-delimited JSON-RPC 2.0. The handful of methods a
// tools-only server needs are implemented directly (as in Scorly). stdout
// carries protocol only; logs go to stderr.

const readline = require('readline');
const { Phone, VIA_LABEL } = require('./phone');
const { DEVICES, browsersFor } = require('./devices');

const VERSION = require('../package.json').version;
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = [
  'Mirrorly shows a web page as a real phone shows it: real iPhone and Android screen sizes, browser bars (Safari, Chrome, Firefox), user agent, safe areas and touch, all on this computer.',
  'Typical loop: mirrorly_open the URL (a dev server on localhost works) → mirrorly_screenshot → look at the image → mirrorly_scroll further down (or to a CSS selector) → screenshot again.',
  'Use mode "full" for the whole page in one image, "screen" for just the page without the phone frame, and the default "frame" to see what the browser bars cover.',
  'After changing code, open the URL again to reload it. The page is drawn by Firefox\'s engine, so engine-specific CSS can differ slightly from Safari or Chrome.',
].join(' ');

const TOOLS = [
  {
    name: 'mirrorly_open',
    description: 'Open a web page in a phone with Mirrorly and wait for it to load. Works on live sites and local dev servers (http://localhost:3000 etc.). Runs in the user\'s Firefox through the Mirrorly extension when its AI agents switch is on (signed-in pages work; it uses a background tab), otherwise in headless Firefox. Calling it again reloads the page, or switches device. Returns the page\'s title, viewport and height.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL.' },
        device: { type: 'string', default: 'iphone-16-pro', description: 'Device id from mirrorly_devices. Default iphone-16-pro (iPhone 17 / 17 Pro / 16 Pro, 402×874). Others include iphone-se, iphone-16-pro-max, pixel, galaxy-ultra, ipad-mini, custom.' },
        browser: { type: 'string', enum: ['safari', 'chrome', 'firefox', 'none'], default: 'safari', description: 'Browser drawn around the page (and its user agent). Android phones: chrome or none.' },
        appearance: { type: 'string', enum: ['light', 'dark'], default: 'light', description: 'The phone\'s light or dark mode (prefers-color-scheme).' },
        landscape: { type: 'boolean', default: false },
        width: { type: 'number', description: 'Screen width in CSS px, for device "custom".' },
        height: { type: 'number', description: 'Screen height in CSS px, for device "custom".' },
        via: { type: 'string', enum: ['auto', 'browser', 'headless'], default: 'auto', description: 'auto: the user\'s Firefox if connected, else headless. browser: require it (for signed-in pages). headless: never use it.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'mirrorly_scroll',
    description: 'Scroll the open page. Give exactly one of: position ("top" or "bottom"), y (px from the top), by (px, positive is down) or selector (a CSS selector; the element is brought into view). Returns the new scroll position and page height.',
    inputSchema: {
      type: 'object',
      properties: {
        position: { type: 'string', enum: ['top', 'bottom'] },
        y: { type: 'number', description: 'Scroll to this many CSS px from the top.' },
        by: { type: 'number', description: 'Scroll by this many CSS px (negative is up).' },
        selector: { type: 'string', description: 'CSS selector of an element to bring into view.' },
      },
    },
  },
  {
    name: 'mirrorly_screenshot',
    description: 'Screenshot the open page and return it as an image. The PNG is also saved to a file (its path is in the reply), for attaching or comparing later.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string', enum: ['frame', 'screen', 'full'], default: 'frame',
          description: 'frame: the phone as drawn, with its status bar and browser bars (what the user sees). screen: just the page in view, no frame or bars. full: the whole page from top to bottom, no frame.',
        },
        resolution: { type: 'string', enum: ['css', 'device'], default: 'css', description: 'css: one image px per CSS px (smaller, usually enough). device: the phone\'s own pixel ratio (e.g. 3× on an iPhone).' },
        save_to: { type: 'string', description: 'Where to save the PNG (default: a temp folder).' },
      },
    },
  },
  {
    name: 'mirrorly_devices',
    description: 'List the devices Mirrorly can draw (id, name, screen size in CSS px, pixel ratio) and the browsers each can be shown in.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'mirrorly_status',
    description: 'Show whether Mirrorly runs in the user\'s Firefox (extension connected) or headless Firefox, and what page is open.',
    inputSchema: { type: 'object', properties: {} },
  },
];

let phone = null;

function log(...args) {
  console.error('[mirrorly-mcp]', ...args);
}

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const toolError = (t) => ({ content: [{ type: 'text', text: t }], isError: true });

function describePage(p) {
  return [
    `${p.title ? `"${p.title}" — ` : ''}${p.url}`,
    `${p.device} (${p.screen.width}×${p.screen.height}) in ${p.browser}, via ${VIA_LABEL[p.via] || p.via}.`,
    `Viewport ${p.viewport.width}×${p.viewport.height} CSS px; page height ${p.pageHeight} px; scrolled to y=${p.y} of ${p.maxY}.`,
  ].join('\n');
}

async function callTool(name, args = {}) {
  if (name === 'mirrorly_open') return text(`Opened ${describePage(await phone.open(args))}`);

  if (name === 'mirrorly_scroll') {
    const given = ['position', 'y', 'by', 'selector'].filter((k) => args[k] !== undefined);
    if (given.length !== 1) return toolError('Give exactly one of position, y, by or selector.');
    const r = await phone.scroll({ [given[0]]: args[given[0]] });
    if (args.selector && !r.found) return toolError(`No visible element matches ${args.selector} on this page. The page is still at y=${r.y}.`);
    return text(`Scrolled to y=${r.y} of ${r.maxY} (viewport ${r.viewportHeight} px, page ${r.pageHeight} px).`);
  }

  if (name === 'mirrorly_screenshot') {
    const shot = await phone.screenshot({ mode: args.mode, resolution: args.resolution, savePath: args.save_to });
    const kb = Math.round(shot.bytes / 1024);
    const note = shot.preview.mimeType === 'image/jpeg' ? ' The image here is a smaller JPEG copy; the file is full size.' : '';
    return {
      content: [
        { type: 'image', data: shot.preview.data, mimeType: shot.preview.mimeType },
        { type: 'text', text: `${shot.width}×${shot.height} PNG (${kb} KB) saved to ${shot.file}.${note}` },
      ],
    };
  }

  if (name === 'mirrorly_devices') {
    const lines = DEVICES.map((d) => `- ${d.id}: ${d.label}${d.id === 'custom' ? ' (give width and height)' : ` — ${d.width}×${d.height} @${d.dpr}x`} — browsers: ${browsersFor(d.id).join(', ')}`);
    return text(lines.join('\n'));
  }

  if (name === 'mirrorly_status') {
    const s = await phone.status();
    // First line is fixed, so setup instructions can say what a working
    // install replies.
    const lines = [`Mirrorly MCP is working (v${VERSION}).`];
    lines.push(s.extension
      ? `Pages open in the user's Firefox via the Mirrorly extension (v${s.extension.version || '?'}, ${s.extension.browser || 'Firefox'}), in a background tab.`
      : 'The Mirrorly extension is not connected, so pages open in headless Firefox. (The user can turn on "Let AI agents use Mirrorly" in Mirrorly\'s settings.)');
    if (s.page) lines.push('', `Open now: ${describePage({ ...s.page, via: s.via })}`);
    return text(lines.join('\n'));
  }

  return toolError(`Unknown tool: ${name}`);
}

async function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize': {
      const client = params?.clientInfo?.name || 'mcp-client';
      if (!phone) phone = new Phone({ client, log });
      const requested = params?.protocolVersion;
      return {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'mirrorly', version: VERSION },
        instructions: INSTRUCTIONS,
      };
    }
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS };
    case 'tools/call':
      if (!phone) phone = new Phone({ log });
      try {
        return await callTool(params.name, params.arguments || {});
      } catch (err) {
        return toolError(err.message);
      }
    default:
      if (id === undefined) return undefined; // a notification
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
  }
}

function write(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function serve() {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    if (msg.id === undefined) {
      handle(msg).catch(() => {});
      return;
    }
    try {
      write({ jsonrpc: '2.0', id: msg.id, result: await handle(msg) });
    } catch (err) {
      write({ jsonrpc: '2.0', id: msg.id, error: { code: err.code || -32603, message: err.message } });
    }
  });

  const shutdown = async () => {
    await phone?.close();
    process.exit(0);
  };
  rl.on('close', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { serve, TOOLS };
