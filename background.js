'use strict';

// Pairs each window's active tab (the desktop view) with the iframe in that
// window's sidebar (the mobile view), and relays sync messages between them.

const EXT_BASE = browser.runtime.getURL('');

const settings = { ...Mirrorly.DEFAULTS };
browser.storage.local.get(Mirrorly.DEFAULTS).then((s) => Object.assign(settings, s));
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const [key, { newValue }] of Object.entries(changes)) settings[key] = newValue;
});

const sidebars = new Map(); // windowId -> sidebar page port
// windowId -> Map(slot -> { token, port, url, uaKey, frameId }), one per
// device shown in that window's sidebar.
const views = new Map();
const gestures = new Map(); // windowId -> time of the last user input in a mobile view
const navTimers = new Map(); // windowId -> pending desktop-to-mobile navigation
const desktops = new Map(); // tabId -> content script port in that tab's top frame
const tabWindows = new Map(); // tabId -> windowId
const activeTabs = new Map(); // windowId -> active tabId

// A navigation in a mobile view is only copied to the desktop tab when the
// user did something in that view this recently. Redirects and script-driven
// URL changes are left alone.
const GESTURE_WINDOW_MS = 5000;

// Lets a mirrored click land first, so a same-page URL change it causes in the
// mobile view isn't mistaken for a page the mobile view still needs to load.
const NAV_DELAY_MS = 300;

// Some sites reload or redirect themselves endlessly inside the frame, usually
// because they detect the frame or the user agent. A mobile view that starts
// this many page loads within LOOP_WINDOW_MS is stopped.
const LOOP_LOADS = 6;
const LOOP_WINDOW_MS = 3000;
const frameLoads = new Map(); // frameId -> times of its recent page loads
const blockedFrames = new Set();

// Page sync can ping-pong when the desktop and a phone keep sending each other
// to different addresses. Either direction is paused when it fires this often.
const PINGPONG = { toDesktop: { count: 3, windowMs: 10000, pauseMs: 30000 }, toMobile: { count: 6, windowMs: 3000, pauseMs: 10000 } };
const syncTimes = new Map(); // `${direction}:${windowId}` -> recent times
const syncPausedUntil = new Map(); // `${direction}:${windowId}` -> time

// Returns false (and pauses that direction) when page sync is firing too often.
function syncAllowed(direction, windowId) {
  const key = `${direction}:${windowId}`;
  const now = Date.now();
  if ((syncPausedUntil.get(key) || 0) > now) return false;
  const { count, windowMs, pauseMs } = PINGPONG[direction];
  const times = (syncTimes.get(key) || []).filter((t) => now - t < windowMs);
  times.push(now);
  syncTimes.set(key, times);
  if (times.length < count) return true;
  syncTimes.delete(key);
  syncPausedUntil.set(key, now + pauseMs);
  sidebars.get(windowId)?.postMessage({
    type: 'notice',
    text: `Page sync paused for ${pauseMs / 1000} seconds: the desktop tab and the phone kept sending each other to different addresses.`,
  });
  return false;
}


browser.tabs.query({ active: true }).then((tabs) => {
  for (const tab of tabs) activeTabs.set(tab.windowId, tab.id);
});

function viewsOf(windowId) {
  if (!views.has(windowId)) views.set(windowId, new Map());
  return views.get(windowId);
}

function isPaired(tabId) {
  const windowId = tabWindows.get(tabId);
  return sidebars.has(windowId) && activeTabs.get(windowId) === tabId;
}

function desktopPortFor(windowId) {
  const tabId = activeTabs.get(windowId);
  return tabId === undefined ? null : desktops.get(tabId) || null;
}

function refreshActive() {
  for (const [tabId, port] of desktops) {
    const on = isPaired(tabId);
    if (port.mirrorlyActive === on) continue;
    port.mirrorlyActive = on;
    port.postMessage({ type: 'active', on });
  }
}

function allowed(type) {
  switch (type) {
    case 'scroll':
    case 'boxScroll':
    case 'requestScroll':
      return settings.syncScroll;
    case 'click':
      return settings.syncClicks;
    case 'input':
    case 'focusField':
    case 'blurField':
      return settings.syncInputs;
    default:
      return false;
  }
}

function isWeb(url) {
  return /^https?:\/\//i.test(url || '');
}

// Firefox doesn't let extensions touch these sites at all (its default
// extensions.webextensions.restrictedDomains), so the phone can't be set up
// there: no header changes, no content script, no sync.
const RESTRICTED_HOSTS = [
  'accounts-static.cdn.mozilla.net', 'accounts.firefox.com', 'addons.cdn.mozilla.net', 'addons.mozilla.org',
  'api.accounts.firefox.com', 'content.cdn.mozilla.net', 'discovery.addons.mozilla.org', 'install.mozilla.org',
  'oauth.accounts.firefox.com', 'profile.accounts.firefox.com', 'support.mozilla.org', 'sync.services.mozilla.com',
];

function isRestricted(url) {
  try {
    return RESTRICTED_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

// Firefox can also block extensions from other sites (quarantined domains,
// a list it updates itself). Those show up as a phone load the extension
// never sees, so each load is watched for its request.
const RESTRICTED_TIMEOUT_MS = 2000;
const loadWatch = new Map(); // frameId -> timer

function navigateMobile(windowId, url) {
  const sidebar = sidebars.get(windowId);
  if (!sidebar) return;
  clearTimeout(navTimers.get(windowId));
  gestures.delete(windowId);
  if (!isWeb(url)) {
    for (const view of viewsOf(windowId).values()) view.url = null;
    sidebar.postMessage({ type: 'blank', url });
    return;
  }
  if (isRestricted(url)) {
    for (const view of viewsOf(windowId).values()) view.url = null;
    sidebar.postMessage({ type: 'restricted', url });
    return;
  }
  // Each view in the sidebar skips the load if it's already showing the page.
  sidebar.postMessage({ type: 'load', url });
}

async function loadActiveTab(windowId) {
  let tabId = activeTabs.get(windowId);
  if (tabId === undefined) {
    const [tab] = await browser.tabs.query({ active: true, windowId });
    if (!tab) return;
    tabId = tab.id;
    activeTabs.set(windowId, tabId);
  }
  const tab = await browser.tabs.get(tabId);
  navigateMobile(windowId, tab.url);
}

async function onMobileLocation(windowId, slot, url) {
  const view = viewsOf(windowId).get(slot);
  const prev = view.url;
  view.url = url;
  sidebars.get(windowId)?.postMessage({ type: 'location', slot, url });

  if (!prev || prev === url || !settings.syncNav) return;
  const at = gestures.get(windowId);
  if (!at || Date.now() - at > GESTURE_WINDOW_MS) return;
  gestures.delete(windowId);

  const tabId = activeTabs.get(windowId);
  if (tabId === undefined) return;
  const tab = await browser.tabs.get(tabId);
  if (tab.url === url || !syncAllowed('toDesktop', windowId)) return;
  browser.tabs.update(tabId, { url });
}

// --- Screenshots
//
// Sidebar frames can't be captured, so a screenshot rebuilds the same phone
// in a background tab (the sidebar page in capture mode), scrolls it to the
// same place, and captures that tab at the phone's pixel ratio. A full-page
// screenshot grows that phone's screen to the page's height instead.

const captures = new Map(); // capture id -> { windowId, config, url, scroll, tabId }

function requestScroll(view) {
  return new Promise((resolve) => {
    if (!view?.port) return resolve({ x: 0, y: 0 });
    const timer = setTimeout(() => resolve({ x: 0, y: 0 }), 1000);
    view.pendingScroll = (pos) => {
      clearTimeout(timer);
      resolve(pos);
    };
    view.port.postMessage({ type: 'getScroll' });
  });
}

async function startCapture(windowId, msg) {
  const id = crypto.randomUUID().slice(0, 8);
  const scroll = await requestScroll(viewsOf(windowId).get(msg.slot));
  const tab = await browser.tabs.create({
    url: browser.runtime.getURL(`sidebar/sidebar.html?capture=${id}`),
    active: false,
    windowId,
  });
  captures.set(id, { windowId, config: msg.config, url: msg.url, mode: msg.mode || 'frame', scroll, tabId: tab.id });
}

function onCapturePage(port, id) {
  const job = captures.get(id);
  if (!job) {
    port.disconnect();
    return;
  }
  const key = `capture-${id}`;
  sidebars.set(key, port);
  views.set(key, new Map());
  port.postMessage({ type: 'setup', config: job.config, url: job.url, mode: job.mode });

  const finish = (text) => {
    captures.delete(id);
    sidebars.delete(key);
    views.delete(key);
    browser.tabs.remove(job.tabId).catch(() => {});
    sidebars.get(job.windowId)?.postMessage({ type: 'notice', text });
  };

  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'frame') {
      viewsOf(key).set(msg.slot, { token: msg.token, frameId: msg.frameId, uaKey: msg.uaKey, port: null, url: null });
    } else if (msg.type === 'scrollTo') {
      viewsOf(key).get(msg.slot)?.port?.postMessage({ type: 'scrollTo', ...job.scroll });
    } else if (msg.type === 'freezeViewport' || msg.type === 'measurePage') {
      viewsOf(key).get(msg.slot)?.port?.postMessage({ type: msg.type });
    } else if (msg.type === 'captureReady') {
      try {
        const dataUrl = await browser.tabs.captureTab(job.tabId, { format: 'png', rect: msg.rect, scale: msg.scale });
        port.postMessage({ type: 'captured', dataUrl });
      } catch (e) {
        finish(`Couldn't take the screenshot: ${e.message || e}`);
      }
    } else if (msg.type === 'saved') {
      finish(`Screenshot saved to your Downloads folder as ${msg.filename}.`);
    } else if (msg.type === 'failed') {
      finish(`Couldn't save the screenshot: ${msg.error}`);
    }
  });
  port.onDisconnect.addListener(() => {
    if (captures.has(id)) finish("The screenshot was cancelled because its tab closed.");
  });
}

function onSidebar(port, windowId) {
  sidebars.set(windowId, port);
  views.set(windowId, new Map());

  port.onMessage.addListener((msg) => {
    if (msg.type === 'frame') {
      viewsOf(windowId).set(msg.slot, { token: msg.token, frameId: msg.frameId, uaKey: msg.uaKey, port: null, url: null });
    } else if (msg.type === 'removeFrame') {
      const view = viewsOf(windowId).get(msg.slot);
      if (view) {
        blockedFrames.delete(view.frameId);
        frameLoads.delete(view.frameId);
      }
      viewsOf(windowId).delete(msg.slot);
    } else if (msg.type === 'reload') {
      loadActiveTab(windowId);
    } else if (msg.type === 'key') {
      // A key pressed on the drawn keyboard, for the phone's focused field.
      viewsOf(windowId).get(msg.slot)?.port?.postMessage({ type: 'key', key: msg.key });
    } else if (msg.type === 'loading') {
      // The sidebar set a phone's address; expect its request shortly.
      const view = viewsOf(windowId).get(msg.slot);
      if (!view) return;
      clearTimeout(loadWatch.get(view.frameId));
      loadWatch.set(
        view.frameId,
        setTimeout(() => {
          loadWatch.delete(view.frameId);
          port.postMessage({ type: 'restricted', slot: msg.slot, url: msg.url });
        }, RESTRICTED_TIMEOUT_MS),
      );
    } else if (msg.type === 'capture') {
      startCapture(windowId, msg).catch((e) => port.postMessage({ type: 'notice', text: `Couldn't take the screenshot: ${e.message || e}` }));
    }
  });

  port.onDisconnect.addListener(() => {
    if (sidebars.get(windowId) !== port) return;
    sidebars.delete(windowId);
    views.delete(windowId);
    gestures.delete(windowId);
    clearTimeout(navTimers.get(windowId));
    refreshActive();
  });

  refreshActive();
  loadActiveTab(windowId);
}

// Sends a sync message to every view in the window except the one it came from.
function relay(windowId, msg, fromSlot) {
  for (const [slot, view] of viewsOf(windowId)) {
    if (slot !== fromSlot) view.port?.postMessage(msg);
  }
  if (fromSlot !== undefined) desktopPortFor(windowId)?.postMessage(msg);
}

function onMobile(port, windowId, token) {
  // Only accept iframes the sidebar created. Any page could name a frame
  // "mirrorly-phone|…", and a frame accepted here receives the desktop tab's input.
  // Content scripts in sidebar frames get no frameId, so the sidebar puts a
  // random token in each frame's name and tells us what it is.
  const entry = token && [...viewsOf(windowId)].find(([, view]) => view.token === token);
  if (!entry) {
    port.disconnect();
    return;
  }
  const [slot, view] = entry;
  view.port = port;

  port.onMessage.addListener((msg) => {
    if (msg.type === 'location') {
      onMobileLocation(windowId, slot, msg.url);
    } else if (['tint', 'viewport', 'keyboard', 'located', 'pageSize'].includes(msg.type)) {
      sidebars.get(windowId)?.postMessage({ ...msg, slot });
    } else if (msg.type === 'gesture') {
      gestures.set(windowId, Date.now());
    } else if (msg.type === 'scrollPos') {
      view.pendingScroll?.({ x: msg.x, y: msg.y });
      view.pendingScroll = null;
    } else if (msg.type === 'ready') {
      if (String(windowId).startsWith('capture-')) sidebars.get(windowId)?.postMessage({ type: 'phoneReady', slot });
      else {
        if (settings.syncScroll) desktopPortFor(windowId)?.postMessage({ type: 'requestScroll' });
        locatePending(windowId, slot, view);
      }
    } else if (allowed(msg.type)) {
      relay(windowId, msg, slot);
    }
  });

  port.onDisconnect.addListener(() => {
    if (view.port === port) view.port = null;
  });
}

function onDesktop(port) {
  const { tab, frameId } = port.sender;
  if (!tab || frameId !== 0) {
    port.disconnect();
    return;
  }
  const tabId = tab.id;
  desktops.set(tabId, port);
  tabWindows.set(tabId, tab.windowId);
  port.mirrorlyActive = isPaired(tabId);
  port.postMessage({ type: 'active', on: port.mirrorlyActive });

  port.onMessage.addListener((msg) => {
    if (msg.type === 'locate') {
      locateInPhones(tabWindows.get(tabId), msg.target);
      return;
    }
    if (!isPaired(tabId) || !allowed(msg.type)) return;
    relay(tabWindows.get(tabId), msg);
  });

  port.onDisconnect.addListener(() => {
    if (desktops.get(tabId) === port) desktops.delete(tabId);
  });
}

browser.runtime.onConnect.addListener((port) => {
  const [kind, id, token] = port.name.split(':');
  // Windows are numbers; screenshot pages use "capture-<id>".
  const windowKey = /^capture-/.test(id) ? id : Number(id);
  if (kind === 'sidebar') onSidebar(port, windowKey);
  else if (kind === 'capture') onCapturePage(port, id);
  else if (kind === 'mobile') onMobile(port, windowKey, token);
  else if (kind === 'desktop') onDesktop(port);
});

// --- "Show in Mirrorly": a context menu item on web pages. It opens the
// sidebar if it's closed, and each phone scrolls to its copy of the element
// once its page is ready.

const LOCATE_WAIT_MS = 15000;
const pendingLocates = new Map(); // windowId -> { target, until, done: Set of slots }

browser.menus.create({
  id: 'mirrorly-locate',
  title: 'Show in Mirrorly',
  contexts: ['all'],
  documentUrlPatterns: ['http://*/*', 'https://*/*'],
});

browser.menus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'mirrorly-locate' || !tab) return;
  // Opening the sidebar has to happen right away, while this counts as the
  // user's click.
  if (!sidebars.has(tab.windowId)) browser.sidebarAction.open();
  // Only the top frame's content script can describe the element.
  if (info.frameId !== 0) return;
  desktops.get(tab.id)?.postMessage({ type: 'findTarget', targetElementId: info.targetElementId });
});

// Sends the element to every phone showing the page now, and keeps it for
// phones whose page is still loading (or a sidebar that's still opening).
function locateInPhones(windowId, target) {
  const pending = { target, until: Date.now() + LOCATE_WAIT_MS, done: new Set() };
  for (const [slot, view] of viewsOf(windowId)) {
    if (!view.port || view.url === null) continue;
    view.port.postMessage({ type: 'locate', target });
    pending.done.add(slot);
  }
  pendingLocates.set(windowId, pending);
}

// A phone's page is ready: if an element is waiting, show it once the
// phone has caught up with the desktop's scroll position.
function locatePending(windowId, slot, view) {
  const pending = pendingLocates.get(windowId);
  if (!pending || pending.done.has(slot)) return;
  if (Date.now() > pending.until) {
    pendingLocates.delete(windowId);
    return;
  }
  pending.done.add(slot);
  setTimeout(() => view.port?.postMessage({ type: 'locate', target: pending.target }), 600);
}

browser.tabs.onActivated.addListener(({ tabId, windowId }) => {
  activeTabs.set(windowId, tabId);
  tabWindows.set(tabId, windowId);
  refreshActive();
  if (sidebars.has(windowId)) loadActiveTab(windowId);
});

browser.tabs.onUpdated.addListener(
  (tabId, change, tab) => {
    const { windowId } = tab;
    if (activeTabs.get(windowId) !== tabId || !sidebars.has(windowId)) return;
    if (!settings.syncNav) return;
    clearTimeout(navTimers.get(windowId));
    navTimers.set(
      windowId,
      setTimeout(() => {
        if (syncAllowed('toMobile', windowId)) navigateMobile(windowId, change.url);
      }, NAV_DELAY_MS),
    );
  },
  { properties: ['url'] },
);

// Reloading the desktop tab reloads the phones too.
browser.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0 || details.transitionType !== 'reload') return;
  const windowId = tabWindows.get(details.tabId);
  if (!isPaired(details.tabId) || !settings.syncNav) return;
  sidebars.get(windowId)?.postMessage({ type: 'reloadViews' });
});

browser.tabs.onAttached.addListener((tabId, { newWindowId }) => {
  tabWindows.set(tabId, newWindowId);
  refreshActive();
});

browser.tabs.onRemoved.addListener((tabId) => {
  tabWindows.delete(tabId);
});

browser.windows.onRemoved.addListener((windowId) => {
  activeTabs.delete(windowId);
});

browser.browserAction.onClicked.addListener(() => {
  browser.sidebarAction.toggle();
});

// The mobile view's own document: a frame whose parent is our sidebar page.
function isMobileDocument(details) {
  return details.type === 'sub_frame' && (details.documentUrl || '').startsWith(EXT_BASE);
}

// Requests made by the mobile view: its document and everything loaded inside
// it. Requests from our own background or sidebar page don't count.
function fromMobileView(details) {
  if (isMobileDocument(details)) return true;
  return (details.frameAncestors || []).some((f) => (f.url || '').startsWith(EXT_BASE));
}

// The user agent of the view a request came from. Requests are matched to the
// view by the frame they were made in (or one of its ancestors); each view
// can be a different phone and browser.
function uaKeyFor(details) {
  const frameIds = [details.frameId, ...(details.frameAncestors || []).map((f) => f.frameId)];
  for (const windowViews of views.values()) {
    for (const view of windowViews.values()) {
      if (view.frameId !== undefined && frameIds.includes(view.frameId)) return view.uaKey;
    }
  }
  return null;
}

browser.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!fromMobileView(details)) return;
    const ua = Mirrorly.UA[uaKeyFor(details)];
    if (!ua) return;
    const requestHeaders = details.requestHeaders.filter((h) => h.name.toLowerCase() !== 'user-agent');
    requestHeaders.push({ name: 'User-Agent', value: ua });
    return { requestHeaders };
  },
  { urls: ['http://*/*', 'https://*/*'] },
  ['blocking', 'requestHeaders'],
);

function viewForFrame(frameId) {
  for (const [windowId, windowViews] of views) {
    for (const [slot, view] of windowViews) {
      if (view.frameId === frameId) return { windowId, slot };
    }
  }
  return null;
}

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    // The phone's own document, or a frame embedded in it.
    const top = isMobileDocument(details);
    if (!top && !fromMobileView(details)) return;
    if (top) {
      clearTimeout(loadWatch.get(details.frameId));
      loadWatch.delete(details.frameId);
    }
    if (blockedFrames.has(details.frameId)) return { cancel: true };
    const now = Date.now();
    const loads = (frameLoads.get(details.frameId) || []).filter((t) => now - t < LOOP_WINDOW_MS);
    loads.push(now);
    frameLoads.set(details.frameId, loads);
    if (loads.length < LOOP_LOADS) return;

    blockedFrames.add(details.frameId);
    frameLoads.delete(details.frameId);
    // An embedded frame (an ad, a login widget) is just stopped; the phone's
    // own page gets the "can't be shown" message.
    const found = top ? viewForFrame(details.frameId) : null;
    if (found) sidebars.get(found.windowId)?.postMessage({ type: 'loop', slot: found.slot, url: details.url });
    return { cancel: true };
  },
  { urls: ['http://*/*', 'https://*/*'], types: ['sub_frame'] },
  ['blocking'],
);

// Most sites forbid being framed. Drop those rules for the mobile view's
// document only; nested frames inside it keep theirs.
browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!isMobileDocument(details)) return;
    const responseHeaders = [];
    for (const header of details.responseHeaders) {
      const name = header.name.toLowerCase();
      if (name === 'x-frame-options') continue;
      if (name === 'content-security-policy') {
        const value = header.value
          .split(';')
          .filter((directive) => !/^\s*frame-ancestors\b/i.test(directive))
          .join(';');
        if (value.trim()) responseHeaders.push({ name: header.name, value });
        continue;
      }
      responseHeaders.push(header);
    }
    return { responseHeaders };
  },
  { urls: ['http://*/*', 'https://*/*'], types: ['sub_frame'] },
  ['blocking', 'responseHeaders'],
);
