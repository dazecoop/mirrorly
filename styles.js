'use strict';

// Rewrites the mobile view's stylesheets so the page styles itself as it
// would on the phone:
// - noHover: :hover never matches, and (hover)/(pointer) media queries
//   answer as a touch screen would.
// - insets(): values for env(safe-area-inset-*), which desktop Firefox
//   always reports as 0. Safari 26, for example, includes its floating
//   toolbar in the bottom inset, and pages that opt in with
//   viewport-fit=cover keep their bottom bars clear of it.
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

  let options = { noHover: false, insets: () => null };

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

  const done = new WeakSet();
  const ruleCounts = new WeakMap();

  function rewriteRules(rules) {
    for (const rule of rules) {
      if (done.has(rule)) continue;
      done.add(rule);
      if (options.noHover && rule.media && HAS_FEATURE.test(rule.media.mediaText)) {
        try {
          rule.media.mediaText = swapMedia(rule.media.mediaText);
        } catch {}
      }
      if (options.noHover && rule.selectorText && rule.selectorText.includes(':hover')) {
        try {
          rule.selectorText = rule.selectorText.replaceAll(':hover', NO_HOVER);
        } catch {}
      }
      if (rule.style && rule.style.cssText.includes('safe-area-inset')) {
        const text = replaceInsets(rule.style.cssText);
        if (text !== rule.style.cssText) {
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
      replaceCrossOrigin(sheet);
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
    const style = document.createElement('style');
    if (link.media) style.media = options.noHover ? swapMedia(link.media) : link.media;
    link.after(style);
    for (const rule of parsed.cssRules) {
      try {
        style.sheet.insertRule(rule.cssText, style.sheet.cssRules.length);
      } catch {}
    }
    for (const rule of style.sheet.cssRules) done.add(rule);
    ruleCounts.set(style.sheet, style.sheet.cssRules.length);
    link.disabled = true;
  }

  function rewriteAll() {
    if (options.noHover) {
      for (const link of document.querySelectorAll('link[rel~="stylesheet" i][media]')) {
        const media = swapMedia(link.media);
        if (media !== link.media) link.media = media;
      }
    }
    for (const el of document.querySelectorAll('[style*="safe-area-inset"]')) {
      el.setAttribute('style', replaceInsets(el.getAttribute('style')));
    }
    for (const sheet of document.styleSheets) rewriteSheet(sheet);
  }

  return {
    swapMedia,

    // Called at document_start.
    start(opts) {
      options = { ...options, ...opts };
      const ready = () => {
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
