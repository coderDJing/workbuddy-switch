// Public releases are RC or stable. `preview` remains the internal updater
// channel/feed alias so already installed preview clients keep receiving RCs.
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.([1-9]\d*))?$/;

export function parseReleaseVersion(version) {
  const match = typeof version === 'string' && VERSION.exec(version);
  if (!match || match[0] !== version || match.slice(1).some(part => part !== undefined && !Number.isSafeInteger(Number(part)))) {
    throw new Error(`Unsupported release version: ${version}; use X.Y.Z or X.Y.Z-rc.N (positive numeric N).`);
  }
  const [, major, minor, patch, rc] = match;
  return {
    version, base: `${major}.${minor}.${patch}`,
    major: Number(major), minor: Number(minor), patch: Number(patch),
    kind: rc === undefined ? 'stable' : 'rc',
    channel: rc === undefined ? 'stable' : 'preview',
  };
}

export function releaseChannel(version) {
  return parseReleaseVersion(version).channel;
}

export function assertReleaseChannel(version, channel) {
  const expected = releaseChannel(version);
  if (channel !== expected) {
    throw new Error(`Release channel mismatch: ${version} requires ${expected}, received ${channel}.`);
  }
}

export function rcTimestamp(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error('Invalid release timestamp');
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = name => parts.find(value => value.type === name)?.value;
  const timestamp = ['year', 'month', 'day', 'hour', 'minute'].map(part).join('');
  if (!/^\d{12}$/.test(timestamp)) throw new Error('Release timestamp must have format YYYYMMDDHHmm');
  return timestamp;
}

function incrementPatch({ major, minor, patch }) {
  // The project's decimal carry policy: 1.1.9 -> 1.2.0, 1.9.9 -> 2.0.0.
  const next = BigInt(major) * 100n + BigInt(minor) * 10n + BigInt(patch) + 1n;
  return `${next / 100n}.${next / 10n % 10n}.${next % 10n}`;
}

export function resolveReleaseVersion(currentVersion, requested, date = new Date()) {
  if (requested !== 'rc' && requested !== 'stable') return parseReleaseVersion(requested).version;
  const current = parseReleaseVersion(currentVersion);
  if (requested === 'stable') return current.base;
  const base = current.kind === 'rc' ? current.base : incrementPatch(current);
  return parseReleaseVersion(`${base}-rc.${rcTimestamp(date)}`).version;
}
