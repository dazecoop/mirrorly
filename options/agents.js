'use strict';

// The AI agents page: the switch, live connection status, and how to set up
// and use Mirrorly's MCP server. Opened from the sidebar's settings, or as
// Mirrorly's preferences in about:addons.

const PACKAGE = 'github:dazecoop/mirrorly';
const $ = (id) => document.getElementById(id);

const APPS = {
  '': {
    where: 'Adds Mirrorly to every agent app found on this computer: Claude Code, Claude Desktop and Cursor.',
    after: 'Then restart each app (fully quit Claude Desktop). Claude Code also gets a Mirrorly skill, so it knows when to use it.',
  },
  'claude-code': { where: 'Adds Mirrorly to Claude Code, for all your projects, with its skill.', after: 'Then start a new Claude Code session (in VS Code: reload the window).' },
  'claude-desktop': { where: 'Adds Mirrorly to Claude Desktop.', after: 'Then fully quit Claude Desktop (⌘Q) and reopen it; a new chat is not enough.' },
  cursor: { where: 'Adds Mirrorly to Cursor.', after: 'Then reload Cursor and check mirrorly is enabled under Cursor Settings → MCP.' },
  vscode: { where: 'Run it in your project\'s folder: it adds Mirrorly to that project\'s .vscode/mcp.json.', after: 'Then in VS Code run "MCP: List Servers" and start mirrorly.' },
};

const PROMPTS = {
  check: (url, d) => `Use Mirrorly to open ${url} on ${d.name}, take a full-page screenshot, and tell me anything that looks broken or awkward on mobile: overflow, cramped or overlapping text, tap targets too small, content hidden behind the browser bars.`,
  compare: (url, d) => `Use Mirrorly to open ${url} on ${d.name} and on ${d.android ? 'an iPhone 17 (Safari)' : 'a Pixel 10 (Chrome)'}. Take a full-page screenshot of each and compare them: what differs, and what looks wrong on either?`,
  dark: (url, d) => `Use Mirrorly to open ${url} on ${d.name} in light mode and then dark mode, screenshot both, and point out anything that's hard to read or looks broken in dark mode.`,
  fix: (url, d) => `Use Mirrorly to open ${url} on ${d.name} and screenshot it. Fix the mobile layout problems you find in the code, then open it again and screenshot the same part of the page to show the before and after.`,
};

let settings = {};
let app = '';
let use = 'agent';
let kind = 'check';

function port() {
  return Number(settings.agentPort) || Mirrorly.DEFAULTS.agentPort;
}

function portPrefix() {
  return port() === Mirrorly.DEFAULTS.agentPort ? '' : `MIRRORLY_PORT=${port()} `;
}

function render() {
  $('enabled').checked = Boolean(settings.agentBridge);
  $('port').value = port();
  $('addr').textContent = `ws://127.0.0.1:${port()}`;
  const target = app ? ` ${app}` : '';
  $('install').textContent = `${portPrefix()}npx -y ${PACKAGE} install${target}`;
  $('uninstall').textContent = `npx -y ${PACKAGE} uninstall${target}`;
  $('install-where').textContent = APPS[app].where;
  $('install-after').textContent = APPS[app].after;
  for (const tab of document.querySelectorAll('#app-tabs .tab')) tab.classList.toggle('on', tab.dataset.app === app);

  const seen = Number(settings.agentSeenAt) || 0;
  $('setup-done').hidden = !seen;
  $('setup-title').hidden = Boolean(seen);
  if (seen) $('setup-done-sub').textContent = `An agent connected ${ago(seen)}. The instructions are below if you need them again.`;

  const url = $('url').value.trim() || 'http://localhost:3000';
  const select = $('device');
  const d = Mirrorly.DEVICES.find((x) => x.id === select.value) || Mirrorly.DEVICES[0];
  const name = `an ${d.label.split(' / ')[0]}`.replace(/^an (?![AEIOU]|iP)/, 'a ');
  $('prompt').textContent = PROMPTS[kind](url, { name, android: d.kind === 'android' });
  $('cli').textContent = [
    `npx -y ${PACKAGE} screenshot ${url} --device ${d.id} --mode full --out mobile.png`,
    `npx -y ${PACKAGE} screenshot ${url} --device pixel --browser chrome --appearance dark --out pixel-dark.png`,
    `npx -y ${PACKAGE} devices`,
  ].join('\n');
  for (const tab of document.querySelectorAll('#use-tabs .tab')) tab.classList.toggle('on', tab.dataset.use === use);
  $('use-agent').hidden = use !== 'agent';
  $('use-cli').hidden = use !== 'cli';
  for (const chip of document.querySelectorAll('#prompt-kinds .chip')) chip.classList.toggle('on', chip.dataset.kind === kind);
}

function ago(time) {
  const s = Math.round((Date.now() - time) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(time).toLocaleDateString();
}

async function refreshStatus() {
  let s;
  try {
    s = await browser.runtime.sendMessage({ type: 'agentStatus' });
  } catch {
    return;
  }
  const state = !s.on ? 'off' : s.connected ? 'on' : 'waiting';
  $('status').dataset.state = state;
  const apps = s.clients.map(Mirrorly.agentAppName);
  const last = s.last ? ` Last: ${s.last.cmd === 'open' ? `opened ${s.last.url}` : s.last.cmd}, ${ago(s.last.at)}.` : '';
  if (state === 'off') {
    $('status-title').textContent = 'Off';
    $('status-sub').textContent = 'Agents can still use Mirrorly, in a separate headless Firefox without your logins.';
  } else if (state === 'waiting') {
    $('status-title').textContent = 'On · waiting for an agent';
    $('status-sub').textContent = 'Connects when an agent app with Mirrorly is running. Checked every 5 seconds.';
  } else {
    $('status-title').textContent = `Connected${apps.length ? ` to ${[...new Set(apps)].join(', ')}` : ''}`;
    $('status-sub').textContent = s.phones
      ? `${s.phones} agent phone${s.phones > 1 ? 's' : ''} open, in background tabs.${last}`
      : `Pages it opens appear in a background tab here, signed in as you.${last}`;
  }
  $('retry').hidden = state !== 'waiting';
  $('close-phones').hidden = !s.phones;
}

async function save(changes) {
  Object.assign(settings, changes);
  await browser.storage.local.set(changes);
  render();
  refreshStatus();
}

async function init() {
  settings = await Mirrorly.loadSettings();
  const select = $('device');
  for (const d of Mirrorly.DEVICES.filter((x) => !['fit', 'custom'].includes(x.kind) && x.id !== 'custom')) {
    select.append(new Option(`${d.label} (${d.width}×${d.height})`, d.id));
  }
  select.value = 'iphone-16-pro';
  // Folded away once an agent has connected.
  $('setup-fold').open = !settings.agentSeenAt;

  $('enabled').addEventListener('change', (e) => save({ agentBridge: e.target.checked }));
  $('port').addEventListener('change', (e) => {
    const value = Math.round(Number(e.target.value));
    if (value >= 1024 && value <= 65535) save({ agentPort: value });
    else render();
  });
  $('retry').addEventListener('click', () => browser.runtime.sendMessage({ type: 'agentRetry' }).then(() => setTimeout(refreshStatus, 500)));
  $('close-phones').addEventListener('click', () => browser.runtime.sendMessage({ type: 'agentClosePhones' }).then(refreshStatus));
  for (const tab of document.querySelectorAll('#app-tabs .tab')) {
    tab.addEventListener('click', () => {
      app = tab.dataset.app;
      render();
    });
  }
  for (const tab of document.querySelectorAll('#use-tabs .tab')) {
    tab.addEventListener('click', () => {
      use = tab.dataset.use;
      render();
    });
  }
  for (const chip of document.querySelectorAll('#prompt-kinds .chip')) {
    chip.addEventListener('click', () => {
      kind = chip.dataset.kind;
      render();
    });
  }
  $('url').addEventListener('input', render);
  select.addEventListener('change', render);
  for (const button of document.querySelectorAll('[data-copy]')) {
    button.addEventListener('click', async () => {
      await navigator.clipboard.writeText($(button.dataset.copy).textContent);
      button.textContent = 'Copied';
      setTimeout(() => (button.textContent = 'Copy'), 1500);
    });
  }
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [key, { newValue }] of Object.entries(changes)) settings[key] = newValue;
    render();
  });

  render();
  refreshStatus();
  setInterval(refreshStatus, 1500);
}

init();
