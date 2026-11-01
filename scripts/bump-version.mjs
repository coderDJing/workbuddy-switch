import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version || '')) {
  throw new Error('Usage: node scripts/bump-version.mjs <semver>');
}
const editJson = (relative, edit) => {
  const file = path.join(root, relative);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  edit(data);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
};
editJson('release-config.json', data => {
  data.version = version;
  data.channel = version.includes('-') ? 'preview' : 'stable';
});
const release = JSON.parse(fs.readFileSync(path.join(root, 'release-config.json'), 'utf8'));
editJson('package.json', data => { data.name = release.slug; data.version = version; });
editJson('package-lock.json', data => {
  data.name = release.slug; data.version = version;
  data.packages[''].name = release.slug; data.packages[''].version = version;
});
editJson('src-tauri/tauri.conf.json', data => {
  data.version = version; data.productName = release.productName; data.identifier = release.identifier;
  const base = `https://github.com/${release.owner}/${release.repo}/releases/`;
  const download = release.channel === 'preview' ? `download/${release.previewTag}` : 'latest/download';
  data.plugins.updater.endpoints = ['latest.json', 'latest-{{target}}-{{arch}}.json']
    .map(name => `${base}${download}/${name}`);
});
editJson('npm/package.json', data => {
  data.version = version;
  for (const name of Object.keys(data.optionalDependencies)) data.optionalDependencies[name] = version;
});
for (const entry of fs.readdirSync(path.join(root, 'npm/platform'))) {
  const relative = `npm/platform/${entry}/package.json`;
  if (fs.existsSync(path.join(root, relative))) editJson(relative, data => { data.version = version; });
}
for (const relative of ['crates/wb-switch-core/Cargo.toml', 'crates/wb-switch-server/Cargo.toml', 'src-tauri/Cargo.toml']) {
  const file = path.join(root, relative);
  const text = fs.readFileSync(file, 'utf8').replace(/^version = "[^"]+"/m, `version = "${version}"`);
  fs.writeFileSync(file, text);
}
const updateFile = path.join(root, 'crates/wb-switch-core/src/modules/update.rs');
fs.writeFileSync(updateFile, fs.readFileSync(updateFile, 'utf8')
  .replace(/pub const UPDATE_CHANNEL: &str = "[^"]+";/, `pub const UPDATE_CHANNEL: &str = "${release.channel}";`));
console.log(`Synchronized Next version ${version} (${release.channel}); run cargo check to refresh Cargo.lock.`);
