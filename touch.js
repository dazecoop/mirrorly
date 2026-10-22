'use strict';

// Makes the mobile view behave like a touch screen under a mouse: drag to
// scroll with momentum, a fingertip instead of the pointer, and no hover
// effects (styles.js rewrites the CSS; matchMedia answers as a phone would).

var MirrorlyTouch = (() => {
  const FINGER = 38;
  const DRAG_THRESHOLD = 6;

  function patchMatchMedia() {
    const page = window.wrappedJSObject;
    const real = window.matchMedia.bind(window);
    try {
      page.matchMedia = exportFunction((query) => real(MirrorlyStyles.swapMedia(String(query))), window);
    } catch {}
  }

  // --- Fingertip

  let finger = null;

  // The fingertip lives in the top layer (as a popover) so the page's own
  // dialogs and max-z-index overlays can't cover it.
  function makeFinger() {
    finger = document.createElement('mirrorly-finger');
    finger.setAttribute('popover', 'manual');
    const set = (name, value) => finger.style.setProperty(name, value, 'important');
    set('position', 'fixed');
    set('inset', 'auto');
    set('left', '0');
    set('top', '0');
    set('padding', '0');
    set('border', '0');
    set('overflow', 'visible');
    set('color', 'transparent');
    set('width', `${FINGER}px`);
    set('height', `${FINGER}px`);
    set('margin', `${-FINGER / 2}px 0 0 ${-FINGER / 2}px`);
    set('border-radius', '50%');
    set('background', 'rgba(120, 120, 128, .32)');
    set('box-shadow', '0 0 0 1px rgba(255, 255, 255, .7), 0 1px 4px rgba(0, 0, 0, .25)');
    set('pointer-events', 'none');
    set('z-index', '2147483647');
    set('display', 'none');
    set('transition', 'scale .12s ease-out, background-color .12s ease-out');
    document.documentElement.append(finger);
    raiseFinger();
  }

  // Popovers stack in the order they're shown, so a dialog the page opens
  // later sits above the fingertip until it's shown again.
  let raisedOver = null;
  function raiseFinger() {
    try {
      if (finger.matches(':popover-open')) finger.hidePopover();
      finger.showPopover();
    } catch {}
  }

  let lastRaiseCheck = 0;
  function moveFinger(e) {
    if (!finger) return;
    finger.style.setProperty('display', 'block', 'important');
    finger.style.setProperty('translate', `${e.clientX}px ${e.clientY}px`, 'important');
    const now = performance.now();
    if (now - lastRaiseCheck < 250) return;
    lastRaiseCheck = now;
    // Anything else in the top layer, or the fingertip dropped out of it.
    const top = document.querySelector(':modal, :popover-open:not(mirrorly-finger)');
    if (!finger.isConnected) document.documentElement.append(finger);
    if (top !== raisedOver || !finger.matches(':popover-open')) {
      raisedOver = top;
      raiseFinger();
    }
  }

  function pressFinger(down) {
    if (!finger) return;
    finger.style.setProperty('scale', down ? '.8' : '1', 'important');
    finger.style.setProperty('background', down ? 'rgba(120, 120, 128, .5)' : 'rgba(120, 120, 128, .32)', 'important');
  }

  // --- Drag to scroll, with momentum

  const FIELD = 'input, textarea, select, option, [contenteditable=""], [contenteditable="true"]';

  function scrollerFor(el, axis) {
    for (let n = el; n && n !== document.documentElement && n !== document.body; n = n.parentElement) {
      const style = getComputedStyle(n);
      const overflow = axis === 'x' ? style.overflowX : style.overflowY;
      if (!/(auto|scroll)/.test(overflow)) continue;
      if (axis === 'x' ? n.scrollWidth > n.clientWidth : n.scrollHeight > n.clientHeight) return n;
    }
    return null; // the page itself
  }

  function scrollBy(target, dx, dy) {
    if (target) target.scrollBy({ left: dx, top: dy, behavior: 'instant' });
    else window.scrollBy({ left: dx, top: dy, behavior: 'instant' });
  }

  function enableDragScroll() {
    let start = null;
    let dragging = false;
    let target = null;
    let axis = 'y';
    let last = null;
    let velocity = { x: 0, y: 0 };
    let glide = 0;
    let swallowClick = false;

    const stopGlide = () => cancelAnimationFrame(glide);

    addEventListener(
      'mousedown',
      (e) => {
        stopGlide();
        pressFinger(true);
        if (e.button !== 0 || !(e.target instanceof Element) || e.target.closest(FIELD)) {
          start = null;
          return;
        }
        start = { x: e.clientX, y: e.clientY, el: e.target };
        last = { x: e.clientX, y: e.clientY, t: performance.now() };
        dragging = false;
        velocity = { x: 0, y: 0 };
      },
      true,
    );

    addEventListener(
      'mousemove',
      (e) => {
        moveFinger(e);
        if (!start || !(e.buttons & 1)) return;
        if (!dragging) {
          const dx = e.clientX - start.x;
          const dy = e.clientY - start.y;
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
          dragging = true;
          axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
          target = scrollerFor(start.el, axis);
          if (axis === 'x' && !target) axis = 'y';
          document.documentElement.style.setProperty('user-select', 'none', 'important');
        }
        e.preventDefault();
        getSelection()?.removeAllRanges();
        const now = performance.now();
        const dx = axis === 'x' ? e.clientX - last.x : 0;
        const dy = axis === 'y' ? e.clientY - last.y : 0;
        scrollBy(target, -dx, -dy);
        const dt = Math.max(1, now - last.t);
        // Smoothed so one jittery sample doesn't decide the fling.
        velocity = { x: 0.7 * (-dx / dt) + 0.3 * velocity.x, y: 0.7 * (-dy / dt) + 0.3 * velocity.y };
        last = { x: e.clientX, y: e.clientY, t: now };
      },
      true,
    );

    addEventListener(
      'mouseup',
      () => {
        pressFinger(false);
        if (!start) return;
        start = null;
        if (!dragging) return;
        dragging = false;
        swallowClick = true;
        setTimeout(() => (swallowClick = false), 0);
        document.documentElement.style.removeProperty('user-select');
        // A pause before letting go means no fling.
        if (performance.now() - last.t > 80) return;
        let prev = performance.now();
        const step = (now) => {
          const dt = now - prev;
          prev = now;
          scrollBy(target, velocity.x * dt, velocity.y * dt);
          const decay = Math.pow(0.95, dt / 16);
          velocity = { x: velocity.x * decay, y: velocity.y * decay };
          if (Math.hypot(velocity.x, velocity.y) > 0.02) glide = requestAnimationFrame(step);
        };
        glide = requestAnimationFrame(step);
      },
      true,
    );

    // A drag that ends over a link or button isn't a tap on it.
    addEventListener(
      'click',
      (e) => {
        if (!swallowClick) return;
        swallowClick = false;
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      true,
    );

    addEventListener('wheel', stopGlide, { passive: true, capture: true });
    addEventListener('dragstart', (e) => e.preventDefault(), true);
    document.addEventListener('mouseout', (e) => {
      if (!e.relatedTarget && finger) finger.style.setProperty('display', 'none', 'important');
    });
  }

  return {
    // Called at document_start.
    enable() {
      patchMatchMedia();
      enableDragScroll();

      const ready = () => {
        makeFinger();
        const style = document.createElement('style');
        document.documentElement.append(style);
        style.sheet.insertRule('*, *::before, *::after { cursor: none !important; }');
      };
      addEventListener('DOMContentLoaded', ready, { once: true });
    },
  };
})();
