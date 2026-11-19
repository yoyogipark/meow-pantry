const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const version = process.argv[2];
if (!version || !/^\d+$/.test(version) || Number(version) < 1) {
  console.error('Usage: npm run version:pwa -- <positive integer>');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const files = ['index.html', 'sw.js'];
for (const file of files) {
  const filePath = path.join(root, file);
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/((?:css|js)\/[^?'"\s]+\?v=)\d+/g, `$1${version}`);
  if (file === 'sw.js') {
    source = source.replace(/(CACHE_NAME\s*=\s*CACHE_PREFIX\s*\+\s*'v)\d+(';)/, `$1${version}$2`);
  }
  fs.writeFileSync(filePath, source);
}

execFileSync(process.execPath, [path.join(root, 'tests', 'pwa-consistency.cjs')], { stdio: 'inherit' });
console.log(`PWA version updated to ${version}`);
