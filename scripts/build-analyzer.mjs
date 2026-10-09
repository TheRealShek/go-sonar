import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const host = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)?.[1];
if (!host) {
  throw new Error('rustc did not report its host target');
}

const suffix = process.platform === 'win32' ? '.exe' : '';
const directory = resolve(root, 'src-tauri/binaries');
mkdirSync(directory, { recursive: true });

execFileSync(
  'go',
  [
    'build',
    '-trimpath',
    '-o',
    resolve(directory, `go-sonar-analyzer-${host}${suffix}`),
    './cmd/go-sonar-analyzer',
  ],
  {
    cwd: resolve(root, 'analyzer'),
    stdio: 'inherit',
  },
);
