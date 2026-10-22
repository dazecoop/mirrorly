#!/usr/bin/env node
// Mirrorly command line: screenshot a page in a phone, or run the MCP server.
//
//   mirrorly screenshot <url> [options]
//   mirrorly devices
//   mirrorly status
//   mirrorly mcp
//   mirrorly install [app] [--local]  ·  mirrorly uninstall [app]

const { Phone, VIA_LABEL } = require('./phone');
const { DEVICES, browsersFor } = require('./devices');
const installer = require('./install');
const { DEFAULT_PORT } = require('./bridge');

const HELP = `Mirrorly — see a web page as a real phone shows it, for AI agents and scripts.

Usage:
  mirrorly screenshot <url> [options]   Open a page in a phone and save a PNG
    --device <id>                       iphone-16-pro (default), iphone-se, pixel, … (see devices)
    --browser safari|chrome|firefox|none
    --appearance light|dark
    --landscape
    --mode frame|screen|full            frame (default): with the phone and its bars;
                                        screen: the page in view; full: the whole page
    --resolution css|device             css (default) or the phone's pixel ratio
    --scroll <selector|px|bottom>       scroll before the screenshot
    --out <file.png>                    where to save it (default: a temp folder)
    --via auto|browser|headless         auto (default): your Firefox via the extension
                                        if its AI agents switch is on, otherwise headless
  mirrorly devices                      The devices and browsers Mirrorly can draw
  mirrorly status                       Which agent apps have Mirrorly; is Firefox connected?
  mirrorly mcp                          Run as an MCP server over stdio

  mirrorly install [app] [--local]      Add Mirrorly to every agent app on this computer
                                        (or one: claude-code, claude-desktop, cursor,
                                        vscode, or claude for both Claude apps), install
                                        the Claude Code skill, and check it starts
  mirrorly uninstall [app]              Remove it again (everywhere by default)
      --local: run this checkout instead of the GitHub copy

Environment:
  MIRRORLY_PORT     bridge port (default ${DEFAULT_PORT})
  MIRRORLY_FIREFOX  Firefox binary for headless runs
`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      out[k] = v !== undefined ? v : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    } else out._.push(a);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (cmd === 'mcp') {
    require('./mcp').serve();
    return; // stays running
  }

  if (cmd === 'screenshot') {
    const url = args._[1];
    if (!url) throw new Error('Usage: mirrorly screenshot <url> [options]');
    const phone = new Phone({ log: (m) => console.error(m) });
    try {
      const page = await phone.open({
        url, device: args.device, browser: args.browser, appearance: args.appearance, landscape: Boolean(args.landscape), via: args.via || 'auto',
      });
      console.error(`Opened ${page.url} on ${page.device} in ${page.browser}, via ${VIA_LABEL[page.via]}.`);
      if (args.scroll !== undefined) {
        const s = String(args.scroll);
        const how = /^(top|bottom)$/.test(s) ? { position: s } : /^-?\d+$/.test(s) ? { y: Number(s) } : { selector: s };
        const r = await phone.scroll(how);
        if (how.selector && !r.found) console.error(`No visible element matches ${s}.`);
      }
      const shot = await phone.screenshot({ mode: args.mode, resolution: args.resolution, savePath: args.out });
      console.log(shot.file);
      console.error(`${shot.width}×${shot.height} PNG`);
    } finally {
      await phone.close();
    }
    return;
  }

  if (cmd === 'devices') {
    for (const d of DEVICES) {
      console.log(`${d.id.padEnd(18)} ${d.label}${d.id === 'custom' ? '' : ` (${d.width}×${d.height} @${d.dpr}x)`} — ${browsersFor(d.id).join(', ')}`);
    }
    return;
  }

  if (cmd === 'install' || cmd === 'uninstall') {
    const done = cmd === 'install' ? await installer.install(args._[1], { local: Boolean(args.local) }) : await installer.uninstall(args._[1]);
    if (!done) process.exitCode = 1;
    return;
  }

  if (cmd === 'status') {
    console.log('Agent apps:');
    (await installer.checkAll()).forEach((l) => console.log(`  ${l}`));
    console.log('');
    const phone = new Phone();
    try {
      const s = await phone.status();
      if (s.extension) console.log(`Firefox connected: Mirrorly ${s.extension.version || ''} in ${s.extension.browser || 'Firefox'}.`);
      else {
        console.log('Firefox not connected: pages will open in headless Firefox.');
        console.log('Turn on "Let AI agents use Mirrorly" in Mirrorly\'s settings to use your own Firefox.');
      }
    } finally {
      await phone.close();
    }
    return;
  }

  process.stdout.write(HELP);
  if (cmd && cmd !== 'help' && cmd !== '--help') process.exitCode = 1;
}

main()
  .then(() => {
    if (process.argv[2] !== 'mcp') process.exit(process.exitCode || 0);
  })
  .catch((err) => {
    console.error(`mirrorly: ${err.message}`);
    process.exit(1);
  });
