const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const swSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const listeners = {};
const sandbox = {
  self: {
    location: new URL('https://example.test/pantry/'),
    addEventListener(type, handler) { listeners[type] = handler; }
  },
  caches: {
    match: async () => undefined,
    open: async () => ({
      put: async () => { throw new Error('Simulated cache write failure'); }
    })
  },
  fetch: async () => new Response('online'),
  Request,
  URL,
  Promise,
  Response
};
vm.createContext(sandbox);
vm.runInContext(swSource + '\nthis.__coreAssets = CORE_ASSETS;', sandbox);

const coreAssets = Array.from(sandbox.__coreAssets);
const htmlAssets = Array.from(html.matchAll(/(?:src|href)="(\.\/(?:css|js)\/[^"#]+)"/g), match => match[1]);

for (const asset of coreAssets) {
  if (!asset.startsWith('./') || asset === './') continue;
  const relativePath = asset.slice(2).split('?')[0];
  assert.ok(fs.existsSync(path.join(root, relativePath)), `Cached asset does not exist: ${asset}`);
}

for (const asset of htmlAssets) {
  assert.ok(coreAssets.includes(asset), `HTML asset is missing or version-mismatched in CORE_ASSETS: ${asset}`);
}

const externalAssets = coreAssets.filter(asset => /^https?:/i.test(asset));
assert.deepEqual(externalAssets, [], 'Offline core cache must not contain external assets');
console.log(`PWA asset consistency pass (${htmlAssets.length} HTML assets, ${coreAssets.length} cached routes)`);
async function checkNetworkResponse() {
  for (const asset of ['index.html', 'icon-192.png']) {
    const request = new Request(new URL(asset, sandbox.self.location));
    let responsePromise;
    listeners.fetch({ request, respondWith(promise) { responsePromise = promise; } });
    const response = await responsePromise;
    assert.equal(response.status, 200, asset);
    assert.equal(await response.text(), 'online', asset);
  }
  console.log('Online responses survive cache write failures');
}

checkNetworkResponse().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
