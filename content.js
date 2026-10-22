'use strict';

// Runs in every tab's top frame (the desktop view) and in the sidebar's
// iframe (the mobile view). Both sides capture the user's scrolling, clicks
// and typing, send them through the background script, and replay what
// arrives from the other side.

(() => {
  const isTop = window.top === window;
  const [prefix, windowIdText, uaKey, token, screenW, screenH, dpr, textSize, touch, insetBottom, keyboardCover] = isTop
    ? []
    : String(window.name).split('|');
  const isMobile = !isTop && prefix === Mirrorly.FRAME_PREFIX;
  if (!isTop && !isMobile) return;
  let bottomSpace = null; // room below the page for Safari's toolbar

  if (isMobile) {
    if (Mirrorly.UA[uaKey]) spoofNavigator(uaKey);
    if (touch === '1') MirrorlyTouch.enable();
    // Safe-area insets only apply to pages that extend under the browser's
    // bars with viewport-fit=cover.
    const coversScreen = () => /viewport-fit\s*=\s*cover/i.test(document.querySelector('meta[name="viewport" i]')?.content || '');
    if (touch === '1' || Number(insetBottom)) {
      MirrorlyStyles.start({
        noHover: touch === '1',
        insets: () => (Number(insetBottom) && coversScreen() ? { bottom: Number(insetBottom) } : null),
      });
    }
    if (Number(screenW)) spoofScreen(Number(screenW), Number(screenH), Number(dpr));
    // Safari's floating toolbar sits over the page, but for pages that don't
    // extend under it (no viewport-fit=cover) Safari lets the page scroll on
    // until its end clears the bar, showing the page background below.
    if (Number(insetBottom)) {
      addEventListener(
        'DOMContentLoaded',
        () => {
          if (coversScreen()) return;
          bottomSpace = document.createElement('style');
          bottomSpace.textContent = `:root::after { content: ""; display: block; height: ${Number(insetBottom)}px; }`;
          document.documentElement.append(bottomSpace);
        },
        { once: true },
      );
    }
  }

  // The viewport line both views line up on when syncing scroll, as a
  // fraction of the viewport height. Low enough to clear most sticky headers.
  const REF = 0.3;
  const CLICKABLE =
    'a,button,input,select,textarea,label,summary,[role="button"],[role="tab"],[role="link"],' +
    '[role="menuitem"],[role="option"],[role="checkbox"],[role="switch"],[onclick],[tabindex]';

  let port = null;
  let active = isMobile; // the desktop side waits for the background to pair it
  let applyingUntil = 0;
  let scrollTimer = 0;
  let lastHref = location.href;
  let lastGesture = 0;

  function connect() {
    try {
      port = browser.runtime.connect({ name: isMobile ? `mobile:${windowIdText}:${token}` : 'desktop' });
    } catch {
      port = null;
      return;
    }
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(() => {
      port = null;
      if (!isMobile) active = false;
    });
    if (isMobile) {
      post({ type: 'location', url: location.href });
      post({ type: 'keyboard', show: false });
    }
  }

  function post(msg) {
    if (!port || !active) return;
    try {
      port.postMessage(msg);
    } catch {
      port = null;
    }
  }

  function onMessage(msg) {
    switch (msg.type) {
      case 'active':
        active = msg.on;
        break;
      case 'scroll':
        applyScroll(msg);
        break;
      case 'boxScroll':
        applyBoxScroll(msg);
        break;
      case 'locate':
        locate(msg);
        break;
      case 'requestScroll':
        post(captureScroll());
        break;
      case 'getScroll':
        post({ type: 'scrollPos', x: scrollX, y: scrollY });
        break;
      case 'key':
        typeKey(msg.key);
        break;
      case 'focusField':
        focusFromElsewhere(msg);
        break;
      case 'blurField':
        virtualField = null;
        if (keyboardShown) setKeyboard(false);
        break;
      case 'scrollTo':
        applyingUntil = performance.now() + 300;
        window.scrollTo({ left: msg.x, top: msg.y, behavior: 'instant' });
        break;
      case 'click':
        applyClick(msg);
        break;
      case 'input':
        applyInput(msg);
        break;
      case 'findTarget':
        findTarget(msg.targetElementId);
        break;
      // Full-page screenshots: fix 100vh at the screen's height, then report
      // how tall the page is, as often as the sidebar asks while it grows.
      case 'freezeViewport':
        bottomSpace?.remove();
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        MirrorlyStyles.freezeViewport(innerHeight).then(() => post({ type: 'pageSize', height: pageHeight() }));
        break;
      case 'measurePage':
        post({ type: 'pageSize', height: pageHeight() });
        break;
    }
  }

  // --- Page-side user agent (the request header is changed in background.js)

  function spoofNavigator(key) {
    const page = window.wrappedJSObject;
    const values = {
      userAgent: Mirrorly.UA[key],
      appVersion: Mirrorly.UA[key].replace(/^Mozilla\//, ''),
      platform: Mirrorly.PLATFORM[key],
      vendor: Mirrorly.VENDOR[key],
      maxTouchPoints: 5,
    };
    for (const [name, value] of Object.entries(values)) defineGetter(page.navigator, name, value);
  }

  function defineGetter(target, name, value) {
    try {
      const page = window.wrappedJSObject;
      const desc = new page.Object();
      desc.get = exportFunction(() => value, window);
      desc.configurable = true;
      page.Object.defineProperty(target, name, desc);
    } catch {}
  }

  function spoofScreen(width, height, ratio) {
    const page = window.wrappedJSObject;
    for (const [name, value] of Object.entries({ width, height, availWidth: width, availHeight: height })) {
      defineGetter(page.screen, name, value);
    }
    if (ratio) defineGetter(page, 'devicePixelRatio', ratio);
  }

  // --- Describing elements so the other view can find its copy

  // Elements from <body> down to el, with an nth-of-type selector step for
  // each, plus the element's id where it looks hand-written rather than
  // generated. Responsive sites share one DOM, so these paths usually match.
  function describe(el) {
    const els = [];
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) els.unshift(n);
    return { els, segs: els.map(step), ids: els.map(stableId) };
  }

  function step(n) {
    if (n === document.body) return 'body';
    const tag = n.localName;
    let i = 1;
    for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.localName === tag) i++;
    return `${CSS.escape(tag)}:nth-of-type(${i})`;
  }

  function stableId(n) {
    const id = n.id;
    if (!id || !/^[A-Za-z][\w-]*$/.test(id) || /\d{3,}/.test(id)) return null;
    return document.querySelectorAll(`#${CSS.escape(id)}`).length === 1 ? id : null;
  }

  function query(selector) {
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }

  // The element at depth d of a description, trying the nearest id first.
  function resolveAt(desc, d) {
    for (let k = d; k >= 0; k--) {
      if (!desc.ids[k]) continue;
      const rest = desc.segs.slice(k + 1, d + 1);
      const el = query([`#${CSS.escape(desc.ids[k])}`, ...rest].join(' > '));
      if (el) return el;
      break;
    }
    return query([':root', ...desc.segs.slice(0, d + 1)].join(' > '));
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }

  function pinnedAncestor(el) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const position = getComputedStyle(n).position;
      if (position === 'fixed' || position === 'sticky') return n;
    }
    return null;
  }

  const pinned = (el) => !!pinnedAncestor(el);

  function textOf(el) {
    return (el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  // --- Scroll

  function scrollMax() {
    return Math.max(0, document.documentElement.scrollHeight - innerHeight);
  }

  function pageHeight() {
    return Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
  }

  // The content under the reference line, skipping fixed and sticky layers.
  function anchorElement() {
    const y = innerHeight * REF;
    for (const fx of [0.5, 0.3, 0.7]) {
      for (const el of document.elementsFromPoint(innerWidth * fx, y)) {
        if (el === document.documentElement || el === document.body) break;
        if (!pinned(el)) return el;
      }
    }
    return null;
  }

  function captureScroll() {
    const max = scrollMax();
    const y = scrollY;
    const msg = { type: 'scroll', pct: max > 0 ? y / max : 0 };
    if (y <= 2) return { ...msg, edge: 'top' };
    if (y >= max - 2) return { ...msg, edge: 'bottom' };
    const el = anchorElement();
    if (!el) return msg;
    const { els, segs, ids } = describe(el);
    const refY = innerHeight * REF;
    // How far down each element on the path the reference line falls, so the
    // other view can line up on whichever of them it can find.
    const ratios = els.map((n) => {
      const r = n.getBoundingClientRect();
      return r.height ? (refY - r.top) / r.height : 0;
    });
    return { ...msg, anchor: { segs, ids, ratios } };
  }

  function applyScroll(msg) {
    let top = null;
    if (msg.edge === 'top') top = 0;
    else if (msg.edge === 'bottom') top = scrollMax();
    else if (msg.anchor) {
      // Deepest match first; stop above <body>, where pct does the same job.
      for (let d = msg.anchor.segs.length - 1; d >= 1; d--) {
        const el = resolveAt(msg.anchor, d);
        if (!el || !visible(el) || pinned(el)) continue;
        const r = el.getBoundingClientRect();
        top = scrollY + r.top + msg.anchor.ratios[d] * r.height - innerHeight * REF;
        break;
      }
    }
    if (top === null) top = msg.pct * scrollMax();
    applyingUntil = performance.now() + 300;
    window.scrollTo({ top, left: scrollX, behavior: 'instant' });
  }

  addEventListener(
    'scroll',
    () => {
      if (!active || performance.now() < applyingUntil || scrollTimer) return;
      scrollTimer = setTimeout(() => {
        scrollTimer = 0;
        if (performance.now() >= applyingUntil) post(captureScroll());
      }, 40);
    },
    { passive: true },
  );

  // --- Scrolling inside boxes (carousels, side panels, modals)
  //
  // The box is found by its path, like a tap's target. The view lines up on
  // the box's content the way page scrolling does: the item at the box's
  // leading edge (as a path from the box) and how far into it the edge falls,
  // with the scroll fraction as a fallback.

  const boxApplying = new WeakMap(); // box -> time until its scroll events are ours
  const boxTimers = new WeakMap();

  function scrollable(el) {
    const style = getComputedStyle(el);
    return (
      (/(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth) ||
      (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight)
    );
  }

  function pathFrom(box, el) {
    const segs = [];
    for (let n = el; n && n !== box; n = n.parentElement) segs.unshift(step(n));
    return segs;
  }

  // Where the box's content starts on screen: its top-left corner inside
  // the padding.
  function contentEdge(box) {
    const r = box.getBoundingClientRect();
    const style = getComputedStyle(box);
    return { r, x: r.left + box.clientLeft + parseFloat(style.paddingLeft), y: r.top + box.clientTop + parseFloat(style.paddingTop) };
  }

  // The item at the start of the box's content: tried along its leading
  // edges (the middle of the left edge finds a carousel's card, the middle of
  // the top edge a list's row).
  function boxAnchor(box) {
    const { r, x, y } = contentEdge(box);
    const points = [[x + 2, (r.top + r.bottom) / 2], [(r.left + r.right) / 2, y + 2], [x + 2, y + 2]];
    for (const [px, py] of points) {
      for (const el of document.elementsFromPoint(px, py)) {
        if (el === box) break;
        if (!box.contains(el)) continue;
        const er = el.getBoundingClientRect();
        return {
          segs: pathFrom(box, el),
          rx: er.width ? (x - er.left) / er.width : 0,
          ry: er.height ? (y - er.top) / er.height : 0,
        };
      }
    }
    return null;
  }

  function captureBoxScroll(box) {
    const maxX = box.scrollWidth - box.clientWidth;
    const maxY = box.scrollHeight - box.clientHeight;
    return {
      type: 'boxScroll',
      box: describeTarget(box),
      fx: maxX > 0 ? box.scrollLeft / maxX : 0,
      fy: maxY > 0 ? box.scrollTop / maxY : 0,
      anchor: boxAnchor(box),
    };
  }

  function applyBoxScroll(msg) {
    const box = resolveAt(msg.box, msg.box.segs.length - 1);
    if (!box || box.localName !== msg.box.tag || !visible(box) || !scrollable(box)) return;
    const maxX = box.scrollWidth - box.clientWidth;
    const maxY = box.scrollHeight - box.clientHeight;
    let left = msg.fx * maxX;
    let top = msg.fy * maxY;
    const item = msg.anchor ? anchorIn(box, msg.anchor.segs) : null;
    if (item && visible(item)) {
      const { x, y } = contentEdge(box);
      const er = item.getBoundingClientRect();
      // Edges of the scroll range line up as edges, whatever the widths.
      if (msg.fx > 0 && msg.fx < 1) left = box.scrollLeft + er.left - x + msg.anchor.rx * er.width;
      if (msg.fy > 0 && msg.fy < 1) top = box.scrollTop + er.top - y + msg.anchor.ry * er.height;
    }
    boxApplying.set(box, performance.now() + 300);
    box.scrollTo({ left, top, behavior: 'instant' });
  }

  function anchorIn(box, segs) {
    try {
      return segs.length ? box.querySelector(`:scope > ${segs.join(' > ')}`) : null;
    } catch {
      return null;
    }
  }

  document.addEventListener(
    'scroll',
    (e) => {
      const box = e.target;
      if (!active || !(box instanceof Element) || box === document.documentElement || box === document.body) return;
      if (performance.now() < (boxApplying.get(box) || 0) || boxTimers.get(box)) return;
      boxTimers.set(
        box,
        setTimeout(() => {
          boxTimers.delete(box);
          if (performance.now() >= (boxApplying.get(box) || 0)) post(captureBoxScroll(box));
        }, 40),
      );
    },
    { capture: true, passive: true },
  );

  // --- Clicks

  // Links to another page aren't mirrored: navigation sync loads the page in
  // the other view instead, without a second click racing the first.
  function leavesPage(el) {
    const a = el.closest('a[href]');
    if (!a) return false;
    if (/^\s*(#|javascript:)/i.test(a.getAttribute('href'))) return false;
    if (a.target && a.target.toLowerCase() === '_blank') return true;
    try {
      const to = new URL(a.href);
      const here = new URL(location.href);
      to.hash = here.hash = '';
      return to.href !== here.href;
    } catch {
      return true;
    }
  }

  function describeTarget(el) {
    const { segs, ids } = describe(el);
    return { segs, ids, tag: el.localName, text: textOf(el), name: el.getAttribute('name') };
  }

  function resolveTarget(t) {
    const byPath = resolveAt(t, t.segs.length - 1);
    const pathOk = byPath && byPath.localName === t.tag && visible(byPath);
    if (pathOk && textOf(byPath) === t.text) return byPath;

    let found = null;
    if (t.text) {
      for (const el of document.querySelectorAll(CSS.escape(t.tag))) {
        if (textOf(el) !== t.text || !visible(el)) continue;
        // Prefer the innermost of nested elements with the same text.
        if (!found || found.contains(el)) found = el;
        else break;
      }
    } else if (t.name) {
      for (const el of document.querySelectorAll(`${CSS.escape(t.tag)}[name="${CSS.escape(t.name)}"]`)) {
        if (visible(el)) {
          found = el;
          break;
        }
      }
    }
    return found || (pathOk ? byPath : null);
  }

  function flash(el, holdMs = 350) {
    const r = el.getBoundingClientRect();
    const box = document.createElement('div');
    box.style.cssText =
      `position:fixed;left:${r.left - 3}px;top:${r.top - 3}px;width:${r.width + 6}px;height:${r.height + 6}px;` +
      'box-sizing:border-box;border:2px solid #7c7cf0;border-radius:6px;background:rgba(124,124,240,.12);' +
      'pointer-events:none;z-index:2147483647;transition:opacity .4s ease-out;';
    (document.body || document.documentElement).append(box);
    setTimeout(() => (box.style.opacity = '0'), holdMs);
    setTimeout(() => box.remove(), holdMs + 450);
  }

  // --- "Show in Mirrorly" (the page's context menu)

  // The desktop side: describe the element that was right-clicked.
  function findTarget(id) {
    let el = null;
    try {
      el = browser.menus.getTargetElement(id);
    } catch {}
    if (!(el instanceof Element)) return;
    // Sent even while unpaired: the sidebar may be opening for it.
    port?.postMessage({ type: 'locate', target: describeTarget(el) });
  }

  // A phone: scroll its copy of the element into the middle of the screen and
  // outline it. If the element isn't in this layout, the nearest of its
  // ancestors that is stands in for it.
  function locate({ target }) {
    let el = resolveTarget(target);
    let nearest = false;
    for (let d = target.segs.length - 2; !el && d >= 1; d--) {
      const candidate = resolveAt(target, d);
      if (candidate && visible(candidate) && !pinned(candidate)) {
        el = candidate;
        nearest = true;
      }
    }
    if (!el) {
      post({ type: 'located', found: false });
      return;
    }
    if (!pinned(el)) {
      const r = el.getBoundingClientRect();
      const top = Math.max(0, Math.min(scrollMax(), scrollY + r.top + Math.min(r.height, innerHeight) / 2 - innerHeight / 2));
      applyingUntil = performance.now() + 300;
      window.scrollTo({ top, left: scrollX, behavior: 'instant' });
    }
    flash(el, 1500);
    post({ type: 'located', found: true, nearest });
  }

  function applyClick(msg) {
    const el = resolveTarget(msg.target);
    if (!el) return;
    flash(el);
    el.click();
  }

  document.addEventListener(
    'click',
    (e) => {
      if (!e.isTrusted || !(e.target instanceof Element)) return;
      if (isMobile) {
        // The sandbox stops the mobile page navigating the sidebar itself, so
        // load links aimed at the top frame inside the iframe instead.
        const a = e.target.closest('a[href]');
        if (a && /^_(top|parent)$/i.test(a.target) && !(e.metaKey || e.ctrlKey || e.shiftKey)) {
          e.preventDefault();
          location.href = a.href;
          return;
        }
      }
      if (!active || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target.closest(CLICKABLE) || e.target;
      if (leavesPage(target)) return;
      post({ type: 'click', target: describeTarget(target) });
    },
    true,
  );

  // --- Typing

  function isField(el) {
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
  }

  document.addEventListener(
    'input',
    (e) => {
      const el = e.target;
      if (!e.isTrusted || !active || !isField(el)) return;
      // Checkboxes and radios are handled by click sync.
      if (['password', 'file', 'checkbox', 'radio'].includes(el.type)) return;
      post({ type: 'input', target: describeTarget(el), value: el.value });
    },
    true,
  );

  function applyInput(msg) {
    let el = resolveTarget(msg.target);
    // Fields can be hidden in one layout (e.g. a search box behind a button).
    if (!el && msg.target.name) el = document.querySelector(`${CSS.escape(msg.target.tag)}[name="${CSS.escape(msg.target.name)}"]`);
    if (!el || !isField(el) || el.value === msg.value) return;
    // Through the Xray wrapper this is the native setter, so frameworks that
    // track the value themselves (React) see a real change.
    el.value = msg.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // --- On-screen keyboard: tell the sidebar when a text field has focus, and
  // type the keys pressed on the keyboard it draws.

  const TEXT_TYPES = /^(text|search|email|url|tel|number|password)$/i;
  let keyboardShown = false;
  let keyboardTimer = 0;
  let lastKeyboardAction = 0;
  let lastInput = 0; // last real pointer or key press in this view
  // A field focused in another view. The drawn keyboard types into it
  // without focusing it, so focus never jumps away from the view in use.
  let virtualField = null;

  function isTextField(el) {
    if (!el || el.disabled || el.readOnly) return false;
    if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true;
    return el instanceof HTMLInputElement && TEXT_TYPES.test(el.type);
  }

  // Which keyboard iOS would show for the field.
  function keyboardFor(el) {
    const hint = (el.getAttribute('enterkeyhint') || '').toLowerCase();
    const search = hint === 'search' || el.type === 'search' || Boolean(el.closest('[role="search"]'));
    const mode = (el.inputMode || '').toLowerCase();
    let kind = 'text';
    if (el.type === 'tel' || mode === 'tel') kind = 'phone';
    else if (mode === 'numeric') kind = 'numeric';
    else if (mode === 'decimal') kind = 'decimal';
    else if (el.type === 'email' || mode === 'email') kind = 'email';
    else if (el.type === 'number') kind = 'number';
    // Safari offers contact AutoFill for these.
    const autofill = /^(tel|email)$/i.test(el.type) || /name|email|tel|address|postal|country/i.test(el.getAttribute('autocomplete') || '');
    return { enter: search ? 'search' : 'return', kind, autofill };
  }

  function setKeyboard(show, el) {
    keyboardShown = show;
    post({ type: 'keyboard', show, ...(show ? keyboardFor(el) : {}) });
  }

  // iOS scrolls a field the user taps to the middle of the space left above
  // the keyboard (and above Safari's floating bars). When the keyboard is
  // just opening, waits for the page to shrink to fit it first. Every phone
  // centres its own copy of the field, so this scroll isn't synced.
  function centreField(el, opening) {
    let done = false;
    const centre = () => {
      if (done || (el !== document.activeElement && el !== virtualField) || !visible(el)) return;
      done = true;
      removeEventListener('resize', centre);
      const r = el.getBoundingClientRect();
      const space = innerHeight - (Number(keyboardCover) || 0);
      const top = Math.max(0, Math.min(scrollMax(), scrollY + r.top + r.height / 2 - space / 2));
      if (Math.abs(top - scrollY) < 1) return;
      const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
      applyingUntil = Infinity;
      const settle = () => {
        removeEventListener('scrollend', settle);
        clearTimeout(fallback);
        applyingUntil = performance.now() + 100;
      };
      addEventListener('scrollend', settle);
      const fallback = setTimeout(settle, 1500);
      window.scrollTo({ top, left: scrollX, behavior: smooth ? 'smooth' : 'instant' });
    };
    if (!opening) return centre();
    addEventListener('resize', centre);
    setTimeout(centre, 300);
  }

  function textFields() {
    return [...document.querySelectorAll('input, textarea, [contenteditable=""], [contenteditable="true"]')].filter(
      (el) => isTextField(el) && visible(el),
    );
  }

  // The keyboard opens even when this view has no matching visible field
  // (desktop and mobile layouts differ); typing then goes to the field with
  // the same name, if there is one.
  function focusFromElsewhere({ target, keyboard }) {
    let el = resolveTarget(target);
    if (!isTextField(el) && target.name) el = document.querySelector(`[name="${CSS.escape(target.name)}"]`);
    virtualField = isTextField(el) ? el : null;
    const opening = !keyboardShown;
    keyboardShown = true;
    post({ type: 'keyboard', show: true, ...(virtualField ? keyboardFor(virtualField) : keyboard) });
    if (isMobile && virtualField) centreField(virtualField, opening);
  }

  // Edits the field's text at its selection. Inputs and textareas don't need
  // focus for this; contenteditable falls back to execCommand.
  function editText(el, text, deleteBack = false) {
    if (el.isContentEditable) {
      document.execCommand(deleteBack ? 'delete' : 'insertText', false, text);
      return;
    }
    if (el.selectionStart === null) {
      // email and number inputs have no selection API; edit at the end.
      el.value = deleteBack ? el.value.slice(0, -1) : el.value + text;
    } else {
      let start = el.selectionStart;
      const end = el.selectionEnd;
      if (deleteBack && start === end) start = Math.max(0, start - 1);
      el.setRangeText(deleteBack ? '' : text, start, end, 'end');
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: deleteBack ? 'deleteContentBackward' : 'insertText', data: deleteBack ? null : text }));
  }

  function typeKey(key) {
    const el = isTextField(document.activeElement) ? document.activeElement : virtualField;
    if (!isTextField(el)) return;
    lastKeyboardAction = Date.now();
    if (key === 'done') {
      el.blur();
      virtualField = null;
      setKeyboard(false);
      post({ type: 'blurField' });
      return;
    }
    if (key === 'up' || key === 'down') {
      const fields = textFields();
      fields[fields.indexOf(el) + (key === 'down' ? 1 : -1)]?.focus();
      return;
    }
    if (key === 'enter' && !(el instanceof HTMLTextAreaElement || el.isContentEditable)) {
      // Submitting may navigate; count it as the user's doing for page sync.
      post({ type: 'gesture' });
      const init = { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true };
      const proceed = el.dispatchEvent(new KeyboardEvent('keydown', init));
      el.dispatchEvent(new KeyboardEvent('keyup', init));
      if (proceed && el.form) el.form.requestSubmit();
      return;
    }
    if (key === 'delete') editText(el, '', true);
    else if (key === 'enter') editText(el, '\n');
    else if (key.startsWith('word:')) editText(el, `${key.slice(5)} `);
    else if (key.startsWith('fill:')) editText(el, key.slice(5));
    else editText(el, key);
    // Script-made input events aren't mirrored automatically.
    if (!el.isContentEditable) post({ type: 'input', target: describeTarget(el), value: el.value });
  }

  // A text field focused in this view (by the user) opens the keyboard in
  // every phone; leaving it closes them again.
  addEventListener('pointerdown', (e) => e.isTrusted && (lastInput = Date.now()), true);
  addEventListener('keydown', (e) => e.isTrusted && (lastInput = Date.now()), true);
  document.addEventListener(
    'focusin',
    (e) => {
      if (!isTextField(e.target) || Date.now() - Math.max(lastInput, lastKeyboardAction) > 1500) return;
      virtualField = null;
      post({ type: 'focusField', target: describeTarget(e.target), keyboard: keyboardFor(e.target) });
    },
    true,
  );
  document.addEventListener(
    'focusout',
    () =>
      setTimeout(() => {
        // Focus moving to another frame (e.g. the sidebar) keeps the field
        // as this document's active element; only a real blur clears it.
        if (!isTextField(document.activeElement) && !virtualField) post({ type: 'blurField' });
      }, 150),
    true,
  );

  // --- Mobile view: report location changes and user input

  if (isMobile) {
    // Phones only open the keyboard for focus the user caused, not autofocus.
    // (The sidebar decides which phones draw one.)
    document.addEventListener(
      'focusin',
      (e) => {
        if (!isTextField(e.target)) return;
        const userCaused = Date.now() - Math.max(lastGesture, lastKeyboardAction) < 1500;
        if (!userCaused && !keyboardShown) return;
        clearTimeout(keyboardTimer);
        const opening = !keyboardShown;
        setKeyboard(true, e.target);
        if (userCaused) centreField(e.target, opening);
      },
      true,
    );
    // Tapping a field that already has focus (e.g. one the page focused by
    // script) opens the keyboard too.
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (e.isTrusted && !keyboardShown && e.target === document.activeElement && isTextField(e.target)) {
          setKeyboard(true, e.target);
          centreField(e.target, true);
        }
      },
      true,
    );
    document.addEventListener(
      'focusout',
      () => {
        clearTimeout(keyboardTimer);
        keyboardTimer = setTimeout(() => {
          if (keyboardShown && !isTextField(document.activeElement)) setKeyboard(false);
        }, 150);
      },
      true,
    );
  }

  if (isMobile) {
    const gesture = (e) => {
      if (!e.isTrusted) return;
      const now = Date.now();
      if (now - lastGesture < 250) return;
      lastGesture = now;
      post({ type: 'gesture' });
    };
    addEventListener('pointerdown', gesture, true);
    addEventListener('keydown', gesture, true);
    addEventListener('submit', gesture, true);

    // Polling catches pushState/replaceState, which the isolated world can't hook.
    setInterval(() => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      post({ type: 'location', url: lastHref });
    }, 150);

    addEventListener('load', () => {
      post({ type: 'ready' });
      reportTint();
      if (Mirrorly.WEBKIT.includes(uaKey)) applyTracking();
    });

    addEventListener('DOMContentLoaded', async () => {
      if (Number(textSize)) await applyDynamicType(Number(textSize));
      if (Mirrorly.WEBKIT.includes(uaKey)) applyTracking();
      // Phones only show a scroll indicator while scrolling.
      document.documentElement.style.setProperty('scrollbar-width', 'none', 'important');
      post({ type: 'viewport', width: layoutWidth() });
      reportTint();
    });

    let tintTimer = 0;
    addEventListener(
      'scroll',
      () => {
        if (!tintTimer) tintTimer = setTimeout(() => ((tintTimer = 0), reportTint()), 200);
      },
      { passive: true },
    );
  }

  // Pages can size text to the iOS Text Size setting with
  // `font: -apple-system-body`, usually inside @supports. Firefox drops those
  // declarations, so re-add the @supports blocks with the keyword swapped for
  // the chosen size. The raw CSS is fetched because the parsed rules no longer
  // contain the declarations Firefox didn't understand.
  async function applyDynamicType(size) {
    const font = `400 ${size}px -apple-system, system-ui, sans-serif`;
    const sources = [...document.querySelectorAll('link[rel~="stylesheet" i][href], style')].map((el) =>
      el.localName === 'style'
        ? el.textContent
        : fetch(el.href)
            .then((r) => (r.ok ? r.text() : ''))
            .catch(() => ''),
    );
    const blocks = (await Promise.all(sources)).flatMap(appleSystemBodyBlocks);
    if (!blocks.length) return;
    const style = document.createElement('style');
    (document.head || document.documentElement).append(style);
    for (const block of blocks) {
      try {
        style.sheet.insertRule(`@media all{${block.replaceAll('-apple-system-body', font)}}`, style.sheet.cssRules.length);
      } catch {}
    }
  }

  // On Apple platforms the system font is tightened or loosened by size (the
  // tracking table in Apple's HIG). Firefox on macOS already gets most of
  // that from the font; matching line wraps against iPhone screenshots of
  // Wikipedia put the remainder at about 15% of the table.
  const SF_TRACKING_REMAINDER = 0.15;
  const SF_TRACKING = [
    [6, 0.24], [7, 0.23], [8, 0.21], [9, 0.17], [10, 0.12], [11, 0.06], [12, 0], [13, -0.08], [14, -0.15],
    [15, -0.23], [16, -0.31], [17, -0.43], [18, -0.44], [19, -0.45], [20, -0.45], [21, -0.36], [22, -0.26],
    [23, -0.1], [24, 0.07], [25, 0.15], [26, 0.22], [27, 0.29], [28, 0.38], [29, 0.4], [30, 0.4],
  ];
  const SYSTEM_FONT = /^\s*["']?(-apple-system|system-ui|BlinkMacSystemFont|SF Pro)/i;
  const tracked = new WeakSet();

  function sfTracking(size) {
    if (size <= SF_TRACKING[0][0]) return SF_TRACKING[0][1];
    for (let i = 1; i < SF_TRACKING.length; i++) {
      const [s1, t1] = SF_TRACKING[i];
      if (size <= s1) {
        const [s0, t0] = SF_TRACKING[i - 1];
        return t0 + ((t1 - t0) * (size - s0)) / (s1 - s0);
      }
    }
    return 0.38;
  }

  function applyTracking() {
    if (!document.body) return;
    // Read everything first, then write, so inherited values set here aren't
    // mistaken for the page's own letter-spacing.
    const updates = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const el = walker.currentNode.parentElement;
      if (!el || seen.has(el) || !walker.currentNode.data.trim()) continue;
      seen.add(el);
      const style = getComputedStyle(el);
      if (!SYSTEM_FONT.test(style.fontFamily)) continue;
      const ours = tracked.has(el) || tracked.has(el.parentElement);
      if (style.letterSpacing !== 'normal' && !ours) continue;
      updates.push([el, sfTracking(parseFloat(style.fontSize)) * SF_TRACKING_REMAINDER]);
    }
    for (const [el, value] of updates) {
      tracked.add(el);
      el.style.setProperty('letter-spacing', `${value.toFixed(3)}px`);
    }
  }

  function appleSystemBodyBlocks(css) {
    const blocks = [];
    const start = /@supports\s*\(\s*font\s*:\s*-apple-system-body\s*\)\s*\{/gi;
    let match;
    while ((match = start.exec(css))) {
      let depth = 1;
      let i = start.lastIndex;
      for (; i < css.length && depth; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') depth--;
      }
      blocks.push(css.slice(start.lastIndex, i - 1));
      start.lastIndex = i;
    }
    return blocks;
  }

  // The width iOS lays the page out at: the device width when the page asks
  // for it (null here), otherwise the fixed width it names, or 980 when it has
  // no viewport tag at all. Desktop Firefox ignores the tag, so the sidebar
  // applies it.
  function layoutWidth() {
    const meta = document.querySelector('meta[name="viewport" i]');
    if (!meta) return 980;
    const match = /(?:^|[,;\s])width\s*=\s*([\w.-]+)/i.exec(meta.content || '');
    if (!match) return /initial-scale/i.test(meta.content || '') ? null : 980;
    const width = Number(match[1]);
    return width > 0 ? width : null;
  }

  // Safari colours the status bar to match the top of the page: a fixed or
  // sticky header's own background while one is there, otherwise the colour
  // sampled from the top of the page when scrolled to the top. The colour
  // holds while scrolling, so a header that slides away (lego.com's) leaves
  // the bar as it was.
  let lastTint = null;
  let topEdge = null;
  function reportTint() {
    const tint = topColor();
    if (tint === lastTint) return;
    lastTint = tint;
    post({ type: 'tint', color: tint });
  }

  function opaque(color) {
    return color && color !== 'transparent' && !/^rgba\(.*,\s*0(\.0+)?\)$/.test(color) ? color : null;
  }

  function backgroundOf(el) {
    for (let n = el; n; n = n.parentElement) {
      const color = opaque(getComputedStyle(n).backgroundColor);
      if (color) return color;
    }
    return null;
  }

  // The colour Safari takes from the point (x, 1): a pinned header's own
  // background (not a banner inside it), else whatever is drawn there.
  function edgeColor(x, pinnedOnly) {
    const el = document.elementFromPoint(x, 1);
    const pin = el && pinnedAncestor(el);
    if (pin) return opaque(getComputedStyle(pin).backgroundColor) || backgroundOf(el);
    return el && !pinnedOnly ? backgroundOf(el) : null;
  }

  function topColor() {
    const header = edgeColor(innerWidth / 2, true);
    if (header) topEdge = header;
    else if (scrollY <= 0) {
      // Only a colour that runs the full width counts.
      const colors = [0.1, 0.5, 0.9].map((fx) => edgeColor(innerWidth * fx));
      topEdge = colors[0] && colors.every((c) => c === colors[0]) ? colors[0] : null;
    }
    if (topEdge) return topEdge;
    const page = (n) => (n ? opaque(getComputedStyle(n).backgroundColor) : null);
    return page(document.body) || page(document.documentElement) || 'rgb(255, 255, 255)';
  }

  // Pages restored from the back-forward cache lose their port.
  addEventListener('pageshow', (e) => {
    if (e.persisted && !port) {
      connect();
      if (isMobile) post({ type: 'ready' });
    }
  });

  connect();
})();
