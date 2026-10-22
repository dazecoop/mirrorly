'use strict';

// Draws the phone's status bar, camera cutout, browser toolbars and home
// indicator over the mobile view. Sizes are CSS px on the device screen,
// measured from iPhone 16 Pro screenshots (402×874) of Safari 26 and Firefox
// for iOS.

const MirrorlyChrome = (() => {
  const svg = (viewBox, body, size = '') => `<svg viewBox="${viewBox}" ${size} aria-hidden="true">${body}</svg>`;
  const stroke = (d, w = 2) =>
    `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

  const ICON = {
    back: svg('0 0 24 24', stroke('M15 4.5 7.5 12l7.5 7.5', 2.4)),
    forward: svg('0 0 24 24', stroke('M9 4.5 16.5 12 9 19.5', 2.4)),
    plus: svg('0 0 24 24', stroke('M12 4v16M4 12h16', 2.2)),
    dots: svg('0 0 24 24', '<circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/>'),
    dotsV: svg('0 0 24 24', '<circle cx="12" cy="5" r="1.9" fill="currentColor"/><circle cx="12" cy="12" r="1.9" fill="currentColor"/><circle cx="12" cy="19" r="1.9" fill="currentColor"/>'),
    reload: svg('0 0 24 24', stroke('M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4.5H15', 2)),
    share: svg('0 0 24 24', stroke('M12 3v12M8 6.5 12 3l4 3.5M8.5 9.5H6.5a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 6.5 20.5h11a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5h-2', 1.8)),
    shield: svg('0 0 24 24', '<path d="M12 2.5 4.5 5.5v6c0 4.6 3.2 8.4 7.5 10 4.3-1.6 7.5-5.4 7.5-10v-6z" fill="currentColor"/><path d="m8.5 12 2.5 2.5 4.5-5" style="fill:none;stroke:var(--pill);stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>'),
    reader: svg('0 0 24 24', stroke('M6 3.5h8.5L18 7v13.5H6zM9 10h6M9 13.5h6M9 17h4', 1.7)),
    lines: svg('0 0 24 24', stroke('M4 7h16M4 12h16M4 17h10', 2.1)),
    safariTabs: svg('0 0 24 24', stroke('M8 8V5.5A1.5 1.5 0 0 1 9.5 4h9A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H16M5.5 8h9A1.5 1.5 0 0 1 16 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 18.5v-9A1.5 1.5 0 0 1 5.5 8z', 1.9)),
    home: svg('0 0 24 24', stroke('M4 11 12 4l8 7M6.5 9v10.5h11V9', 2)),
    tune: svg('0 0 24 24', stroke('M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5', 2)),
    arrowBack: svg('0 0 24 24', stroke('M20 12H4.5M10.5 5.5 4 12l6.5 6.5', 2)),
    arrowForward: svg('0 0 24 24', stroke('M4 12h15.5M13.5 5.5 20 12l-6.5 6.5', 2)),
    chevronUp: svg('0 0 24 24', stroke('M5 15l7-7 7 7', 2.2)),
    chevronDown: svg('0 0 24 24', stroke('M5 9l7 7 7-7', 2.2)),
    check: svg('0 0 24 24', stroke('M4.5 12.5l5 5 10-11', 2.2)),
    key: svg('0 0 24 24', '<circle cx="7" cy="12" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10.6 12h10.4M17 12v3M20 12v2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
    card: svg('0 0 24 24', stroke('M4 6.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM3 10h18M6 14.5h4', 1.7)),
    pin: svg('0 0 24 24', stroke('M12 21s6.5-6.3 6.5-11.2a6.5 6.5 0 0 0-13 0C5.5 14.7 12 21 12 21zM12 12.3a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8z', 1.7)),
    hideKeyboard: svg('0 0 24 24', '<rect x="3" y="4" width="18" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6.5 7.5h1M9.5 7.5h1M12.5 7.5h1M15.5 7.5h1M6.5 10h1M9.5 10h1M12.5 10h1M15.5 10h1M8.5 12.5h7M9 18l3 2.5 3-2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'),
    shift: svg('0 0 24 24', stroke('M12 4 3.5 12.5H8V19h8v-6.5h4.5z', 1.7)),
    shiftOn: svg('0 0 24 24', '<path d="M12 4 3.5 12.5H8V19h8v-6.5h4.5z" fill="currentColor" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>'),
    backspace: svg('0 0 28 24', stroke('M9 5h15a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 24 19H9l-6.5-7zM13.5 9l6 6M19.5 9l-6 6', 1.7)),
    search: svg('0 0 24 24', stroke('M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.3 15.3 20.5 20.5', 2.2)),
    returnKey: svg('0 0 24 24', stroke('M19 6v6.5a1.5 1.5 0 0 1-1.5 1.5H5.5M9 10l-4 4 4 4', 2)),
    emoji: svg('0 0 26 26', '<circle cx="13" cy="13" r="12.5" fill="currentColor"/><circle cx="9" cy="10" r="1.7" fill="var(--kb-panel)"/><circle cx="17" cy="10" r="1.7" fill="var(--kb-panel)"/><path d="M6.5 14.5h13a6.5 6.5 0 0 1-13 0z" fill="var(--kb-panel)"/>'),
    mic: svg('0 0 24 24', stroke('M12 3.5a3 3 0 0 1 3 3v5.5a3 3 0 0 1-6 0V6.5a3 3 0 0 1 3-3zM5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7', 1.8)),
    page: svg('0 0 24 24', stroke('M7 3.5h10a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5zM9 8h6M9 11.5h6M9 15h4', 1.8)),
  };

  // part: 'left' (signal and Wi-Fi), 'right' (battery) or both.
  function statusIcons(part) {
    const signal = svg(
      '0 0 18 12',
      [0, 1, 2, 3].map((i) => `<rect x="${i * 4.7}" y="${8.4 - i * 2.8}" width="3.2" height="${3.6 + i * 2.8}" rx="0.9" fill="currentColor"/>`).join(''),
      'width="18" height="12"',
    );
    const wifi = svg(
      '0 0 16 12',
      '<path d="M8 11.6 10.4 9a3.4 3.4 0 0 0-4.8 0z" fill="currentColor"/><path d="M3.3 6.7a6.6 6.6 0 0 1 9.4 0l-1.4 1.5a4.6 4.6 0 0 0-6.6 0z" fill="currentColor"/><path d="M.7 3.9a10.3 10.3 0 0 1 14.6 0l-1.4 1.5a8.3 8.3 0 0 0-11.8 0z" fill="currentColor"/>',
      'width="16" height="12"',
    );
    const battery = svg(
      '0 0 27 13',
      '<rect x="0.5" y="0.5" width="23" height="12" rx="3.8" fill="none" stroke="currentColor" stroke-opacity=".4"/><rect x="2" y="2" width="20" height="9" rx="2.5" fill="currentColor"/><path d="M25 4.5v4a2 2 0 0 0 0-4z" fill="currentColor" fill-opacity=".45"/>',
      'width="27" height="13"',
    );
    if (part === 'left') return `${signal}${wifi}`;
    if (part === 'right') return battery;
    return `${signal}${wifi}${battery}`;
  }

  function androidIcons() {
    const wifi = svg('0 0 16 16', '<path d="M8 14 .5 5.5a11 11 0 0 1 15 0z" fill="currentColor"/>', 'width="15" height="15"');
    const signal = svg('0 0 16 16', '<path d="M15 1v14H1z" fill="currentColor"/>', 'width="14" height="14"');
    const battery = svg('0 0 10 16', '<rect x="1" y="2" width="8" height="13.5" rx="1.5" fill="currentColor"/><rect x="3.5" y=".5" width="3" height="2" rx=".5" fill="currentColor"/>', 'width="9" height="15"');
    return `${wifi}${signal}${battery}`;
  }

  function statusBar(c, bg, fg) {
    const { d } = c;
    const W = d.width;
    if (d.kind === 'android') {
      return `<div class="sb android" style="height:${d.safeTop}px;background:${bg};color:${fg}">
        <span class="sb-time" style="left:20px">${c.time}</span>
        <span class="sb-icons" style="right:18px">${androidIcons()}</span></div>`;
    }
    const cy = d.cutout === 'island' ? d.islandTop + 18.5 : d.safeTop / 2 + (d.cutout === 'notch' ? 2 : 0);
    let time;
    let icons;
    if (d.cutout) {
      // Centred in the "ears" either side of the cutout.
      const ear = (W / 2 - 63) / 2 - 9;
      time = `left:${ear}px;transform:translate(-50%,-50%)`;
      icons = `left:${W - ear - 6}px;transform:translate(-50%,-50%)`;
    } else {
      // Home-button iPhones: signal and Wi-Fi on the left, time in the
      // middle, battery on the right.
      return `<div class="sb ios small" style="height:${d.safeTop}px;background:${bg};color:${fg}">
        <span class="sb-icons" style="top:${cy}px;left:6px;transform:translateY(-50%)">${statusIcons('left')}</span>
        <span class="sb-time" style="top:${cy}px;left:50%;transform:translate(-50%,-50%)">${c.time}</span>
        <span class="sb-icons" style="top:${cy}px;right:6px;transform:translateY(-50%)"><span class="sb-pct">100%</span>${statusIcons('right')}</span></div>`;
    }
    return `<div class="sb ios" style="height:${d.safeTop}px;background:${bg};color:${fg}">
      <span class="sb-time" style="top:${cy}px;${time}">${c.time}</span>
      <span class="sb-icons" style="top:${cy}px;${icons}">${statusIcons()}</span></div>`;
  }

  function cutout(d) {
    if (d.cutout === 'island') return `<div class="island" style="top:${d.islandTop}px"></div>`;
    if (d.cutout === 'notch') return '<div class="notch"></div>';
    if (d.cutout === 'punch') return `<div class="punch" style="top:${d.safeTop / 2 - 6}px"></div>`;
    return '';
  }

  function homeIndicator(d, color) {
    if (!d.safeBottom || d.kind === 'android') return '';
    return `<div class="home-indicator" style="background:${color}"></div>`;
  }

  function safari(c) {
    const { d, dark } = c;
    const fg = c.tintDark ? '#fff' : '#000';
    const theme = dark ? 'dark' : 'light';
    let html = statusBar(c, c.tint, fg) + cutout(d);
    if (d.kind === 'ipad') {
      html += `<div class="saf-top ${theme}" style="top:${d.safeTop}px">
        <span class="ico">${ICON.back}</span><span class="ico dim">${ICON.forward}</span>
        <div class="saf-pill">${ICON.lines}<span class="dom">${c.domain}</span>${ICON.reload}</div>
        <span class="ico">${ICON.share}</span><span class="ico">${ICON.plus}</span><span class="ico">${ICON.safariTabs}</span></div>`;
    } else if (!c.keyboard) {
      // Safari hides its toolbar while typing.
      const side = d.radius ? 34 : 16;
      html += `<div class="saf-bar ${theme}" style="bottom:${Math.max(d.safeBottom, 10)}px;padding:0 ${side}px">
        <div class="glass circle">${ICON.back}</div>
        <div class="glass pill">${ICON.lines}<span class="dom">${c.domain}</span>${ICON.reload}</div>
        <div class="glass circle">${ICON.safariTabs}</div></div>`;
    }
    return html + homeIndicator(d, c.tintDark ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.85)');
  }

  const FIREFOX = {
    dark: { status: '#2d2b30', bar: '#48484a', border: '#3c3c3e', pill: '#131315', pillText: '#afaeb4', icon: '#f0eff4', dim: '#7a7a7d' },
    light: { status: '#f9f9fb', bar: '#f9f9fb', border: '#e0e0e6', pill: '#e8e8ed', pillText: '#5b5b66', icon: '#15141a', dim: '#b4b4bc' },
  };

  function firefox(c) {
    const { d } = c;
    const p = FIREFOX[c.dark ? 'dark' : 'light'];
    const vars = `--bar:${p.bar};--pill:${p.pill};--pill-text:${p.pillText};--icon:${p.icon};--dim:${p.dim};--border:${p.border}`;
    return (
      statusBar(c, p.status, p.icon) +
      cutout(d) +
      `<div class="fx-bar" style="${vars};height:${110 + d.safeBottom}px">
        <div class="fx-url">
          <span class="ico">${ICON.share}</span>
          <span class="fx-site"><span class="ico small">${ICON.shield}</span><span class="dom">${c.domain}</span></span>
          <span class="ico">${ICON.reader}</span><span class="ico">${ICON.reload}</span>
        </div>
        <div class="fx-nav">
          <span class="ico">${ICON.back}</span><span class="ico dim">${ICON.forward}</span>
          <span class="ico">${ICON.plus}</span><span class="ico">${ICON.dots}</span>
          <span class="fx-tabs">${c.tabs}</span>
        </div>
      </div>` +
      homeIndicator(d, c.dark ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.85)')
    );
  }

  // Chrome for iOS: address bar under the status bar, toolbar at the bottom.
  const CHROME_IOS = {
    dark: { bar: '#363739', line: '#18191b', pill: '#606467', text: '#fff', icon: '#e8eaed', dim: '#7c7d80', badge: '#34383b', accent: '#8db5fa', plus: '#606368' },
    light: { bar: '#f8f9fa', line: '#d5d7da', pill: '#e8eaed', text: '#202124', icon: '#3c4043', dim: '#b0b3b8', badge: '#ffffff', accent: '#1a73e8', plus: '#dadce0' },
  };

  function chromeIos(c) {
    const { d } = c;
    const p = CHROME_IOS[c.dark ? 'dark' : 'light'];
    const vars = `--bar:${p.bar};--line:${p.line};--pill:${p.pill};--text:${p.text};--icon:${p.icon};--dim:${p.dim};--badge:${p.badge};--accent:${p.accent};--plus:${p.plus}`;
    return (
      statusBar(c, p.bar, p.text) +
      cutout(d) +
      `<div class="cri-top" style="${vars};top:${d.safeTop}px">
        <div class="cri-pill"><span class="cri-badge">${ICON.page}</span><span class="dom">${c.domain}</span><span class="ico">${ICON.share}</span></div>
      </div>
      <div class="cri-bottom" style="${vars};height:${44 + d.safeBottom}px">
        <span class="ico">${ICON.arrowBack}</span><span class="ico dim">${ICON.arrowForward}</span>
        <span class="cri-plus">${ICON.plus}</span>
        <span class="fx-tabs">${c.tabs}</span><span class="ico">${ICON.dots}</span>
      </div>` +
      homeIndicator(d, c.dark ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.85)')
    );
  }

  const CHROME = {
    dark: { bar: '#202124', pill: '#303134', text: '#e3e3e3', icon: '#c4c7c5', nav: '#000' },
    light: { bar: '#ffffff', pill: '#eef0f3', text: '#1f1f1f', icon: '#444746', nav: '#fff' },
  };

  function chrome(c) {
    const { d } = c;
    const p = CHROME[c.dark ? 'dark' : 'light'];
    return (
      statusBar(c, p.bar, p.text) +
      cutout(d) +
      `<div class="cr-bar" style="top:${d.safeTop}px;background:${p.bar};color:${p.icon}">
        <span class="ico">${ICON.home}</span>
        <div class="cr-pill" style="background:${p.pill};color:${p.text}"><span class="ico small">${ICON.tune}</span><span class="dom">${c.domain}</span></div>
        <span class="cr-tabs">${c.tabs}</span><span class="ico">${ICON.dotsV}</span>
      </div>
      <div class="cr-nav" style="height:${d.safeBottom}px;background:${p.nav}"><span style="background:${c.dark ? '#c4c7c5' : '#1f1f1f'}"></span></div>`
    );
  }

  // --- Landscape

  function landscapeCutout(d) {
    if (d.cutout === 'island') return `<div class="island land" style="left:${d.islandTop}px"></div>`;
    if (d.cutout === 'notch') return '<div class="notch land"></div>';
    if (d.cutout === 'punch') return '<div class="punch" style="left:14px;top:50%;margin:-6px 0 0"></div>';
    return '';
  }

  function landscape(c) {
    const { d, dark } = c;
    const { toolbar } = Mirrorly.LANDSCAPE;
    const side = d.kind === 'iphone' && d.cutout ? d.safeTop : 0;
    const indicator = (color) => (d.safeBottom && d.kind !== 'android' ? `<div class="home-indicator land" style="background:${color}"></div>` : '');
    const theme = dark ? 'dark' : 'light';
    let html = landscapeCutout(d);

    if (d.kind === 'android') {
      const p = CHROME[theme];
      return (
        statusBar(c, p.bar, p.text) +
        html +
        `<div class="cr-bar" style="top:${d.safeTop}px;background:${p.bar};color:${p.icon}">
          <span class="ico">${ICON.home}</span>
          <div class="cr-pill" style="background:${p.pill};color:${p.text}"><span class="ico small">${ICON.tune}</span><span class="dom">${c.domain}</span></div>
          <span class="cr-tabs">${c.tabs}</span><span class="ico">${ICON.dotsV}</span>
        </div>
        <div class="cr-nav" style="height:${d.safeBottom}px;background:${p.nav}"><span style="background:${dark ? '#c4c7c5' : '#1f1f1f'}"></span></div>`
      );
    }

    if (c.frame === 'safari') {
      if (d.kind === 'ipad') return safari(c);
      // The floating bar stays at the bottom, narrower than the screen.
      html += `<div class="saf-bar ${theme}" style="bottom:${Math.max(d.safeBottom ? Mirrorly.LANDSCAPE.homeStrip - 8 : 8, 6)}px;padding:0 ${Math.round(d.width * 0.22)}px">
        <div class="glass circle">${ICON.back}</div>
        <div class="glass pill">${ICON.lines}<span class="dom">${c.domain}</span>${ICON.reload}</div>
        <div class="glass circle">${ICON.safariTabs}</div></div>`;
      return html + indicator(c.tintDark ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.85)');
    }

    // Chrome and Firefox: everything in one toolbar across the top.
    const chromeIos = c.frame === 'chrome-ios';
    const p = chromeIos ? CHROME_IOS[theme] : FIREFOX[theme];
    const bar = p.bar;
    const pill = p.pill;
    const text = chromeIos ? p.text : p.pillText;
    html += `<div class="land-bar" style="height:${toolbar}px;padding:0 ${side + 8}px;background:${bar};color:${p.icon};border-bottom:.5px solid ${chromeIos ? p.line : p.border}">
      <span class="ico">${chromeIos ? ICON.arrowBack : ICON.back}</span>
      <span class="ico" style="color:${p.dim}">${chromeIos ? ICON.arrowForward : ICON.forward}</span>
      <span class="ico">${ICON.reload}</span>
      <div class="land-pill" style="background:${pill};color:${text}">${chromeIos ? `<span class="cri-badge" style="background:${p.badge};color:${p.accent}">${ICON.page}</span>` : `<span class="ico small">${ICON.shield}</span>`}<span class="dom">${c.domain}</span></div>
      <span class="ico">${ICON.share}</span>
      <span class="fx-tabs">${c.tabs}</span>
      <span class="ico">${ICON.dots}</span>
    </div>`;
    return html + indicator(c.dark ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.85)');
  }

  // --- On-screen keyboard (iOS 26), measured from iPhone 17 Pro screenshots.
  // Positions are points from the top of the keyboard panel.

  const KB = {
    height: 327.3, // panel top to screen bottom on Face ID iPhones
    compactHeight: 264.3, // home-button iPhones: no emoji/dictation row
    margin: 6.7,
    gap: 6.15,
    wideGap: 13.7, // between shift/delete and the letters
    rows: [51.3, 105.3, 159.3, 213.3],
    keyHeight: 43,
    suggestY: 23.3,
    // How far above the panel each browser's page ends (its accessory bar
    // and, for Safari and Firefox, the site pill sit in between).
    pageGap: { safari: 101.7, firefox: 97.7, 'chrome-ios': 72.7, screen: 0 },
  };

  // The keyboard is translucent: these alphas reproduce both the Safari
  // screenshot (over a white page) and the Firefox one (over its dark bar).
  const KB_THEME = {
    dark: { panel: 'rgba(38,38,38,.92)', key: 'rgba(255,255,255,.16)', fn: 'rgba(255,255,255,.16)', popup: 'rgba(255,255,255,.23)', pressed: 'rgba(255,255,255,.33)', text: '#fff', suggest: '#acacac', line: 'rgba(255,255,255,.08)', shadow: 'none', icon: '#fff' },
    light: { panel: 'rgba(210,214,223,.94)', key: '#ffffff', fn: '#abb1bc', popup: '#ffffff', pressed: '#dcdfe5', text: '#000', suggest: '#6d6d72', line: '#b5b8bf', shadow: '0 1px 0 rgba(0,0,0,.3)', icon: '#000' },
  };

  const LAYERS = {
    letters: ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'],
    numbers: ['1234567890', '-/:;()£&@“', '.,?!’'],
    symbols: ['[]{}#%^*+=', '_\\|~<>€$¥•', '.,?!’'],
  };

  function supportsKeyboard(d, frame) {
    if (d.landscape) return false;
    if (d.kind === 'android') return ['chrome', 'screen'].includes(frame);
    return d.kind === 'iphone' && ['safari', 'firefox', 'chrome-ios', 'screen'].includes(frame);
  }

  function keyboardLayout(d, frame) {
    if (d.kind === 'android') {
      // Chrome on Android resizes the page to end where the keyboard starts.
      const top = d.height - GB.nav - GB.height;
      return { top, height: GB.height + GB.nav, pageBottom: top };
    }
    const height = d.safeBottom ? KB.height : KB.compactHeight;
    const top = d.height - height;
    // Safari 26's site pill and keyboard bar float over the page as glass, so
    // the page itself runs down to the keyboard.
    const pageBottom = top - KB.pageGap[frame];
    return { top, height, pageBottom, viewBottom: frame === 'safari' ? top : pageBottom };
  }

  // Phone keypad (type="tel"), and the plain number pads (inputmode numeric
  // or decimal). Measured from the iPhone 17 Pro.
  const PAD = { margin: 4.7, gap: 6, rows: [49.7, 103.7, 157.7, 211.7], keyHeight: 48 };
  const PAD_LETTERS = ['', 'ABC', 'DEF', 'GHI', 'JKL', 'MNO', 'PQRS', 'TUV', 'WXYZ'];

  function padKeys(c, k, offset = 0) {
    const W = c.d.width;
    const keyW = (W - PAD.margin * 2 - PAD.gap * 2) / 3;
    const x = (col) => PAD.margin + col * (keyW + PAD.gap);
    const keys = [];
    const add = (col, row, key, label, cls = '') =>
      keys.push(`<div class="kb-key pad ${cls}" data-key="${escape(key)}" style="left:${x(col)}px;top:${PAD.rows[row] + offset}px;width:${keyW}px;height:${PAD.keyHeight}px">${label}</div>`);
    const lettered = k.kind === 'phone';
    for (let n = 1; n <= 9; n++) {
      const letters = lettered ? PAD_LETTERS[n - 1] : '';
      add((n - 1) % 3, Math.floor((n - 1) / 3), String(n), `<span class="pad-digit">${n}</span>${letters ? `<span class="pad-letters">${letters}</span>` : ''}`);
    }
    if (k.kind === 'phone') add(0, 3, '+', '<span class="pad-symbols">+*#</span>', 'bare');
    else if (k.kind === 'decimal') add(0, 3, '.', '<span class="pad-digit">.</span>', 'bare');
    add(1, 3, '0', '<span class="pad-digit">0</span>');
    add(2, 3, 'delete', ICON.backspace, 'bare');
    return keys.join('');
  }

  function keyboardKeys(c, k) {
    const { d } = c;
    const W = d.width;
    if (['phone', 'numeric', 'decimal'].includes(k.kind)) return padKeys(c, k);
    const pitch = (W - KB.margin * 2 + KB.gap) / 10;
    const keyW = pitch - KB.gap;
    const layer = LAYERS[k.layer] || LAYERS.letters;
    const keys = [];
    // Character keys (no class) show the enlarged popup while pressed.
    const add = (x, row, w, key, label, cls = '') =>
      keys.push(
        `<div class="kb-key ${cls}" data-key="${escape(key)}"${cls ? '' : ' data-char'} style="left:${x}px;top:${KB.rows[row]}px;width:${w}px">${label}</div>`,
      );
    const upper = k.layer === 'letters' && k.shift;
    [...layer[0]].forEach((ch, i) => add(KB.margin + i * pitch, 0, keyW, ch, escape(upper ? ch.toUpperCase() : ch)));
    const row2Start = k.layer === 'letters' ? KB.margin + pitch / 2 : KB.margin;
    [...layer[1]].forEach((ch, i) => add(row2Start + i * pitch, 1, keyW, ch, escape(upper ? ch.toUpperCase() : ch)));

    const fnW = 1.5 * pitch - KB.wideGap; // shift and delete
    const left = KB.margin + fnW + KB.wideGap;
    const right = W - KB.margin - fnW - KB.wideGap;
    if (k.layer === 'letters') {
      add(KB.margin, 2, fnW, 'shift', k.shift ? ICON.shiftOn : ICON.shift, `fn${k.shift ? ' on' : ''}`);
    } else {
      add(KB.margin, 2, fnW, k.layer === 'numbers' ? 'symbols' : 'numbers', k.layer === 'numbers' ? '#+=' : '123', 'fn small');
    }
    const row3 = [...layer[2]];
    const w3 = (right - left - KB.gap * (row3.length - 1)) / row3.length;
    row3.forEach((ch, i) => add(left + i * (w3 + KB.gap), 2, w3, ch, escape(upper ? ch.toUpperCase() : ch)));
    add(W - KB.margin - fnW, 2, fnW, 'delete', ICON.backspace, 'fn');

    const sideW = 2.5 * pitch - KB.gap;
    const compact = !d.safeBottom;
    let x = KB.margin;
    add(x, 3, sideW, 'layer', k.layer === 'letters' ? '123' : 'ABC', 'fn small');
    x += sideW + KB.gap;
    if (compact) {
      // Home-button iPhones keep the emoji key in the bottom row.
      add(x, 3, keyW, 'emoji', ICON.emoji, 'fn icon');
      x += keyW + KB.gap;
    }
    const enterW = sideW;
    const enterX = W - KB.margin - enterW;
    if (k.kind === 'email') {
      // Email: a shorter space bar with @ and . beside it.
      const small = 43.3;
      const dotX = enterX - KB.gap - small;
      const atX = dotX - KB.gap - small;
      add(x, 3, atX - KB.gap - x, ' ', '', 'space');
      add(atX, 3, small, '@', '@');
      add(dotX, 3, small, '.', '.');
    } else {
      add(x, 3, enterX - KB.gap - x, ' ', '', 'space');
    }
    const search = k.enter === 'search';
    add(enterX, 3, enterW, 'enter', search ? ICON.search : ICON.returnKey, search ? 'enter blue' : 'fn');
    return keys.join('');
  }

  function keyboardAccessory(c, layout) {
    const { frame, dark } = c;
    const y = layout.top;
    const site = (bg, color, top) =>
      `<div class="kb-site" style="top:${top}px;background:${bg};color:${color}">${frame === 'firefox' ? `<span class="ico small">${ICON.shield}</span>` : ''}${c.domain}</div>`;
    if (frame === 'safari') {
      const theme = dark ? 'dark' : 'light';
      // Safari hides its toolbar while typing; the page shows through the glass.
      return `${site('', '', y - 100.7).replace('class="kb-site"', `class="kb-site glass-chip ${theme}"`)}
        <div class="kb-bar glass-chip ${theme}" style="top:${y - 58.4}px">
          <span class="ico" data-key="up">${ICON.chevronUp}</span><span class="ico" data-key="down">${ICON.chevronDown}</span>
          ${c.keyboard.autofill ? '<span class="kb-autofill">AutoFill Contact</span>' : ''}
          <span class="spacer"></span><span class="ico" data-key="done">${ICON.check}</span>
        </div>`;
    }
    if (frame === 'firefox') {
      const p = dark
        ? { fill: 'linear-gradient(#28272c, #38373c)', pill: '#424146', chip: '#47464b', icon: '#fbfbfe', check: '#d6befc' }
        : { fill: '#f0f0f4', pill: '#e0e0e6', chip: '#e0e0e6', icon: '#15141a', check: '#7542e5' };
      return `<div class="kb-fill" style="top:${layout.pageBottom}px;bottom:0;background:${p.fill}"></div>
        ${site(p.pill, p.icon, y - 93.4)}
        <div class="kb-pill" style="top:${y - 54.7}px;left:15.7px;width:98.3px;background:${p.chip};color:${p.icon}">
          <span class="ico" data-key="up">${ICON.chevronUp}</span><span class="ico" data-key="down">${ICON.chevronDown}</span>
        </div>
        <div class="kb-round" style="top:${y - 54.7}px;right:16.3px;background:${p.chip};color:${p.check}" data-key="done">${ICON.check}</div>`;
    }
    if (frame === 'chrome-ios') {
      const p = dark ? { chip: '#3a3b3d', icon: '#fff' } : { chip: '#ffffff', icon: '#3c4043' };
      return `<div class="kb-fill" style="top:${layout.pageBottom}px;bottom:0;background:${c.tint}"></div>
        <div class="kb-pill" style="top:${y - 71}px;left:11.7px;width:152.3px;height:57.3px;gap:26.4px;padding:0 10.3px;background:${p.chip};color:${p.icon}">
          <span class="ico">${ICON.key}</span><span class="ico">${ICON.card}</span><span class="ico">${ICON.pin}</span>
        </div>
        <div class="kb-round" style="top:${y - 66}px;right:12.2px;background:${p.chip};color:${p.icon}" data-key="done">${ICON.hideKeyboard}</div>`;
    }
    return '';
  }

  // The QuickType bar. Contact suggestions use placeholders, not real details.
  function keyboardSuggestions(k, W) {
    const cell = (left, width, key, lines) =>
      `<div class="kb-suggest${lines.length > 1 ? ' two' : ''}" data-key="${escape(key)}" style="left:${left}px;width:${width}px;top:${KB.suggestY}px">${lines
        .map((line) => `<span>${escape(line)}</span>`)
        .join('')}</div>`;
    const sep = (left) => `<span class="kb-sep" style="left:${left}px;top:11.5px"></span>`;
    if (['phone', 'numeric', 'decimal'].includes(k.kind)) {
      return k.kind === 'phone' ? cell(30.3, W - 60.6, 'fill:07700 900123', ['iPhone', '07700 900123']) + sep(30.3) + sep(W - 30.3) : '';
    }
    if (k.kind === 'email') {
      return cell(0, W / 2, 'fill:name@example.com', ['home', 'name@example.com']) + sep(W / 2) + cell(W / 2, W / 2, 'none', ['Hide My Email']);
    }
    return ['I', 'The', 'I’m'].map((word, i) => cell((W / 3) * i, W / 3, `word:${word}`, [word])).join('') + sep(W / 3) + sep((W * 2) / 3);
  }

  // --- Gboard (Android), measured from a 412×891 screenshot with the
  // number row on. Positions are px from the top of the keyboard.

  const GB = {
    height: 330.8,
    nav: 40, // navigation bar under the keyboard (hide keyboard / switch keyboard)
    margin: 4.6,
    gap: 5.3,
    rows: [51.2, 103.8, 159.9, 216.3, 272.6],
    numberRowHeight: 44.6,
    keyHeight: 47.6,
  };

  const GB_THEME = {
    light: { panel: '#e9eaee', key: '#ffffff', fn: '#cbced5', text: '#000', icon: '#5f6368', line: '#c1c5c8', shadow: '0 1px 0 #aaacab', blue: '#1a73e8', blueText: '#fff', popup: '#ffffff', pressed: '#dadce0', nav: '#e9eaee' },
    dark: { panel: '#202124', key: '#3c4043', fn: '#2d2e31', text: '#e8eaed', icon: '#9aa0a6', line: '#000', shadow: '0 1px 0 #000', blue: '#8ab4f8', blueText: '#202124', popup: '#5f6368', pressed: '#5f6368', nav: '#202124' },
  };

  const GB_LAYERS = {
    letters: ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'],
    numbers: ['@#£_&-+()/', '*"\':;!?~', '%^[]<>='],
  };

  const GB_ICON = {
    sticker: svg('0 0 24 24', stroke('M5 4h14v9l-6 6H5zM13 19v-6h6M9 10h.01M15 10h.01M9.5 14a4 4 0 0 0 4 0', 1.8)),
    clipboard: svg('0 0 24 24', stroke('M8 4h8v3H8zM6 5.5H5v15h14v-15h-1M8.5 11h7M8.5 14.5h7M8.5 18h4', 1.8)),
    gear: svg('0 0 24 24', stroke('M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19.4 13.3l1.6 1.2-1.8 3.1-1.9-.7a7 7 0 0 1-2 1.2l-.3 2h-3.6l-.3-2a7 7 0 0 1-2-1.2l-1.9.7-1.8-3.1 1.6-1.2a7 7 0 0 1 0-2.6L3.4 9.5l1.8-3.1 1.9.7a7 7 0 0 1 2-1.2l.3-2h3.6l.3 2a7 7 0 0 1 2 1.2l1.9-.7 1.8 3.1-1.6 1.2a7 7 0 0 1 0 2.6z', 1.6)),
    back: svg('0 0 24 24', stroke('M14.5 6l-6 6 6 6', 2.2)),
    hide: svg('0 0 24 24', stroke('M6 9l6 6 6-6', 2.2)),
    keyboards: svg('0 0 24 24', stroke('M4 7h16v10H4zM7 10h.01M10 10h.01M13 10h.01M16 10h.01M8 14h8', 1.8)),
    shift: svg('0 0 24 24', '<path d="M12 4 3.5 12.5H8V19h8v-6.5h4.5z" fill="currentColor"/>'),
    shiftOff: svg('0 0 24 24', stroke('M12 4 3.5 12.5H8V19h8v-6.5h4.5z', 1.8)),
    smile: svg('0 0 24 24', stroke('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01', 1.8)),
  };

  function gboardKeys(c, k) {
    const W = c.d.width;
    const pitch = (W - GB.margin * 2 + GB.gap) / 10;
    const keyW = pitch - GB.gap;
    const fnW = 1.5 * pitch - GB.gap;
    const keys = [];
    const add = (x, row, w, key, label, cls = '') =>
      keys.push(
        `<div class="kb-key gb ${cls}" data-key="${escape(key)}"${cls ? '' : ' data-char'} style="left:${x}px;top:${GB.rows[row]}px;width:${w}px;height:${row === 0 ? GB.numberRowHeight : GB.keyHeight}px">${label}</div>`,
      );
    const upper = k.layer === 'letters' && k.shift;
    const label = (ch) => escape(upper ? ch.toUpperCase() : ch);
    [...'1234567890'].forEach((ch, i) => add(GB.margin + i * pitch, 0, keyW, ch, ch));
    const layer = GB_LAYERS[k.layer] || GB_LAYERS.letters;
    [...layer[0]].forEach((ch, i) => add(GB.margin + i * pitch, 1, keyW, ch, label(ch)));
    const row2 = [...layer[1]];
    const row2Start = (W - (row2.length * pitch - GB.gap)) / 2;
    row2.forEach((ch, i) => add(row2Start + i * pitch, 2, keyW, ch, label(ch)));
    if (k.layer === 'letters') add(GB.margin, 3, fnW, 'shift', k.shift ? GB_ICON.shift : GB_ICON.shiftOff, 'fn');
    else add(GB.margin, 3, fnW, 'layer', 'ABC', 'fn small');
    const row3 = [...layer[2]];
    const row3W = W - GB.margin * 2 - fnW * 2 - GB.gap * 2;
    const w3 = (row3W - GB.gap * (row3.length - 1)) / row3.length;
    row3.forEach((ch, i) => add(GB.margin + fnW + GB.gap + i * (w3 + GB.gap), 3, w3, ch, label(ch)));
    add(W - GB.margin - fnW, 3, fnW, 'delete', ICON.backspace, 'fn');

    let x = GB.margin;
    add(x, 4, fnW, 'layer', k.layer === 'letters' ? '?123' : 'ABC', 'fn small');
    x += fnW + GB.gap;
    const second = k.kind === 'email' ? '@' : ',';
    add(x, 4, keyW, second, second, 'fn');
    x += keyW + GB.gap;
    add(x, 4, keyW, 'emoji', GB_ICON.smile, 'white icon');
    x += keyW + GB.gap;
    const enterX = W - GB.margin - fnW;
    const dotX = enterX - GB.gap - keyW;
    add(x, 4, dotX - GB.gap - x, ' ', '<span class="gb-space">English</span>', 'white space');
    add(dotX, 4, keyW, '.', '.', 'fn');
    const search = k.enter === 'search';
    add(enterX, 4, fnW, 'enter', search ? ICON.search : ICON.returnKey, 'gb-enter');
    return keys.join('');
  }

  function gboard(c) {
    const { d } = c;
    const W = d.width;
    const layout = keyboardLayout(d, c.frame);
    const t = GB_THEME[c.dark ? 'dark' : 'light'];
    const vars = `--kb-panel:${t.panel};--kb-key:${t.key};--kb-fn:${t.fn};--kb-popup:${t.popup};--kb-pressed:${t.pressed};--kb-text:${t.text};--kb-icon:${t.icon};--kb-line:${t.line};--kb-shadow:${t.shadow};--gb-blue:${t.blue};--gb-blue-text:${t.blueText}`;
    const pad = ['phone', 'numeric', 'decimal'].includes(c.keyboard.kind);
    const tool = (x, icon) => `<span class="gb-tool" style="left:${x - 13}px">${icon}</span>`;
    const toolbar = `<div class="gb-toolbar">
        <span class="gb-tool gb-back" style="left:${25 - 15}px">${GB_ICON.back}</span>
        ${tool(79.7, GB_ICON.sticker)}<span class="gb-tool gb-gif" style="left:${138.7 - 16}px">GIF</span>
        ${tool(199, GB_ICON.clipboard)}${tool(259, GB_ICON.gear)}
        <span class="gb-divider" style="left:${(W * 295) / 412}px"></span>
        ${tool(W - 80.3, ICON.dots)}${tool(W - 20.5, ICON.mic)}
      </div>`;
    return `<div class="kb-layer" data-slide="${d.height - layout.pageBottom}" style="${vars}">
      <div class="kb gboard" style="top:${layout.top}px;height:${layout.height}px">
        ${toolbar}
        ${pad ? padKeys(c, c.keyboard, GB.rows[0] - PAD.rows[0]) : gboardKeys(c, c.keyboard)}
        <div class="gb-nav" style="height:${GB.nav}px;background:${t.nav}">
          <span class="ico" style="left:32px">${GB_ICON.hide}</span>
          <span class="gb-pill"></span>
          <span class="ico" style="right:32px">${GB_ICON.keyboards}</span>
        </div>
      </div>
    </div>`;
  }

  function keyboard(c) {
    const { d } = c;
    if (d.kind === 'android') return gboard(c);
    const layout = keyboardLayout(d, c.frame);
    const t = KB_THEME[c.dark ? 'dark' : 'light'];
    const vars = `--kb-panel:${t.panel};--kb-key:${t.key};--kb-fn:${t.fn};--kb-popup:${t.popup};--kb-pressed:${t.pressed};--kb-text:${t.text};--kb-suggest:${t.suggest};--kb-line:${t.line};--kb-shadow:${t.shadow};--kb-icon:${t.icon}`;
    const W = d.width;
    const suggestions = keyboardSuggestions(c.keyboard, W);
    const pad = ['phone', 'numeric', 'decimal'].includes(c.keyboard.kind);
    const bottomRow = d.safeBottom && !pad
      ? `<span class="kb-glyph" style="left:${42.4 - 13}px;top:${286.3 - 13}px">${ICON.emoji}</span>
         <span class="kb-glyph mic" style="left:${W - 43 - 15}px;top:${286.3 - 16}px">${ICON.mic}</span>`
      : '';
    // Everything slides together; the slide distance clears the browser bar too.
    return `<div class="kb-layer" data-slide="${d.height - layout.pageBottom}" style="${vars}">
      ${keyboardAccessory(c, layout)}
      <div class="kb" style="top:${layout.top}px;height:${layout.height}px">
        ${suggestions}
        ${keyboardKeys(c, c.keyboard)}
        ${bottomRow}
        ${d.safeBottom ? `<div class="home-indicator" style="background:${c.dark ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.85)'}"></div>` : ''}
      </div>
    </div>`;
  }

  const escape = (text) =>
    String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

  return {
    supportsKeyboard,
    keyboardLayout,
    render(context) {
      const c = { ...context, domain: escape(context.domain), time: escape(context.time), tabs: escape(context.tabs) };
      if (c.d.landscape && c.frame !== 'screen') return landscape(c);
      if (c.keyboard && supportsKeyboard(c.d, c.frame)) {
        const base = c.frame === 'screen' ? '' : { safari, firefox, 'chrome-ios': chromeIos, chrome }[c.frame](c);
        return base + keyboard(c);
      }
      if (c.frame === 'screen') return '';
      if (c.frame === 'safari') return safari(c);
      if (c.frame === 'firefox') return firefox(c);
      if (c.frame === 'chrome-ios') return chromeIos(c);
      if (c.frame === 'chrome') return chrome(c);
      return '';
    },
  };
})();
