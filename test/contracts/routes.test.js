const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../index.js'), 'utf8');

test('all production routers are mounted at compatible paths', () => {
  for (const route of ['/events', '/stripe', '/kiosk', '/volunteers', '/webhooks']) {
    assert.match(source, new RegExp(`app\\.use\\('${route.replace('/', '\\/')}'`));
  }
});

test('health endpoints and terminal error middleware are registered', () => {
  assert.match(source, /app\.get\('\/health'/);
  assert.match(source, /app\.get\('\/ready'/);
  assert.ok(source.indexOf('app.use(notFound)') > source.indexOf("app.use('/webhooks'"));
  assert.ok(source.indexOf('app.use(errorHandler)') > source.indexOf('app.use(notFound)'));
});

test('importing the app does not always start a listener', () => {
  assert.match(source, /if \(require\.main === module\)/);
  assert.match(source, /module\.exports = app/);
});
