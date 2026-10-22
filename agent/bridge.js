// Local bridge between AI-agent processes and the Mirrorly extension (the
// same design as Scorly's).
//
// One process on the machine owns ws://127.0.0.1:<port> (the "hub"). The
// extension's background script connects to it while the user has turned on
// "Let AI agents use Mirrorly"; every other agent process (a second MCP
// session, a CLI run) connects as a peer and has its commands relayed through
// the hub. The bridge opens when a command needs the browser and closes after
// IDLE_MS without use.
//
// Only two kinds of client are accepted:
//   - the extension, whose Origin is moz-extension://
//   - local processes, which send no Origin at all
// A web page always sends its own http(s) Origin, so no site the user visits
// can talk to the bridge or pose as the extension.
//
// Messages are JSON:
//   extension → hub   {type:'hello', role:'extension', version, browser}
//                     {type:'result', id, data} · {type:'error', id, message} · {type:'pong'}
//   hub → extension   {type:'command', id, session, cmd, args} · {type:'ping'}
//   agent → hub       {type:'hello', role:'agent', client} · {type:'command', id, session, cmd, args}
//                     {type:'status', id} → {type:'status', id, extension, agents}

const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const DEFAULT_PORT = 47616;
const COMMAND_TIMEOUT_MS = 120000;
const IDLE_MS = 10 * 60 * 1000;
const STATE_FILE = path.join(process.env.MIRRORLY_STATE_DIR || path.join(os.homedir(), '.mirrorly'), 'bridge.json');

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(patch) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...readState(), ...patch }, null, 2));
  } catch {
    // best effort only
  }
}

let nextId = 1;
const newId = () => `r${nextId++}-${process.pid}`;

class Bridge {
  // port 0 picks a free port (the headless browser's private bridge).
  constructor({ port = DEFAULT_PORT, client = 'mirrorly-cli', idleMs = IDLE_MS, shared = true } = {}) {
    this.port = port;
    this.idleMs = idleMs;
    this.shared = shared;
    this.client = client;
    this.mode = 'none'; // 'hub' | 'peer' | 'none'
    this.server = null;
    this.extension = null; // hub: { ws, info }
    this.agents = new Map(); // hub: ws -> client name
    this.upstream = null; // peer: ws to the hub
    this.pending = new Map(); // id -> { resolve, reject, timer, peer }
    this.extensionWaiters = [];
    this.idleTimer = null;
    this.closed = false;
  }

  // Opens the bridge if it isn't open, and restarts the idle countdown.
  async use() {
    if (this.mode === 'none') {
      if (!this.starting) this.starting = this.start().finally(() => (this.starting = null));
      await this.starting;
    }
    this.touch();
  }

  touch() {
    clearTimeout(this.idleTimer);
    if (this.mode === 'none' || this.closed || !this.idleMs) return;
    this.idleTimer = setTimeout(() => (this.pending.size ? this.touch() : this.stop()), this.idleMs);
    this.idleTimer.unref?.();
  }

  // Becomes the hub if the port is free, otherwise a peer of the existing one.
  async start() {
    if (this.closed) return;
    try {
      await this.listen();
      this.mode = 'hub';
    } catch (err) {
      if (err.code !== 'EADDRINUSE' || !this.shared) throw err;
      await this.connectPeer();
      this.mode = 'peer';
    }
  }

  listen() {
    return new Promise((resolve, reject) => {
      const server = new WebSocketServer({
        host: '127.0.0.1',
        port: this.port,
        maxPayload: 256 * 1024 * 1024, // full-page screenshots
        verifyClient: ({ origin }) => !origin || /^moz-extension:\/\//.test(origin),
      });
      server.once('error', reject);
      server.once('listening', () => {
        server.off('error', reject);
        server.on('error', () => {});
        this.server = server;
        this.port = server.address().port;
        server.on('connection', (ws, req) => this.onHubConnection(ws, req));
        this.pingTimer = setInterval(() => this.send(this.extension?.ws, { type: 'ping' }), 20000);
        resolve();
      });
    });
  }

  onHubConnection(ws, req) {
    const fromExtension = Boolean(req.headers.origin);
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (fromExtension) this.onExtensionMessage(ws, msg);
      else this.onAgentMessage(ws, msg);
    });
    ws.on('close', () => {
      if (this.extension?.ws === ws) {
        this.extension = null;
        this.failPending('The Mirrorly extension disconnected (its AI agents switch was turned off, or Firefox closed).');
      }
      this.agents.delete(ws);
    });
    ws.on('error', () => {});
  }

  onExtensionMessage(ws, msg) {
    if (msg.type === 'hello' && msg.role === 'extension') {
      if (this.extension && this.extension.ws !== ws) {
        try {
          this.extension.ws.close(4000, 'Another browser connected');
        } catch {}
      }
      this.extension = { ws, info: { version: msg.version, browser: msg.browser } };
      if (this.shared) writeState({ extensionLastSeen: new Date().toISOString() });
      this.extensionWaiters.splice(0).forEach((fn) => fn());
      return;
    }
    if (msg.type === 'result' || msg.type === 'error') this.settle(msg);
  }

  onAgentMessage(ws, msg) {
    this.touch();
    if (msg.type === 'hello') {
      this.agents.set(ws, String(msg.client || 'agent').slice(0, 60));
    } else if (msg.type === 'status') {
      this.send(ws, { type: 'status', id: msg.id, ...this.localStatus() });
    } else if (msg.type === 'command') {
      this.command(msg.session, msg.cmd, msg.args, { peer: true })
        .then((data) => this.send(ws, { type: 'result', id: msg.id, data }))
        .catch((err) => this.send(ws, { type: 'error', id: msg.id, message: err.message }));
    }
  }

  connectPeer() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${this.port}`, { maxPayload: 256 * 1024 * 1024 });
      ws.once('open', () => {
        this.upstream = ws;
        this.send(ws, { type: 'hello', role: 'agent', client: this.client });
        resolve();
      });
      ws.once('error', reject);
      ws.on('message', (raw) => {
        try {
          this.settle(JSON.parse(raw));
        } catch {}
      });
      ws.on('close', () => {
        if (this.upstream !== ws) return;
        this.upstream = null;
        this.mode = 'none';
        clearTimeout(this.idleTimer);
        this.failPending('The Mirrorly bridge closed.');
      });
    });
  }

  send(ws, msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  request(ws, msg, { timeoutMs = COMMAND_TIMEOUT_MS, peer = false } = {}) {
    const id = newId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Timed out waiting for the Mirrorly extension.'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, peer });
      this.send(ws, { ...msg, id });
    });
  }

  settle(msg) {
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.type === 'error') p.reject(new Error(msg.message || 'Mirrorly failed.'));
    else p.resolve(msg);
  }

  failPending(message) {
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      clearTimeout(p.timer);
      p.reject(new Error(message));
    }
  }

  localStatus() {
    return { extension: this.extension ? this.extension.info : null, agents: [this.client, ...this.agents.values()] };
  }

  async status() {
    if (this.mode === 'hub') return { mode: 'hub', port: this.port, ...this.localStatus() };
    if (this.mode === 'peer') {
      const r = await this.request(this.upstream, { type: 'status' }, { timeoutMs: 3000 });
      return { mode: 'peer', port: this.port, extension: r.extension, agents: r.agents };
    }
    return { mode: 'none', port: this.port, extension: null, agents: [] };
  }

  async extensionConnected() {
    try {
      return Boolean((await this.status()).extension);
    } catch {
      return false;
    }
  }

  // Resolves true once the extension is connected, false after `ms`. It
  // retries every 5 seconds while its switch is on.
  async waitForExtension(ms) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await this.extensionConnected()) return true;
      if (this.mode === 'hub') {
        await new Promise((resolve) => {
          const t = setTimeout(resolve, Math.max(0, deadline - Date.now()));
          this.extensionWaiters.push(() => {
            clearTimeout(t);
            resolve();
          });
        });
      } else {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    return this.extensionConnected();
  }

  // Runs a command in the extension: open, scroll, screenshot or close.
  async command(session, cmd, args = {}, { peer = false } = {}) {
    if (this.mode === 'peer') {
      const r = await this.request(this.upstream, { type: 'command', session, cmd, args });
      return r.data;
    }
    if (!this.extension) throw new Error('The Mirrorly extension is not connected.');
    const r = await this.request(this.extension.ws, { type: 'command', session, cmd, args }, { peer });
    return r.data;
  }

  async stop() {
    clearTimeout(this.idleTimer);
    clearInterval(this.pingTimer);
    this.failPending('The Mirrorly bridge closed.');
    const { upstream, server } = this;
    this.upstream = null;
    this.server = null;
    this.extension = null;
    this.agents.clear();
    this.mode = 'none';
    if (upstream) {
      try {
        upstream.close();
      } catch {}
    }
    if (server) {
      for (const ws of server.clients) {
        try {
          ws.terminate();
        } catch {}
      }
      await new Promise((r) => server.close(() => r()));
    }
  }

  async close() {
    this.closed = true;
    await this.stop();
  }
}

// Was the extension seen recently enough that waiting for it is worthwhile?
function extensionRecentlySeen(days = 14) {
  const seen = Date.parse(readState().extensionLastSeen || '');
  return Number.isFinite(seen) && Date.now() - seen < days * 86400000;
}

module.exports = { Bridge, DEFAULT_PORT, extensionRecentlySeen };
