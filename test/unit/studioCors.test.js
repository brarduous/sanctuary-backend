const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const http = require('node:http');
const cors = require('cors');

test('Studio can preflight caption edits while unrelated origins remain denied', async () => {
  const source = fs.readFileSync(require.resolve('../../index.js'), 'utf8');
  const start = source.indexOf('const allowedOrigins =');
  const end = source.indexOf('app.use(cors(corsOptions));', start);
  assert.ok(start >= 0 && end > start);
  const context = { console: { warn() {} }, result: null };
  vm.runInNewContext(`${source.slice(start, end)}\nresult = corsOptions;`, context);
  const middleware = cors(context.result);
  const server = http.createServer((req, res) => middleware(req, res, (error) => { res.statusCode = error ? 403 : 200; res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/content-pack/items/demo`;
    const headers = { Origin: 'https://studio.sanctuaryapp.us', 'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'authorization,content-type,x-membership-id' };
    const allowed = await fetch(url, { method: 'OPTIONS', headers });
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get('access-control-allow-origin'), headers.Origin);
    assert.ok(allowed.headers.get('access-control-allow-methods').split(',').includes('PATCH'));
    assert.match(allowed.headers.get('access-control-allow-headers'), /Authorization/);
    const blocked = await fetch(url, { method: 'OPTIONS', headers: { ...headers, Origin: 'https://unrelated.example' } });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.headers.get('access-control-allow-origin'), null);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
