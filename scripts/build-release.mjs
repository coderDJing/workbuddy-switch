import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
const signing = path.join(os.homedir(), '.wb-switch-next/release-signing');
if (!env.TAURI_SIGNING_PRIVATE_KEY && fs.existsSync(path.join(signing, 'updater.key'))) {
  env.TAURI_SIGNING_PRIVATE_KEY = path.join(signing, 'updater.key');
  if (env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD === undefined) {
    env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = fs.existsSync(path.join(signing, 'password.txt'))
      ? fs.readFileSync(path.join(signing, 'password.txt'), 'utf8') : '';
  }
}
if (!env.TAURI_SIGNING_PRIVATE_KEY) throw new Error('Next updater signing key is not configured. See docs/DEVELOPMENT.md.');
const result = spawnSync(process.execPath,
  [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'build', ...process.argv.slice(2)],
  { cwd: root, stdio: 'inherit', env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
