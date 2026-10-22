// Packs the extension into an .xpi (a zip, stored uncompressed) for the
// headless browser, without needing a zip tool on the machine.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = ['manifest.json', 'background.js', 'background-agent.js', 'content.js', 'shared.js', 'styles.js', 'touch.js', 'icons', 'sidebar', 'options'];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function walk(rel) {
  const full = path.join(ROOT, rel);
  if (fs.statSync(full).isDirectory()) return fs.readdirSync(full).filter((f) => !f.startsWith('.')).flatMap((f) => walk(path.join(rel, f)));
  return [rel];
}

function buildXpi(outFile) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const rel of FILES.flatMap(walk)) {
    const data = fs.readFileSync(path.join(ROOT, rel));
    const name = Buffer.from(rel.split(path.sep).join('/'));
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4); // version needed
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(10, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(outFile, Buffer.concat([...locals, dir, end]));
  return outFile;
}

module.exports = { buildXpi, FILES };
