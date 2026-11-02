import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseReleaseVersion } from './release-policy.mjs';

function rcParts(tag) {
  try {
    if (!tag.startsWith('v')) return null;
    const parsed = parseReleaseVersion(tag.slice(1));
    if (parsed.kind !== 'rc') return null;
    return [parsed.major, parsed.minor, parsed.patch, Number(tag.split('-rc.')[1])];
  } catch {
    return null;
  }
}

export function olderRc(tag, currentTag) {
  const candidate = rcParts(tag);
  const current = rcParts(currentTag);
  if (!candidate || !current) return false;
  for (let i = 0; i < current.length; i++) {
    if (candidate[i] !== current[i]) return candidate[i] < current[i];
  }
  return false;
}

// Do not touch a tag belonging to a draft or a release not marked prerelease.
export function cleanupPlan(releases, refs, currentTag) {
  const byTag = new Map(releases.map(release => [release.tag_name, release]));
  const tags = refs.map(ref => ref.ref?.replace(/^refs\/tags\//, ''))
    .filter(tag => typeof tag === 'string' && olderRc(tag, currentTag))
    .filter(tag => !byTag.has(tag) || (byTag.get(tag).prerelease && !byTag.get(tag).draft));
  return { tags, releases: releases.filter(r => olderRc(r.tag_name, currentTag) && r.prerelease && !r.draft) };
}

function gh(...args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

function apiJson(path, paginated = false) {
  const data = JSON.parse(gh('api', ...(paginated ? ['--paginate', '--slurp'] : []), path));
  return paginated ? data.flat() : data;
}

function main() {
  const { GH_REPO: repo, RELEASE_VERSION: version, GITHUB_SHA: sha } = process.env;
  if (!repo || !version || !sha || !rcParts(`v${version}`)) throw new Error('Missing or invalid RC release context');
  const releases = apiJson(`repos/${repo}/releases?per_page=100`, true);
  const current = releases.find(r => r.tag_name === `v${version}` && r.prerelease && !r.draft);
  const preview = releases.find(r => r.tag_name === 'preview' && r.prerelease && !r.draft);
  const previewRef = apiJson(`repos/${repo}/git/ref/tags/preview`);
  const expected = readdirSync('artifacts');
  if (!current || !preview || previewRef.object?.sha !== sha || !expected.length ||
      expected.some(name => !preview.assets.some(asset => asset.name === name))) {
    throw new Error('Current RC or preview feed is incomplete; refusing cleanup');
  }
  const refs = apiJson(`repos/${repo}/git/matching-refs/tags/v`);
  const plan = cleanupPlan(releases, refs, `v${version}`);
  for (const release of plan.releases) {
    gh('api', '--method', 'DELETE', `repos/${repo}/releases/${release.id}`);
    console.log(`Deleted old RC release ${release.tag_name}`);
  }
  for (const tag of plan.tags) {
    gh('api', '--method', 'DELETE', `repos/${repo}/git/refs/tags/${encodeURIComponent(tag)}`);
    console.log(`Deleted old RC tag ${tag}`);
  }
  for (const asset of preview.assets.filter(asset => !expected.includes(asset.name))) {
    gh('api', '--method', 'DELETE', `repos/${repo}/releases/assets/${asset.id}`);
    console.log(`Deleted obsolete preview asset ${asset.name}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
