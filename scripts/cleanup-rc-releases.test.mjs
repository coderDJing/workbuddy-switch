import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanupPlan, olderRc } from './cleanup-rc-releases.mjs';

test('only older versioned RCs qualify', () => {
  const current = 'v0.2.0-rc.202611020103';
  for (const tag of ['v0.2.0-rc.3', 'v0.1.9-rc.202611020104']) assert.equal(olderRc(tag, current), true);
  for (const tag of [current, 'v0.2.0-rc.202611020104', 'v0.3.0-rc.1', 'v0.1.9', 'preview', 'v0.2.0-beta.1', 'v0.2.0-rc.01']) assert.equal(olderRc(tag, current), false);
});

test('cleanup includes orphaned RC tags but protects drafts and non-prereleases', () => {
  const releases = [
    { tag_name: 'v0.2.0-rc.1', prerelease: true, draft: false },
    { tag_name: 'v0.2.0-rc.2', prerelease: true, draft: true },
    { tag_name: 'v0.2.0-rc.3', prerelease: false, draft: false },
    { tag_name: 'preview', prerelease: true, draft: false },
    { tag_name: 'v0.1.9-rc.1', prerelease: true, draft: false },
  ];
  const refs = ['v0.2.0-rc.1', 'v0.2.0-rc.2', 'v0.2.0-rc.3', 'v0.2.0-rc.4', 'v0.2.0-rc.5', 'v0.2.0'].map(tag => ({ ref: `refs/tags/${tag}` }));
  const plan = cleanupPlan(releases, refs, 'v0.2.0-rc.5');
  assert.deepEqual(plan.tags, ['v0.2.0-rc.1', 'v0.2.0-rc.4']);
  assert.deepEqual(plan.releases.map(r => r.tag_name), ['v0.2.0-rc.1', 'v0.1.9-rc.1']);
});
