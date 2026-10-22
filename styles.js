'use strict';

// Rewrites the mobile view's stylesheets so the page styles itself as it
// would on the phone:
// - noHover: :hover never matches, and (hover)/(pointer) media queries
//   answer as a touch screen would.
// - insets(): values for env(safe-area-inset-*), which desktop Firefox
//   always reports as 0. Safari 26, for example, includes its floating
//   toolbar in the bottom inset, and pages that opt in with
//   viewport-fit=cover keep their bottom bars clear of it.
// - viewport(): the heights the small (svh, dvh) and large (vh, lvh)
//   viewport units should mean, when they aren't the frame's (Safari 26
//   ends its viewports above the bottom of the frame). The units are then
//   rewritten to variables that follow them.
// - freezeViewport(): viewport-height units as fixed pixels, for full-page
//   screenshots, where the frame grows to the page's height but 100vh
//   should stay the height of the phone's screen.
// Another origin's stylesheets can't be edited in place, so those are fetched,
// rewritten and swapped in.

var MirrorlyStyles = (() => {
  const NO_HOVER = ':is(.mirrorly-no-hover)'; // a class nothing has, so it never matches

  // A query true on a phone is false on a desktop and vice versa, so swapping
  // the value flips each test to the phone's answer. (pointer: none) and the
  // bare (pointer) test give the same answer on both and are left alone.
  const MEDIA_FEATURE = /\(\s*(any-)?(hover|pointer)\s*(?::\s*(hover|none|fine|coarse)\s*)?\)/gi;
  const HAS_FEATURE = /\(\s*(any-)?(hover|pointer)\b/i;
  const SWAP = { hover: 'none', none: 'hover', fine: 'coarse', coarse: 'fine' };
  // env(safe-area-inset-bottom) or env(safe-area-inset-bottom, <fallback>)
  const ENV = /env\(\s*safe-area-inset-(top|right|bottom|left)\s*(?:,(?:[^()]|\([^()]*\))*)?\)/gi;
  // 100vh, 50svh, 12.5dvh, -1lvh, and vmin/vmax (the height on a phone in
  // portrait, though not in landscape).
  const VH = /(-?\d*\.?\d+)([sld]?vh|vmax)\b/gi;

  let options = { noHover: false, insets: () => null, viewportHeight: 0, viewport: null };
  let unitsVar = false; // viewport units rewritten to var(--mirrorly-svh/lvh)
  let frozen = false;

  function swapMedia(text) {
    return text.replace(MEDIA_FEATURE, (match, any = '', feature, value) => {
      const name = `${any}${feature}`;
      if (!value) return feature.toLowerCase() === 'hover' ? `(${name}: none)` : match;
      if (feature.toLowerCase() === 'pointer' && value.toLowerCase() === 'none') return match;
      return `(${name}: ${SWAP[value.toLowerCase()]})`;
    });
  }

  function replaceInsets(text) {
    const insets = options.insets();
    return insets ? text.replace(ENV, (match, side) => `${insets[side.toLowerCase()] || 0}px`) : text;
  }

  function replaceViewportUnits(text) {
    if (unitsVar) {
      return text.replace(VH, (match, n, unit) => {
        const name = { svh: 'svh', dvh: 'dvh' }[unit.toLowerCase()] || 'lvh';
        return `calc(${n} * var(--mirrorly-${name}, 1${unit}))`;
      });
    }
    const h = options.viewportHeight;
    return h ? text.replace(VH, (match, n) => `${+((Number(n) * h) / 100).toFixed(3)}px`) : text;
  }

  // Keeps --mirrorly-svh, -dvh and -lvh at 1% of each viewport's height.
  function updateViewportVar() {
    if (!unitsVar || frozen) return;
    const { small, dynamic, large } = options.viewport();
    const root = document.documentElement.style;
    root.setProperty('--mirrorly-svh', `${small / 100}px`);
    root.setProperty('--mirrorly-dvh', `${dynamic / 100}px`);
    root.setProperty('--mirrorly-lvh', `${large / 100}px`);
  }

  let done = new WeakSet();
  let ruleCounts = new WeakMap();
  // Media already swapped. Swapping flips a query, so each is done once.
  const swapped = new WeakSet();
  const pending = new Set(); // cross-origin sheets being fetched

  function rewriteRules(rules) {
    for (const rule of rules) {
      if (done.has(rule)) continue;
      done.add(rule);
      if (options.noHover && rule.media && !swapped.has(rule) && HAS_FEATURE.test(rule.media.mediaText)) {
        swapped.add(rule);
        try {
          rule.media.mediaText = swapMedia(rule.media.mediaText);
        } catch {}
      }
      if (options.noHover && rule.selectorText && rule.selectorText.includes(':hover')) {
        try {
          rule.selectorText = rule.selectorText.replaceAll(':hover', NO_HOVER);
        } catch {}
      }
      if (rule.style && (rule.style.cssText.includes('safe-area-inset') || ((options.viewportHeight || unitsVar) && VH.test(rule.style.cssText)))) {
        VH.lastIndex = 0;
        const text = replaceViewportUnits(replaceInsets(rule.style.cssText));
        if (text !== rule.style.cssText) {
          guardTransitions();
          try {
            rule.style.cssText = text;
          } catch {}
        }
      }
      if (rule.styleSheet) rewriteSheet(rule.styleSheet);
      if (rule.cssRules) rewriteRules(rule.cssRules);
    }
  }

  function rewriteSheet(sheet) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      const job = replaceCrossOrigin(sheet);
      pending.add(job);
      job.finally(() => pending.delete(job));
      return;
    }
    if (ruleCounts.get(sheet) === rules.length) return;
    ruleCounts.set(sheet, rules.length);
    rewriteRules(rules);
  }

  // Fetch the stylesheet, rewrite it, and put the rewritten copy right after
  // the original (so the cascade order holds) before switching the original off.
  const replaced = new WeakSet();
  async function replaceCrossOrigin(sheet) {
    const link = sheet.ownerNode;
    if (!link || replaced.has(link) || !link.href) return;
    replaced.add(link);
    let css;
    try {
      const response = await fetch(link.href);
      if (!response.ok) return;
      css = await response.text();
    } catch {
      return;
    }
    const base = link.href;
    css = css
      .replace(/@charset[^;]*;/gi, '')
      .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote, url) => {
        if (/^(data:|#)/i.test(url.trim())) return match;
        try {
          return `url("${new URL(url.trim(), base).href}")`;
        } catch {
          return match;
        }
      });
    const parsed = new CSSStyleSheet();
    try {
      parsed.replaceSync(css);
    } catch {
      return;
    }
    rewriteRules(parsed.cssRules);
    guardTransitions();
    const style = document.createElement('style');
    if (link.media) style.media = options.noHover ? swapMedia(link.media) : link.media;
    link.after(style);
    for (const rule of parsed.cssRules) {
      try {
        style.sheet.insertRule(rule.cssText, style.sheet.cssRules.length);
      } catch {}
    }
    // The copies were rewritten before they went in.
    const mark = (rules) => {
      for (const rule of rules) {
        done.add(rule);
        if (rule.media) swapped.add(rule);
        if (rule.cssRules) mark(rule.cssRules);
      }
    };
    mark(style.sheet.cssRules);
    ruleCounts.set(style.sheet, style.sheet.cssRules.length);
    link.disabled = true;
  }

  // Rewriting viewport units changes sizes the page may animate (its own
  // `transition: min-height`, say). Those should jump to their new values,
  // as if the page had loaded with them, not animate there (which background
  // tabs never finish doing). So right before a change, transitions go off
  // until the new values are applied, at the end of the current task.
  let guard = null;
  function guardTransitions() {
    if (!unitsVar || guard) return;
    guard = document.createElement('style');
    guard.textContent = '*, *::before, *::after { transition: none !important; }';
    document.documentElement.append(guard);
    queueMicrotask(() => {
      void document.documentElement.offsetHeight; // apply the new values now
      guard.remove();
      guard = null;
    });
  }

  function rewriteAll() {
    if (options.noHover) {
      for (const link of document.querySelectorAll('link[rel~="stylesheet" i][media]')) {
        if (swapped.has(link)) continue;
        swapped.add(link);
        const media = swapMedia(link.media);
        if (media !== link.media) link.media = media;
      }
    }
    for (const el of document.querySelectorAll('[style*="safe-area-inset"]')) {
      el.setAttribute('style', replaceInsets(el.getAttribute('style')));
    }
    if (options.viewportHeight || unitsVar) {
      for (const el of document.querySelectorAll('[style*="vh"], [style*="vmax"]')) {
        const text = replaceViewportUnits(el.getAttribute('style'));
        if (text !== el.getAttribute('style')) {
          guardTransitions();
          el.setAttribute('style', text);
        }
      }
    }
    for (const sheet of document.styleSheets) rewriteSheet(sheet);
  }

  return {
    swapMedia,

    // Fixes viewport-height units at `height` from now on, in every
    // stylesheet (rewriting the ones already done), and resolves once
    // cross-origin sheets are in.
    async freezeViewport(height) {
      if (unitsVar) {
        // The units keep their present values as the frame grows.
        updateViewportVar();
        frozen = true;
        await Promise.all(pending);
        return;
      }
      options.viewportHeight = height;
      done = new WeakSet();
      ruleCounts = new WeakMap();
      rewriteAll();
      await Promise.all(pending);
    },

    updateViewport: () => updateViewportVar(),

    // Called at document_start.
    start(opts) {
      options = { ...options, ...opts };
      const ready = () => {
        // Decided once: the page's viewport tag is in by now.
        const v = options.viewport?.();
        unitsVar = Boolean(v && (v.small !== innerHeight || v.dynamic !== innerHeight || v.large !== innerHeight));
        if (unitsVar) {
          updateViewportVar();
          addEventListener('resize', updateViewportVar);
        }
        rewriteAll();
        let pending = 0;
        new MutationObserver(() => {
          if (!pending) pending = setTimeout(() => ((pending = 0), rewriteAll()), 100);
        }).observe(document.head || document.documentElement, { childList: true, subtree: true });
        // Catches rules added by script (CSS-in-JS) without a DOM change.
        setInterval(rewriteAll, 1000);
      };
      addEventListener('DOMContentLoaded', ready, { once: true });
      addEventListener('load', rewriteAll, { once: true });
    },
  };
})();
