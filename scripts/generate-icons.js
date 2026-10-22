#!/usr/bin/env node
/**
 * Render icons/icon.svg to the PNG sizes the listing and docs site use.
 *
 * Usage:
 *   node scripts/generate-icons.js
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..');
const SVG = fs.readFileSync(path.join(ROOT, 'icons', 'icon.svg'), 'utf8');
const OUT = {
  'icons/icon-16.png': 16,
  'icons/icon-32.png': 32,
  'icons/icon-48.png': 48,
  'icons/icon-96.png': 96,
  'icons/icon-128.png': 128,
  'store-assets/firefox/icon-128.png': 128,
  'docs/icon32.png': 32,
  'docs/icon192.png': 192,
};

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const [file, size] of Object.entries(OUT)) {
      await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
      await page.setContent(
        `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${SVG}`,
      );
      const out = path.join(ROOT, file);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
      console.log(`wrote ${file}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
