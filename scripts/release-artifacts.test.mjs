import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildManifest, manifestFromEnvironment, platformSpec, validateArtifacts } from './release-artifacts.mjs';

const release = { owner: 'coderDJing', repo: 'workbuddy-switch-next', version: '0.2.0-rc.1', channel: 'preview' };
test('RC manifests pin immutable signed archives and safely encode filenames', () => {
  const data = buildManifest({ release, archiveName: 'WorkBuddy Switch Next_0.2.0-rc.1_x64-setup.exe', signature: 'fixture\n', keys: ['windows-x86_64-nsis'] });
  assert.equal(data.version, release.version);
  assert.equal(data.platforms['windows-x86_64-nsis'].signature, 'fixture');
  assert.equal(data.platforms['windows-x86_64-nsis'].url,
    'https://github.com/coderDJing/workbuddy-switch-next/releases/download/v0.2.0-rc.1/WorkBuddy%20Switch%20Next_0.2.0-rc.1_x64-setup.exe');
  assert.throws(() => buildManifest({ release, archiveName: '../other.exe', signature: 'x', keys: ['win'] }));
});
test('Linux deb and AppImage updater keys cannot replace one another', () => {
  assert.deepEqual(platformSpec('linux', 'x86_64', 'deb').keys, ['linux-x86_64-deb']);
  assert.deepEqual(platformSpec('linux', 'x86_64', 'appimage').keys, ['linux-x86_64-appimage', 'linux-x86_64']);
  assert.throws(() => platformSpec('linux', 'x86_64', 'other'));
});

test('artifact entry points reject unsupported versions and channel mismatches before filesystem work', () => {
  const input = { archiveName: 'installer.exe', signature: 'fixture', keys: ['windows-x86_64'] };
  for (const version of ['0.2.0-beta.1', '0.2.0-alpha.1', '0.2.0-rc.0', '00.2.0', '0.2.0-rc.01']) {
    const invalid = { ...release, version };
    assert.throws(() => buildManifest({ ...input, release: invalid }), /Unsupported release version/);
    assert.throws(() => manifestFromEnvironment({ BUNDLE_DIR: 'unused', UPDATE_VERSION: version }, release), /Unsupported release version/);
    assert.throws(() => validateArtifacts('unused', invalid), /Unsupported release version/);
  }
  assert.throws(() => buildManifest({ ...input, release: { ...release, channel: 'stable' } }), /channel mismatch/);
  const stable = buildManifest({ ...input, release: { ...release, version: '0.2.0', channel: 'stable' } });
  assert.equal(stable.version, '0.2.0');
  assert.match(stable.platforms['windows-x86_64'].url, /\/v0\.2\.0\/installer\.exe$/);
});
test('manifest generation rejects unsigned or ambiguous Windows installers', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-next-manifest-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const archive = path.join(folder, 'WorkBuddy Switch Next_0.2.0-rc.1_x64-setup.exe');
  fs.writeFileSync(archive, 'isolated installer fixture');
  const env = { BUNDLE_DIR: folder, UPDATE_OS: 'windows', UPDATE_ARCH: 'x86_64' };
  assert.throws(() => manifestFromEnvironment(env, release), /Missing updater signature/);
  fs.writeFileSync(archive + '.sig', 'signature fixture');
  const file = manifestFromEnvironment(env, release);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(data.platforms), ['windows-x86_64-nsis', 'windows-x86_64']);
  fs.writeFileSync(path.join(folder, 'other_0.2.0-rc.1_x64-setup.exe'), 'other installer');
  assert.throws(() => manifestFromEnvironment(env, release), /found 2/);
});

test('publication rejects mismatched versions, missing archives and substituted signatures', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-next-validate-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const name = 'next-windows-setup.exe';
  fs.writeFileSync(path.join(folder, name), 'installer fixture');
  fs.writeFileSync(path.join(folder, name + '.sig'), 'signature fixture');
  const data = buildManifest({ release, archiveName: name, signature: 'signature fixture', keys: ['windows-x86_64'] });
  const manifest = path.join(folder, 'latest.json');
  fs.writeFileSync(manifest, JSON.stringify(data));
  assert.equal(validateArtifacts(folder, release), 1);
  data.version = '0.2.0-rc.2'; fs.writeFileSync(manifest, JSON.stringify(data));
  assert.throws(() => validateArtifacts(folder, release), /Version mismatch/);
  data.version = release.version; data.platforms['windows-x86_64'].signature = 'other';
  fs.writeFileSync(manifest, JSON.stringify(data));
  assert.throws(() => validateArtifacts(folder, release), /Signature mismatch/);
});
