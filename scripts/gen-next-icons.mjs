// Export the approved Next artwork into web, desktop and tray assets.
// Usage: node scripts/gen-next-icons.mjs (requires the existing Tauri CLI).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artwork = path.join(root, 'docs/assets/branding/workbuddy-switch-next-icon-beret-v1.png');
const cutout = path.join(root, 'docs/assets/branding/workbuddy-switch-next-icon-beret-transparent.png');
const icons = path.join(root, 'src-tauri/icons');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-switch-next-icons-'));
const cli = path.join(root, 'node_modules/@tauri-apps/cli/tauri.js');

function exportIcons(input, output, sizes = []) {
  execFileSync(process.execPath, [cli, 'icon', input, '-o', output,
    ...sizes.flatMap(size => ['-p', String(size)])], { cwd: root, stdio: 'pipe' });
}

// PNG RGBA conversion for native tray byte arrays. Platform resizing is handled
// by Tauri, keeping this exporter dependency-free and identical on all hosts.
function readPng(file) {
  const data = fs.readFileSync(file);
  const idat = [];
  let width, height, channels;
  for (let offset = 8; offset < data.length;) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4);
      if (chunk[8] !== 8 || ![2, 6].includes(chunk[9]) || chunk[12] !== 0) {
        throw new Error('Expected non-interlaced RGB/RGBA 8-bit PNG');
      }
      channels = chunk[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(chunk);
    offset += length + 12;
  }
  const packed = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = Buffer.alloc(height * stride);
  const rgba = Buffer.alloc(width * height * 4);
  let at = 0;
  for (let y = 0; y < height; y++) {
    const filter = packed[at++];
    if (filter > 4) throw new Error('Invalid PNG filter');
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x;
      const a = x >= channels ? rows[index - channels] : 0;
      const b = y ? rows[index - stride] : 0;
      const c = y && x >= channels ? rows[index - stride - channels] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const prediction = filter === 1 ? a : filter === 2 ? b : filter === 3
        ? Math.floor((a + b) / 2) : filter === 4
          ? pa <= pb && pa <= pc ? a : pb <= pc ? b : c : 0;
      rows[index] = (packed[at++] + prediction) & 255;
    }
    for (let x = 0; x < width; x++) {
      const source = y * stride + x * channels;
      const target = (y * width + x) * 4;
      rows.copy(rgba, target, source, source + 3);
      rgba[target + 3] = channels === 4 ? rows[source + 3] : 255;
    }
  }
  return { width, height, rgba };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writePng(file, { width, height, rgba }) {
  const chunk = (type, data) => {
    const bytes = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(bytes));
    return Buffer.concat([length, bytes, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  fs.writeFileSync(file, Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
}

// Remove detached alpha speckles from the extracted background while retaining
// the connected mascot and its one-pixel antialiased edge. RGB artwork is kept.
function retainMascot(image) {
  const { width, height, rgba } = image;
  const count = width * height, seen = new Uint8Array(count);
  const queue = new Int32Array(count);
  let largest = [];
  for (let start = 0; start < count; start++) {
    if (seen[start] || rgba[start * 4 + 3] < 96) continue;
    let head = 0, tail = 1; queue[0] = start; seen[start] = 1;
    while (head < tail) {
      const pixel = queue[head++], x = pixel % width;
      for (const next of [x ? pixel - 1 : -1, x < width - 1 ? pixel + 1 : -1,
        pixel >= width ? pixel - width : -1, pixel + width < count ? pixel + width : -1]) {
        if (next < 0 || seen[next] || rgba[next * 4 + 3] < 96) continue;
        seen[next] = 1; queue[tail++] = next;
      }
    }
    if (tail > largest.length) largest = Array.from(queue.subarray(0, tail));
  }
  if (largest.length < count / 4) throw new Error('Missing mascot alpha component');
  const keep = new Uint8Array(count);
  for (const pixel of largest) {
    const x = pixel % width, y = Math.floor(pixel / width);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height) {
        keep[(y + dy) * width + x + dx] = 1;
      }
    }
  }
  for (let pixel = 0; pixel < count; pixel++) if (!keep[pixel]) rgba.fill(0, pixel * 4, pixel * 4 + 4);
  return image;
}

try {
  const square = path.join(scratch, 'square');
  exportIcons(artwork, square);
  fs.cpSync(square, icons, { recursive: true });
  fs.copyFileSync(path.join(icons, 'icon.png'), path.join(root, 'public/icon.png'));
  const extra = path.join(scratch, 'extra');
  exportIcons(artwork, extra, [64]);
  fs.copyFileSync(path.join(extra, '64x64.png'), path.join(icons, '64x64.png'));

  // Windows displays the supplied bitmap directly, so bake its rounded corners.
  const windowsSvg = path.join(scratch, 'windows.svg');
  fs.writeFileSync(windowsSvg, `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs><clipPath id="round"><rect width="512" height="512" rx="114.5"/></clipPath></defs><image width="512" height="512" clip-path="url(#round)" href="data:image/png;base64,${fs.readFileSync(artwork).toString('base64')}"/></svg>`);
  const windows = path.join(scratch, 'windows');
  exportIcons(windowsSvg, windows);
  for (const name of fs.readdirSync(windows)) {
    if (name === 'icon.ico' || /^(Square.*Logo|StoreLogo)\.png$/.test(name)) {
      fs.copyFileSync(path.join(windows, name), path.join(icons, name));
    }
  }
  fs.copyFileSync(path.join(windows, 'icon.png'), path.join(icons, 'icon-windows.png'));

  const extracted = path.join(scratch, 'extracted');
  exportIcons(cutout, extracted, [512]);
  const mascot = retainMascot(readPng(path.join(extracted, '512x512.png')));
  const transparent = path.join(root, 'public/icon-transparent.png');
  writePng(transparent, mascot);
  const color = path.join(scratch, 'color');
  exportIcons(transparent, color, [32]);
  const tray = readPng(path.join(color, '32x32.png'));
  fs.writeFileSync(path.join(icons, 'tray-icon-color.rgba'), tray.rgba);

  // Monochrome tray artwork: use negative space for the face and the cap's N.
  const mono = { ...mascot, rgba: Buffer.from(mascot.rgba) };
  for (let y = 0; y < mono.height; y++) for (let x = 0; x < mono.width; x++) {
    const i = (y * mono.width + x) * 4;
    const r = mono.rgba[i], g = mono.rgba[i + 1], b = mono.rgba[i + 2];
    const eyeOrMouth = y > mono.height * .37 && y < mono.height * .59
      && x > mono.width * .33 && x < mono.width * .83 && b > g * 1.15 && b > r * 1.15;
    const letterN = y < mono.height * .29 && x > mono.width * .3 && x < mono.width * .65
      && r > 210 && g > 205 && b > 185;
    if (eyeOrMouth || letterN) mono.rgba[i + 3] = 0;
    mono.rgba.fill(255, i, i + 3);
  }
  const monoSource = path.join(scratch, 'mono.png');
  writePng(monoSource, mono);
  const monoOutput = path.join(scratch, 'mono');
  exportIcons(monoSource, monoOutput, [32, 36]);
  fs.copyFileSync(path.join(monoOutput, '36x36.png'), path.join(icons, 'tray-icon-template.png'));
  fs.writeFileSync(path.join(icons, 'tray-icon-template.rgba'), readPng(path.join(monoOutput, '36x36.png')).rgba);
  for (const [name, rgb] of [['black', [17, 17, 19]], ['white', [255, 255, 255]]]) {
    const image = readPng(path.join(monoOutput, '32x32.png'));
    for (let i = 0; i < image.rgba.length; i += 4) image.rgba.set(rgb, i);
    fs.writeFileSync(path.join(icons, `tray-icon-mono-${name}.rgba`), image.rgba);
  }
  console.log('Exported approved Next artwork: web PNG, desktop ICO/ICNS/PNG, mobile assets and 32/36px native tray variants.');
} finally {
  // Delete only this invocation's freshly created, resolved temporary folder.
  const resolved = fs.realpathSync(scratch);
  if (path.dirname(resolved) !== fs.realpathSync(os.tmpdir())
      || !path.basename(resolved).startsWith('wb-switch-next-icons-')) throw new Error('Unsafe scratch path');
  fs.rmSync(resolved, { recursive: true });
}
