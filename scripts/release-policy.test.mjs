import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertReleaseChannel, parseReleaseVersion, rcTimestamp, releaseChannel, resolveReleaseVersion } from './release-policy.mjs';

const now = new Date('2026-11-02T16:05:00Z');

test('RC timestamps use Shanghai date and minute across the UTC date boundary', () => {
  assert.equal(rcTimestamp(now), '202611030005');
  assert.equal(rcTimestamp(new Date('2026-01-01T00:00:00Z')), '202601010800');
  assert.throws(() => rcTimestamp(new Date('invalid')), /Invalid release timestamp/);
});

test('RC follows the current candidate base or increments stable with decimal carry', () => {
  assert.equal(resolveReleaseVersion('0.2.0-rc.3', 'rc', now), '0.2.0-rc.202611030005');
  assert.equal(resolveReleaseVersion('0.2.0', 'rc', now), '0.2.1-rc.202611030005');
  assert.equal(resolveReleaseVersion('1.1.9', 'rc', now), '1.2.0-rc.202611030005');
  assert.equal(resolveReleaseVersion('1.9.9', 'rc', now), '2.0.0-rc.202611030005');
  assert.equal(resolveReleaseVersion('1.2.3-rc.202601010800', 'stable'), '1.2.3');
  assert.equal(resolveReleaseVersion('1.2.3', 'stable'), '1.2.3');
});

test('explicit RC and stable versions remain supported without beta or malformed variants', () => {
  assert.equal(resolveReleaseVersion('0.2.0-rc.3', '0.3.0'), '0.3.0');
  assert.equal(resolveReleaseVersion('0.2.0-rc.3', '0.3.0-rc.4'), '0.3.0-rc.4');
  for (const value of [undefined, '', 'beta', 'alpha', '1.2.3\n', ' 1.2.3', 'v1.2.3', '01.2.3', '1.02.3', '1.2.03', '1.2.3-beta.1',
    '1.2.3-alpha.1', '1.2.3-preview.1', '1.2.3-rc', '1.2.3-rc.0', '1.2.3-rc.01',
    '1.2.3-rc.1.2', '1.2.3-rc.-1', '1.2.3+meta', '1.2.3-rc.9007199254740992', '9007199254740992.0.0']) {
    assert.throws(() => parseReleaseVersion(value), /Unsupported release version/, String(value));
    assert.throws(() => resolveReleaseVersion('0.2.0-rc.3', value), /Unsupported release version/, String(value));
  }
});

test('only RC maps to the compatibility preview channel and stable maps to stable', () => {
  assert.equal(releaseChannel('0.2.0-rc.3'), 'preview');
  assert.equal(releaseChannel('0.2.0-rc.202611030005'), 'preview');
  assert.equal(releaseChannel('0.2.0'), 'stable');
  assertReleaseChannel('0.2.0-rc.3', 'preview');
  assertReleaseChannel('0.2.0', 'stable');
  assert.throws(() => assertReleaseChannel('0.2.0-rc.3', 'stable'), /channel mismatch/);
  assert.throws(() => assertReleaseChannel('0.2.0', 'preview'), /channel mismatch/);
  assert.throws(() => assertReleaseChannel('0.2.0', 'rc'), /channel mismatch/);
});
