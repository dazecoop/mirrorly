// `mirrorly install|uninstall <app>`: add or remove Mirrorly's MCP server in
// an agent app's config, then prove the result instead of assuming it. (The
// same installer as Scorly's, plus a Claude Code skill.)
//
//   install    writes the entry, then launches the server exactly as the app
//              will (same command, args and env, without this shell's PATH)
//              and checks it answers with Mirrorly's tools. For Claude Code it
//              also installs the skill (~/.claude/skills/mirrorly/SKILL.md)
//   uninstall  removes the entry and the skill, then re-reads the config to
//              confirm they're gone
//   check      reports, per app, whether Mirrorly is configured and starts

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const PACKAGE = 'github:dazecoop/mirrorly';
const SERVER_NAME = 'mirrorly';
const EXPECTED_TOOLS = ['mirrorly_open', 'mirrorly_scroll', 'mirrorly_screenshot', 'mirrorly_devices', 'mirrorly_status'];
const SKILL_SOURCE = path.join(__dirname, 'skill', 'SKILL.md');
const SKILL_DIR = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'skills', SERVER_NAME);

const claudeDesktopFile = process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  : process.platform === 'win32'
    ? path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json')
    : path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');

// kind 'json': we edit the file. kind 'claude-cli': Claude Code owns
// ~/.claude.json and rewrites it while running, so changes go through its
// own `claude mcp` command and the file is only read, to verify.
const TARGETS = {
  'claude-code': {
    name: 'Claude Code', kind: 'claude-cli', detect: () => commandExists('claude'), file: path.join(os.homedir(), '.claude.json'), key: 'mcpServers',
    after: 'Start a new session (in VS Code: reload the window).',
    afterRemove: 'Start a new Claude Code session (in VS Code: reload the window).',
  },
  'claude-desktop': {
    name: 'Claude Desktop', kind: 'json', file: claudeDesktopFile,
    detect: () => fs.existsSync(path.dirname(claudeDesktopFile)) || appExists('Claude'), key: 'mcpServers',
    after: 'Fully quit it (⌘Q) and reopen it; a new chat is not enough. Attach your project folder in the chat (+ → Add folder).',
    afterRemove: 'Fully quit Claude Desktop (⌘Q) and reopen it.',
  },
  cursor: {
    name: 'Cursor', kind: 'json', file: path.join(os.homedir(), '.cursor', 'mcp.json'),
    detect: () => fs.existsSync(path.join(os.homedir(), '.cursor')) || appExists('Cursor'), key: 'mcpServers',
    after: 'Reload it, then check mirrorly is enabled under Cursor Settings → MCP.',
    afterRemove: 'Reload Cursor.',
  },
  vscode: {
    // Per project, so never part of "every app": run it in the project folder.
    name: 'VS Code (this project)', kind: 'json', perProject: true, file: path.join(process.cwd(), '.vscode', 'mcp.json'), key: 'servers', stdioType: true,
    after: 'In VS Code, run "MCP: List Servers" and start mirrorly.',
    afterRemove: 'Reload the VS Code window.',
  },
};

function commandExists(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  return r.status === 0;
}

function appExists(name) {
  return process.platform === 'darwin' &&
    [path.join('/Applications', name + '.app'), path.join(os.homedir(), 'Applications', name + '.app')].some((p) => fs.existsSync(p));
}

// `install` with no app, or `all`: every app found on this computer.
// `claude`: both Claude apps. Otherwise one named app.
const GROUPS = {
  all: () => Object.keys(TARGETS).filter((k) => !TARGETS[k].perProject),
  claude: () => ['claude-code', 'claude-desktop'],
};

const ok = (m) => console.log('✔ ' + m);
const bad = (m) => console.log('✘ ' + m);
const info = (m) => console.log('  ' + m);

// ---- Config entries --------------------------------------------------------

// Desktop apps launched from the Dock/Start menu don't get the shell's PATH,
// so a bare "npx" fails for anyone whose Node came from nvm, Volta or
// Homebrew. The entry names the Node running this command by absolute path
// and puts its folder on PATH for npx's own "#!/usr/bin/env node".
function mcpEntry({ local, stdioType }) {
  const nodeDir = path.dirname(process.execPath);
  const env = { PATH: [nodeDir, '/usr/local/bin', '/usr/bin', '/bin'].join(path.delimiter) };
  if (process.env.MIRRORLY_PORT) env.MIRRORLY_PORT = process.env.MIRRORLY_PORT;
  if (process.env.MIRRORLY_FIREFOX) env.MIRRORLY_FIREFOX = process.env.MIRRORLY_FIREFOX;
  let entry;
  if (local) {
    entry = { command: process.execPath, args: [path.join(__dirname, 'cli.js'), 'mcp'], env };
  } else {
    const npx = path.join(nodeDir, process.platform === 'win32' ? 'npx.cmd' : 'npx');
    entry = { command: fs.existsSync(npx) ? npx : 'npx', args: ['-y', PACKAGE, 'mcp'], env };
  }
  return stdioType ? { type: 'stdio', ...entry } : entry;
}

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8');
  try { return raw.trim() ? JSON.parse(raw) : {}; } catch (e) {
    throw new Error(`${file} isn't valid JSON, so it was left alone. Fix it and run this again.`);
  }
}

function readEntry(target) {
  const servers = readJson(target.file)[target.key];
  return (servers && servers[SERVER_NAME]) || null;
}

function writeJsonEntry(target, entry) {
  const config = readJson(target.file);
  if (fs.existsSync(target.file)) fs.copyFileSync(target.file, target.file + '.mirrorly-backup');
  else fs.mkdirSync(path.dirname(target.file), { recursive: true });
  const servers = { ...(config[target.key] || {}) };
  if (entry) servers[SERVER_NAME] = entry;
  else delete servers[SERVER_NAME];
  config[target.key] = servers;
  fs.writeFileSync(target.file, JSON.stringify(config, null, 2) + '\n');
}

function claudeCli(args) {
  const r = spawnSync('claude', args, { encoding: 'utf8' });
  if (r.error && r.error.code === 'ENOENT') {
    throw new Error('The `claude` command wasn\'t found. Install Claude Code first.');
  }
  return r;
}

function setEntry(target, entry) {
  if (target.kind === 'json') return writeJsonEntry(target, entry);
  // Claude Code: replace through its CLI, user scope (all projects).
  claudeCli(['mcp', 'remove', SERVER_NAME, '-s', 'user']); // fine if absent
  if (!entry) return;
  const r = claudeCli(['mcp', 'add-json', SERVER_NAME, JSON.stringify({ type: 'stdio', ...entry }), '-s', 'user']);
  if (r.status !== 0) throw new Error(`claude mcp add-json failed: ${(r.stderr || r.stdout || '').trim()}`);
}

// ---- Verification ----------------------------------------------------------

// Launches the server the way the app will and asks for its tools. The env
// is the entry's own plus the basics, NOT this terminal's PATH, so a config
// that only works from a shell fails here too. 
function verifyEntry(entry, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const base = { HOME: os.homedir(), USER: os.userInfo().username, TMPDIR: os.tmpdir(), PATH: '/usr/bin:/bin' };
    if (process.platform === 'win32') Object.assign(base, process.env);
    let proc;
    try {
      proc = spawn(entry.command, entry.args || [], { env: { ...base, ...(entry.env || {}) }, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ ok: false, error: e.message });
      return;
    }
    let out = '';
    let err = '';
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { proc.kill(); } catch (e) { /* gone */ }
      // npm's update banner and log-file pointer bury the actual error.
      const lines = err.trim().split('\n').filter((l) => l.trim() && !/^npm notice|A complete log of this run/.test(l));
      resolve({ ...result, stderr: lines.slice(-6).join('\n') });
    };
    const timer = setTimeout(() => finish({ ok: false, error: `no answer within ${Math.round(timeoutMs / 1000)}s` }), timeoutMs);
    const send = (msg) => { try { proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n'); } catch (e) { /* closed */ } };

    proc.on('error', (e) => finish({ ok: false, error: e.code === 'ENOENT' ? `command not found: ${entry.command}` : e.message }));
    proc.on('exit', (code) => finish({ ok: false, error: `the server exited (code ${code}) before answering` }));
    proc.stderr.on('data', (d) => { err += d; });
    proc.stdout.on('data', (d) => {
      out += d;
      let i;
      while ((i = out.indexOf('\n')) >= 0) {
        let msg;
        try { msg = JSON.parse(out.slice(0, i)); } catch (e) { msg = null; }
        out = out.slice(i + 1);
        if (!msg) continue;
        if (msg.id === 1) {
          send({ method: 'notifications/initialized' });
          send({ id: 2, method: 'tools/list' });
        } else if (msg.id === 2) {
          const tools = ((msg.result && msg.result.tools) || []).map((t) => t.name);
          const missing = EXPECTED_TOOLS.filter((t) => !tools.includes(t));
          finish(missing.length
            ? { ok: false, error: `the server is missing ${missing.join(', ')}` }
            : { ok: true, tools, version: msg.version });
        }
      }
    });
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'mirrorly-cli' }, capabilities: {} } });
  });
}

function reportFailure(result, entry) {
  bad(`The Mirrorly MCP server failed to start: ${result.error}.`);
  if (result.stderr) result.stderr.split('\n').forEach((l) => info('│ ' + l));
  if ((entry.args || []).includes(PACKAGE) && /could not determine executable|404|not found/i.test(result.stderr + result.error)) {
    info(`The GitHub copy of Mirrorly (${PACKAGE}) doesn't include the agent tools yet.`);
  }
}

// ---- Commands --------------------------------------------------------------

function resolveApps(app, verb) {
  const name = app || 'all';
  if (GROUPS[name]) return { keys: GROUPS[name](), group: name };
  if (TARGETS[name]) return { keys: [name], group: null };
  throw new Error(`Usage: mirrorly ${verb} [${Object.keys(TARGETS).join('|')}|claude|all]` +
    (verb === 'install' ? ' [--local]' : '') + `\nWith no app, ${verb === 'install' ? 'installs in' : 'removes from'} every agent app on this computer.`);
}

// Writes the entry into each app, then verifies the server starts. All apps
// get the same command, so it is started once and the result shared.
async function install(app, { local = false } = {}) {
  const { keys, group } = resolveApps(app, 'install');
  if (group) console.log(`Installing Mirrorly in ${group === 'claude' ? 'the Claude apps' : 'every agent app'} found on this computer:`);

  const written = [];
  let failed = false;
  for (const key of keys) {
    const target = TARGETS[key];
    if (group && target.detect && !target.detect()) {
      console.log(`· ${target.name}: not found on this computer, skipped`);
      continue;
    }
    const entry = mcpEntry({ local, stdioType: target.stdioType });
    try {
      const existed = !!readEntry(target);
      setEntry(target, entry);
      if (!readEntry(target)) throw new Error(`the entry isn't in ${target.file} after writing it`);
      ok(`${target.name}: ${existed ? 'updated' : 'added'} (${target.file})`);
      written.push({ key, target, entry });
    } catch (err) {
      bad(`${target.name}: couldn't add Mirrorly. ${err.message}`);
      failed = true;
    }
  }
  if (!written.length) {
    if (!failed) bad('No agent apps found. Install Claude Code, Claude Desktop or Cursor first, or name the app: mirrorly install claude-code');
    return false;
  }

  console.log('');
  info(local ? 'Checking it starts…' : 'Checking it starts (the first run downloads Mirrorly, which can take a minute)…');
  const results = new Map();
  for (const w of written) {
    const sig = JSON.stringify({ c: w.entry.command, a: w.entry.args, e: w.entry.env });
    if (!results.has(sig)) results.set(sig, await verifyEntry(w.entry));
    w.result = results.get(sig);
  }
  const broken = written.filter((w) => !w.result.ok);
  if (broken.length) {
    reportFailure(broken[0].result, broken[0].entry);
    info(`Not working in: ${broken.map((w) => w.target.name).join(', ')}. The entries were left in place; ` +
      `\`mirrorly uninstall${group ? '' : ' ' + broken[0].key}\` removes them.`);
    return false;
  }
  const tools = written[0].result.tools.filter((t) => t.startsWith('mirrorly_')).join(', ');
  ok(`Verified: the Mirrorly MCP server starts and offers ${tools}.`);
  if (written.some((w) => w.key === 'claude-code')) {
    try {
      installSkill();
      ok(`Claude Code skill installed (${path.join(SKILL_DIR, 'SKILL.md')})`);
    } catch (e) {
      bad(`Couldn't install the Claude Code skill: ${e.message}`);
    }
  }
  console.log('');
  console.log('Next:');
  written.forEach((w) => info(`• ${w.target.name}: ${w.target.after}`));
  info('To run pages in your own Firefox (signed-in pages work), turn on "Let AI agents use Mirrorly"');
  info('in Mirrorly\'s settings. Otherwise they open in headless Firefox.');
  info('Then try: "Use mirrorly_status, then open https://example.com in an iPhone with mirrorly_open and take a mirrorly_screenshot."');
  return !failed;
}

async function uninstall(app) {
  const { keys, group } = resolveApps(app, 'uninstall');
  let allOk = true;
  const removed = [];
  for (const key of keys) {
    const target = TARGETS[key];
    let had;
    try { had = !!readEntry(target); } catch (e) { bad(`${target.name}: ${e.message}`); allOk = false; continue; }
    if (key === 'claude-code' && fs.existsSync(SKILL_DIR)) {
      fs.rmSync(SKILL_DIR, { recursive: true, force: true });
      ok(`Claude Code skill removed (${SKILL_DIR})`);
    }
    if (!had) {
      console.log(`· ${target.name}: Mirrorly isn't installed, nothing to remove`);
      continue;
    }
    try {
      setEntry(target, null);
    } catch (e) {
      bad(`${target.name}: ${e.message}`);
      allOk = false;
      continue;
    }
    if (readEntry(target)) {
      bad(`${target.name}: Mirrorly is still in ${target.file} after removing it. Remove the "${SERVER_NAME}" entry by hand.`);
      allOk = false;
      continue;
    }
    ok(`${target.name}: removed. Verified: no "${SERVER_NAME}" entry left in ${target.file}`);
    removed.push(target);
  }
  if (removed.length) {
    console.log('');
    console.log('Next:');
    removed.forEach((t) => info(`• ${t.name}: ${t.afterRemove}`));
  } else if (allOk && group) {
    ok('Mirrorly isn\'t installed in any agent app.');
  }
  return allOk;
}

// One line per app: configured or not, and whether the configured server
// actually starts. Used by `mirrorly status`.
async function checkAll() {
  const lines = [];
  for (const target of Object.values(TARGETS)) {
    let entry = null;
    try { entry = readEntry(target); } catch (e) { lines.push(`✘ ${target.name}: ${e.message}`); continue; }
    if (!entry) {
      lines.push(`· ${target.name}: not installed`);
      continue;
    }
    const result = await verifyEntry(entry, { timeoutMs: 60000 });
    const skill = target.kind === 'claude-cli' ? (fs.existsSync(path.join(SKILL_DIR, 'SKILL.md')) ? ', skill installed' : ', no skill (run install again)') : '';
    lines.push(result.ok
      ? `✔ ${target.name}: installed, server starts${skill}`
      : `✘ ${target.name}: installed, but the server fails to start (${result.error}). Run \`mirrorly install\` again.`);
  }
  return lines;
}

// The skill tells Claude Code when to reach for Mirrorly; a copy is made, so
// it outlives the npx cache it came from.
function installSkill() {
  fs.mkdirSync(SKILL_DIR, { recursive: true });
  fs.copyFileSync(SKILL_SOURCE, path.join(SKILL_DIR, 'SKILL.md'));
}

module.exports = { install, uninstall, checkAll, verifyEntry, TARGETS };
