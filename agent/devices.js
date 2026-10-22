// The extension's device list and helpers (shared.js), loaded into Node so
// the agent tools check devices and browsers against the same data.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = {};
vm.createContext(context);
vm.runInContext(`${fs.readFileSync(path.join(__dirname, '..', 'shared.js'), 'utf8')}\nthis.Mirrorly = Mirrorly;`, context);
const { Mirrorly } = context;

// Devices an agent can pick: everything but "Fit sidebar".
const DEVICES = Mirrorly.DEVICES.filter((d) => d.kind !== 'fit');

// The browser names agents use, to the extension's frame ids for a device.
function frameFor(device, browser = 'safari') {
  const kind = DEVICES.find((d) => d.id === device)?.kind;
  const allowed = Mirrorly.FRAMES_BY_KIND[kind] || [];
  const id = { safari: 'safari', chrome: kind === 'android' ? 'chrome' : 'chrome-ios', firefox: 'firefox', none: 'screen' }[browser];
  return allowed.includes(id) ? id : null;
}

function browsersFor(device) {
  const kind = DEVICES.find((d) => d.id === device)?.kind;
  return (Mirrorly.FRAMES_BY_KIND[kind] || []).map((f) => ({ safari: 'safari', 'chrome-ios': 'chrome', chrome: 'chrome', firefox: 'firefox', screen: 'none' })[f]);
}

module.exports = { Mirrorly, DEVICES, frameFor, browsersFor };
