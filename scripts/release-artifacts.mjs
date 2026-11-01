import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const readRelease = () => JSON.parse(fs.readFileSync(path.join(root, 'release-config.json'), 'utf8'));

export function buildManifest({ release, archiveName, signature, keys, date = new Date().toISOString() }) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release.version)) throw new Error('Invalid release version');
  if (!archiveName || archiveName !== path.basename(archiveName) || /[\\/]/.test(archiveName)) throw new Error('Invalid archive name');
  if (!signature.trim() || !keys.length) throw new Error('Missing signature or platform keys');
  const url = `https://github.com/${release.owner}/${release.repo}/releases/download/v${release.version}/${encodeURIComponent(archiveName)}`;
  return { version: release.version, notes: '', pub_date: date,
    platforms: Object.fromEntries(keys.map(key => [key, { signature: signature.trim(), url }])) };
}

export function platformSpec(os, arch, bundle = '') {
  if (!['aarch64', 'x86_64'].includes(arch)) throw new Error(`Unsupported architecture: ${arch}`);
  if (os === 'macos') return { folder: 'macos', extension: '.app.tar.gz', keys: [`darwin-${arch}`], json: `latest-macos-${arch}.json` };
  if (os === 'windows') return { folder: 'nsis', extension: '-setup.exe', keys: [`windows-${arch}-nsis`, `windows-${arch}`], json: `latest-windows-${arch}.json` };
  if (os === 'linux' && (!bundle || bundle === 'appimage')) return { folder: 'appimage', extension: '.AppImage', keys: [`linux-${arch}-appimage`, `linux-${arch}`], json: `latest-linux-${arch}.json` };
  if (os === 'linux' && bundle === 'deb') return { folder: 'deb', extension: '.deb', keys: [`linux-${arch}-deb`], json: `latest-linux-deb-${arch}.json` };
  throw new Error(`Unsupported platform: ${os}/${bundle}`);
}

function singleArchive(folder, spec, version) {
  const files = fs.readdirSync(folder).filter(name => name.endsWith(spec.extension)
    && (spec.folder !== 'nsis' || name.endsWith(`_${version}_x64-setup.exe`)));
  if (files.length !== 1) throw new Error(`Expected one ${spec.extension} archive in ${folder}, found ${files.length}`);
  const archive = path.join(folder, files[0]);
  if (!fs.existsSync(archive + '.sig')) throw new Error(`Missing updater signature: ${path.basename(archive)}`);
  return archive;
}

export function manifestFromEnvironment(env = process.env, config = readRelease()) {
  const release = { ...config, version: env.UPDATE_VERSION || config.version };
  const os = env.UPDATE_OS || 'macos', arch = env.UPDATE_ARCH || 'aarch64';
  const spec = platformSpec(os, arch, env.UPDATE_BUNDLE);
  const folder = path.resolve(root, env.BUNDLE_DIR || `target/release/bundle/${spec.folder}`);
  const archive = singleArchive(folder, spec, release.version);
  const data = buildManifest({ release, archiveName: env.UPDATE_ARCHIVE_NAME || path.basename(archive),
    signature: fs.readFileSync(archive + '.sig', 'utf8'), keys: env.UPDATE_KEYS?.split(/\s+/).filter(Boolean) || spec.keys });
  const jsonName = env.UPDATE_JSON_NAME || spec.json;
  if (path.basename(jsonName) !== jsonName) throw new Error('Manifest filename must not escape the bundle folder');
  const output = path.join(folder, jsonName);
  fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
  return output;
}

function bundleRoot(target) {
  if (!/^[a-z0-9_-]+$/.test(target)) throw new Error('Invalid Rust target');
  const targetRoot = path.resolve(root, 'target');
  const bundle = path.resolve(targetRoot, target, 'release/bundle');
  if (!bundle.startsWith(targetRoot + path.sep) || path.basename(bundle) !== 'bundle') throw new Error('Unsafe bundle path');
  return bundle;
}

function collect(env = process.env) {
  const release = readRelease(), target = env.RUST_TARGET, platform = env.PLATFORM_TAG;
  if (!platform || !/^[a-z0-9-]+$/.test(platform)) throw new Error('Missing platform tag');
  const bundle = bundleRoot(target), destination = path.join(root, 'dist-bin');
  fs.mkdirSync(destination, { recursive: true });
  const suffix = platform.startsWith('win32') ? '.exe' : '';
  const binary = path.join(root, 'target', target, 'release', `wb-switch${suffix}`);
  fs.copyFileSync(binary, path.join(destination, `${release.slug}-cli-${platform}${suffix}`));
  const pkgBin = path.join(root, 'npm/platform', `${release.slug}-${platform}`, 'bin');
  fs.mkdirSync(pkgBin, { recursive: true });
  fs.copyFileSync(binary, path.join(pkgBin, `wb-switch-${platform}${suffix}`));
  if (env.PUBLISH_APP === 'false') return;
  const os = env.UPDATE_OS, arch = env.UPDATE_ARCH;
  const variants = os === 'linux' ? ['appimage', 'deb'] : [''];
  for (const variant of variants) {
    const spec = platformSpec(os, arch, variant);
    const source = singleArchive(path.join(bundle, spec.folder), spec, release.version);
    const extension = spec.extension;
    const archiveName = `${release.slug}-${os}-${arch}${extension}`;
    fs.copyFileSync(source, path.join(destination, archiveName));
    fs.copyFileSync(source + '.sig', path.join(destination, archiveName + '.sig'));
    const data = buildManifest({ release, archiveName, signature: fs.readFileSync(source + '.sig', 'utf8'), keys: spec.keys });
    fs.writeFileSync(path.join(destination, spec.json), JSON.stringify(data, null, 2) + '\n');
  }
  if (os === 'macos') {
    fs.copyFileSync(path.join(root, `${release.slug}_${release.version}_${arch}.dmg`),
      path.join(destination, `${release.slug}-${os}-${arch}.dmg`));
  }
}

export function checksumDirectory(folder) {
  const lines = fs.readdirSync(folder).filter(name => name !== 'SHA256SUMS' && fs.statSync(path.join(folder, name)).isFile())
    .sort().map(name => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(folder, name))).digest('hex')}  ${name}`);
  fs.writeFileSync(path.join(folder, 'SHA256SUMS'), lines.join('\n') + '\n');
}

export function validateArtifacts(folder, release = readRelease()) {
  const manifests = fs.readdirSync(folder).filter(name => /^latest.*\.json$/.test(name));
  if (!manifests.includes('latest.json')) throw new Error('Missing merged updater manifest');
  const prefix = `https://github.com/${release.owner}/${release.repo}/releases/download/v${release.version}/`;
  for (const name of manifests) {
    const data = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
    if (data.version !== release.version) throw new Error(`Version mismatch in ${name}`);
    if (!data.platforms || !Object.keys(data.platforms).length) throw new Error(`Empty platforms: ${name}`);
    for (const [key, entry] of Object.entries(data.platforms)) {
      if (!entry.url?.startsWith(prefix)) throw new Error(`Unexpected update source for ${key}`);
      const filename = decodeURIComponent(entry.url.slice(prefix.length));
      if (filename !== path.basename(filename) || /[\\/]/.test(filename)) throw new Error('Unsafe update archive path');
      const archive = path.join(folder, filename);
      if (!fs.statSync(archive).isFile()) throw new Error(`Missing update archive: ${filename}`);
      if (fs.readFileSync(archive + '.sig', 'utf8').trim() !== entry.signature) throw new Error(`Signature mismatch for ${key}`);
    }
  }
  return manifests.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === 'manifest') {
    const release = readRelease();
    if (process.argv[3]) release.owner = process.argv[3];
    if (process.argv[4]) release.repo = process.argv[4];
    console.log(manifestFromEnvironment(process.env, release));
  } else if (command === 'clean') {
    // Native filesystem deletion only, bounded to this target's bundle folder.
    const folder = bundleRoot(process.env.RUST_TARGET);
    fs.rmSync(folder, { recursive: true, force: true });
  } else if (command === 'collect') collect();
  else if (command === 'validate') console.log(`Validated ${validateArtifacts(path.resolve(process.argv[3] || 'dist-bin'))} updater manifests.`);
  else if (command === 'checksums') checksumDirectory(path.resolve(process.argv[3] || 'dist-bin'));
  else throw new Error('Usage: release-artifacts.mjs manifest|clean|collect|checksums');
}
