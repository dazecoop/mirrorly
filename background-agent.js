'use strict';

// "Let AI agents use Mirrorly": AI agents on this computer drive a phone
// through Mirrorly's MCP server (agent/ in the repo). While the switch is on,
// this connects to that server at ws://127.0.0.1:<agentPort> and runs its
// commands. Each agent session gets its own phone, in a background tab (the
// sidebar page in agent mode), so the user's sidebar and tabs are left alone.
//
// Messages (JSON):
//   extension → server  {type:'hello', role:'extension', version, browser}
//                       {type:'result', id, data} · {type:'error', id, message} · {type:'pong'}
//   server → extension  {type:'command', id, session, cmd, args} · {type:'ping'}
// Commands: open, scroll, screenshot, close (see the agent page in sidebar.js).

const AGENT_RETRY_MS = 5000;
const AGENT_IDLE_MS = 10 * 60 * 1000; // an unused agent phone's tab closes
const AGENT_COMMAND_MS = { open: 60000, scroll: 15000, screenshot: 90000 };

let agentSocket = null;
let agentConnected = false; // a server is listening and said hello back
let agentClients = []; // the apps using it, e.g. ['claude-code']
let agentLast = null; // { cmd, url, at } of the last command
const agentSessions = new Map(); // session -> { tabId, port, ready, pending, idleTimer }

function connectAgent() {
  if (!settings.agentBridge || agentSocket) return;
  let ws;
  try {
    ws = new WebSocket(`ws://127.0.0.1:${Number(settings.agentPort) || Mirrorly.DEFAULTS.agentPort}`);
  } catch {
    return;
  }
  agentSocket = ws;
  ws.onopen = async () => {
    agentConnected = true;
    // The settings page shows setup as done once an agent has connected.
    browser.storage.local.set({ agentSeenAt: Date.now() });
    const info = await browser.runtime.getBrowserInfo().catch(() => ({}));
    agentSend({ type: 'hello', role: 'extension', version: browser.runtime.getManifest().version, browser: `${info.name || 'Firefox'} ${info.version || ''}`.trim() });
  };
  ws.onmessage = (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.type === 'ping') agentSend({ type: 'pong' });
    else if (msg.type === 'agents') agentClients = (msg.clients || []).map(String).filter((c) => !/^mirrorly-(cli|headless)$/.test(c));
    else if (msg.type === 'command') {
      runAgentCommand(msg)
        .then((data) => agentSend({ type: 'result', id: msg.id, data }))
        .catch((err) => agentSend({ type: 'error', id: msg.id, message: String(err.message || err) }));
    }
  };
  ws.onclose = () => {
    if (agentSocket !== ws) return;
    agentSocket = null;
    agentConnected = false;
    agentClients = [];
  };
}

function agentSend(msg) {
  if (agentSocket?.readyState === WebSocket.OPEN) agentSocket.send(JSON.stringify(msg));
}

function stopAgents() {
  agentSocket?.close();
  agentSocket = null;
  for (const session of [...agentSessions.keys()]) closeAgentSession(session, 'AI agents were turned off in Mirrorly.');
}

// Retries while the switch is on: the MCP server only listens while an agent
// is using it.
setInterval(connectAgent, AGENT_RETRY_MS);
browser.storage.local.get(['agentBridge', 'agentPort']).then(() => setTimeout(connectAgent, 500));
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !('agentBridge' in changes || 'agentPort' in changes)) return;
  // background.js updates `settings` from the same event; read the new values.
  const on = changes.agentBridge ? changes.agentBridge.newValue : settings.agentBridge;
  agentSocket?.close();
  agentSocket = null;
  if (on) setTimeout(connectAgent, 100);
  else stopAgents();
});

async function runAgentCommand({ session, cmd, args = {} }) {
  if (!/^[\w-]{1,64}$/.test(String(session))) throw new Error('Bad session id.');
  if (cmd === 'close') {
    closeAgentSession(session);
    return {};
  }
  if (!AGENT_COMMAND_MS[cmd]) throw new Error(`Unknown command: ${cmd}`);
  agentLast = { cmd, url: cmd === 'open' ? args.url : agentLast?.url, at: Date.now() };
  if (cmd === 'open') {
    if (!isWeb(args.url)) throw new Error('Only http and https pages can be opened.');
    if (isRestricted(args.url)) throw new Error("Firefox doesn't let extensions work on this site, so Mirrorly can't show it.");
  }
  let s = agentSessions.get(session);
  if (!s) {
    if (cmd !== 'open') throw new Error('No page is open yet: call open first.');
    s = await startAgentSession(session);
  }
  await s.ready;
  clearTimeout(s.idleTimer);
  s.idleTimer = setTimeout(() => closeAgentSession(session), AGENT_IDLE_MS);
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      s.pending.delete(id);
      reject(new Error(`Mirrorly took too long to ${cmd}.`));
    }, AGENT_COMMAND_MS[cmd]);
    s.pending.set(id, { resolve, reject, timer });
    s.port.postMessage({ type: 'agentCommand', id, cmd, args });
  });
}

// Opens the session's phone in a background tab of the last focused window.
async function startAgentSession(session) {
  const s = { tabId: null, port: null, pending: new Map(), idleTimer: 0 };
  s.ready = new Promise((resolve) => (s.onReady = resolve));
  agentSessions.set(session, s);
  const win = await browser.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  const tab = await browser.tabs.create({
    url: browser.runtime.getURL(`sidebar/sidebar.html?agent=${session}`),
    active: false,
    ...(win ? { windowId: win.id } : {}),
  });
  s.tabId = tab.id;
  for (const [windowId, port] of sidebars) {
    if (typeof windowId === 'number') port.postMessage({ type: 'notice', text: 'An AI agent is using Mirrorly, in a background tab.' });
  }
  return s;
}

function closeAgentSession(session, reason = 'The agent phone was closed.') {
  const s = agentSessions.get(session);
  if (!s) return;
  agentSessions.delete(session);
  clearTimeout(s.idleTimer);
  for (const p of s.pending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error(reason));
  }
  if (s.tabId !== null) browser.tabs.remove(s.tabId).catch(() => {});
}

// For the AI agents page and the sidebar's settings: the switch, whether an
// agent's server is connected, and what agents are doing.
browser.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'agentStatus') {
    return Promise.resolve({
      on: Boolean(settings.agentBridge),
      connected: agentConnected,
      clients: agentClients,
      phones: agentSessions.size,
      last: agentLast,
      port: Number(settings.agentPort) || Mirrorly.DEFAULTS.agentPort,
    });
  }
  if (msg?.type === 'agentRetry') {
    connectAgent();
    return Promise.resolve(true);
  }
  if (msg?.type === 'agentClosePhones') {
    for (const session of [...agentSessions.keys()]) closeAgentSession(session, 'The agent phone was closed from Mirrorly\'s settings.');
    return Promise.resolve(true);
  }
  return undefined;
});

browser.tabs.onRemoved.addListener((tabId) => {
  for (const [session, s] of agentSessions) {
    if (s.tabId === tabId) {
      s.tabId = null;
      closeAgentSession(session, 'The agent phone\'s tab was closed.');
    }
  }
});

// The agent page (sidebar.html?agent=<session>) connects here. It's paired
// with no desktop tab; its phone's messages reach it the way a sidebar's do.
function onAgentPage(port, session) {
  const s = agentSessions.get(session);
  if (!s || port.sender?.tab?.id !== s.tabId) {
    port.disconnect();
    return;
  }
  const key = `agent-${session}`;
  s.port = port;
  sidebars.set(key, port);
  views.set(key, new Map());
  s.onReady();

  port.onMessage.addListener(async (msg) => {
    const view = viewsOf(key).get(msg.slot);
    if (msg.type === 'frame') {
      viewsOf(key).set(msg.slot, { token: msg.token, frameId: msg.frameId, uaKey: msg.uaKey, port: null, url: null });
    } else if (msg.type === 'removeFrame') {
      viewsOf(key).delete(msg.slot);
    } else if (msg.type === 'loading') {
      // As for the sidebar: a load the extension never sees is a site Firefox
      // keeps extensions away from.
      if (!view) return;
      clearTimeout(loadWatch.get(view.frameId));
      loadWatch.set(view.frameId, setTimeout(() => {
        loadWatch.delete(view.frameId);
        port.postMessage({ type: 'restricted', slot: msg.slot, url: msg.url });
      }, RESTRICTED_TIMEOUT_MS));
    } else if (['scrollTo', 'agentScroll', 'freezeViewport', 'measurePage'].includes(msg.type)) {
      const { slot, ...rest } = msg;
      view?.port?.postMessage(rest);
    } else if (msg.type === 'repaint') {
      // Firefox doesn't draw background tabs, so a new phone's page (in its
      // own process) never hears its size. Drawing a pixel of the tab
      // passes it on.
      await browser.tabs.captureTab(s.tabId, { rect: { x: 0, y: 0, width: 1, height: 1 }, scale: 1 }).catch(() => {});
      port.postMessage({ type: 'repainted' });
    } else if (msg.type === 'captureReady') {
      try {
        const dataUrl = await browser.tabs.captureTab(s.tabId, { format: 'png', rect: msg.rect, scale: msg.scale });
        port.postMessage({ type: 'captured', dataUrl });
      } catch (e) {
        port.postMessage({ type: 'captured', error: String(e.message || e) });
      }
    } else if (msg.type === 'agentDone') {
      const p = s.pending.get(msg.id);
      if (!p) return;
      s.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.data);
    }
  });
  port.onDisconnect.addListener(() => {
    if (sidebars.get(key) === port) {
      sidebars.delete(key);
      views.delete(key);
    }
  });
}
