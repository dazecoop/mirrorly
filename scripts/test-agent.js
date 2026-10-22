#!/usr/bin/env node
/**
 * End-to-end test of the agent tools: runs `mirrorly mcp` over stdio and
 * drives it as an agent app would, against the Driftwood demo site served on
 * localhost.
 *
 *   1. headless: nothing is connected, so the server starts its own Firefox
 *   2. browser:  a Firefox standing in for the user's, with Mirrorly installed
 *                and "Let AI agents use Mirrorly" on, with via: "browser"
 *
 * Uses its own bridge port and state folder, so a real setup isn't touched.
 * Needs Firefox. Usage: npm run test:agent
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { Builder } = require('selenium-webdriver');
const firefox = require('selenium-webdriver/firefox');
const { buildXpi } = require('../agent/xpi');

const ROOT = path.join(__dirname, '..');
const PORT = 47690;
const UUID = '6d1f6a0e-4c1b-4b8e-9d1c-6b9a3f2e7c11';
const SITE = path.join(__dirname, 'demo-sites', 'driftwood');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg' };

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(SITE, path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/\/$/, '/index.html'));
    if (!file.startsWith(SITE) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// A minimal MCP client over the server's stdio.
function mcpClient(env) {
  const proc = spawn(process.execPath, [path.join(ROOT, 'agent', 'cli.js'), 'mcp'], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map();
  let buf = '';
  let next = 1;
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      pending.get(msg.id)?.(msg);
    }
  });
  const call = (method, params) =>
    new Promise((resolve) => {
      const id = next++;
      pending.set(id, resolve);
      proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  const tool = async (name, args = {}) => (await call('tools/call', { name, arguments: args })).result;
  return { proc, call, tool, close: () => proc.stdin.end() };
}

const textOf = (r) => r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');

function pngSize(b64) {
  const buf = Buffer.from(b64, 'base64');
  return buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) } : null;
}

async function exercise(client, url, via, label) {
  const opened = await client.tool('mirrorly_open', { url, device: 'iphone-16-pro', appearance: 'dark', via });
  check(`${label}: open`, !opened.isError && /Driftwood/.test(textOf(opened)), textOf(opened).split('\n').join(' | '));
  const expect = via === 'browser' ? /your Firefox/ : /headless Firefox/;
  check(`${label}: ran in the expected browser`, expect.test(textOf(opened)));

  const frame = await client.tool('mirrorly_screenshot', {});
  const img = frame.content.find((c) => c.type === 'image');
  const size = img && pngSize(img.data);
  check(`${label}: frame screenshot (phone + outline, 1x)`, size && size.width > 402 && size.width < 460, JSON.stringify(size));
  const file = textOf(frame).match(/saved to (.+\.png)/)?.[1];
  check(`${label}: screenshot saved to a file`, Boolean(file && fs.existsSync(file)), file);

  const scrolled = await client.tool('mirrorly_scroll', { selector: '#weekend' });
  check(`${label}: scroll to a selector`, !scrolled.isError && /Scrolled to y=\d+/.test(textOf(scrolled)) && !/y=0 /.test(textOf(scrolled)), textOf(scrolled));
  const missing = await client.tool('mirrorly_scroll', { selector: '#nope' });
  check(`${label}: missing selector is an error`, missing.isError === true);

  const screen = await client.tool('mirrorly_screenshot', { mode: 'screen', resolution: 'device' });
  const s2 = pngSize(screen.content.find((c) => c.type === 'image').data);
  check(`${label}: screen screenshot at 3x (402×812 page)`, s2 && s2.width === 1206 && s2.height === 2436, JSON.stringify(s2));

  const full = await client.tool('mirrorly_screenshot', { mode: 'full' });
  const s3 = pngSize(full.content.find((c) => c.type === 'image')?.data || '') || {};
  check(`${label}: full-page screenshot`, s3.width === 402 && s3.height > 1500, JSON.stringify(s3) + (full.isError ? ` ${textOf(full)}` : ''));

  const after = await client.tool('mirrorly_scroll', { by: 0 });
  check(`${label}: scroll position kept after a full-page shot`, /y=(\d+)/.exec(textOf(after))?.[1] === /y=(\d+)/.exec(textOf(scrolled))?.[1], `${textOf(scrolled)} / ${textOf(after)}`);
}

async function main() {
  const server = await serve();
  const url = `http://localhost:${server.address().port}/`;
  const env = { MIRRORLY_PORT: String(PORT), MIRRORLY_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'mirrorly-state-')) };
  let browser = null;
  try {
    // 1. Headless
    const a = mcpClient(env);
    const init = await a.call('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'test' }, capabilities: {} });
    check('initialize', init.result?.serverInfo?.name === 'mirrorly');
    const tools = (await a.call('tools/list')).result.tools.map((t) => t.name);
    check('tools/list', ['mirrorly_open', 'mirrorly_scroll', 'mirrorly_screenshot', 'mirrorly_devices', 'mirrorly_status'].every((t) => tools.includes(t)), tools.join(', '));
    check('status', /^Mirrorly MCP is working/.test(textOf(await a.tool('mirrorly_status'))));
    check('devices', /iphone-se: iPhone SE/.test(textOf(await a.tool('mirrorly_devices'))));
    check('bad device is an error', (await a.tool('mirrorly_open', { url, device: 'nokia-3310' })).isError === true);
    check('safari on Android is an error', (await a.tool('mirrorly_open', { url, device: 'pixel', browser: 'safari' })).isError === true);
    await exercise(a, url, 'auto', 'headless');
    a.close();

    // 2. A Firefox standing in for the user's, with the switch on.
    const options = new firefox.Options().addArguments('-headless').setPreference('extensions.webextensions.uuids', JSON.stringify({ 'mirrorly@dazecoop': UUID }));
    browser = await new Builder().forBrowser('firefox').setFirefoxOptions(options).setFirefoxService(new firefox.ServiceBuilder().addArguments('--allow-system-access')).build();
    await browser.installAddon(buildXpi(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mirrorly-')), 'm.xpi')), true);
    await browser.get(`moz-extension://${UUID}/sidebar/sidebar.html?window=other`);
    await browser.executeScript('return browser.storage.local.set(arguments[0])', { agentBridge: true, agentPort: PORT });
    await browser.get('about:blank');
    const b = mcpClient(env);
    await b.call('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'test' }, capabilities: {} });
    await exercise(b, url, 'browser', 'your Firefox');
    check('status names the connected Firefox', /via the Mirrorly extension/.test(textOf(await b.tool('mirrorly_status'))));
    b.close();
  } finally {
    await browser?.quit();
    server.close();
  }
  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
