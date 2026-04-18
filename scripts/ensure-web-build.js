/**
 * Construit le bundle React si `public/web/index.html` est absent.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const target = path.join(root, 'public', 'web', 'index.html');

if (fs.existsSync(target)) {
  process.exit(0);
}

const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';
const r = spawnSync(npm, ['run', 'build:web'], { cwd: root, stdio: 'inherit' });

process.exit(typeof r.status === 'number' && r.status !== 0 ? r.status : 0);
