const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Load the actual routers with isolated dependencies, without production config.
let results;
let filters;
const supabase = { from(table) {
  const query = {
    select() { return query; },
    eq(column, value) { filters.push({ table, column, value }); return query; },
    gte() { return query; },
    order() { return query; },
    maybeSingle() { return query; },
    then(resolve, reject) { return Promise.resolve(results[table]).then(resolve, reject); }
  };
  return query;
} };
const auth = (req, res, next) => {
  if (!req.get('x-test-user')) return res.status(401).json({ error: 'Unauthenticated' });
  req.user = { id: req.get('x-test-user') };
  next();
};
function router(file) {
  const module = { exports: {} };
  const dependencies = {
    express,
    '../config/supabase': supabase,
    '../middleware/auth': auth,
    '../middleware/authorization': { requireCapability: () => (_req, res) => res.sendStatus(403) },
    '../utils/stripe': { getStripe: () => { throw new Error('Stripe must not be used by read-state tests'); } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../routes', file), 'utf8'), {
    module,
    require: (name) => {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    }
  }, { filename: file });
  return module.exports;
}
let server;
let base;
test.before(async () => {
  const app = express();
  app.use('/api/v1/stripe', router('stripe.js'));
  app.use('/api/v1/volunteers', router('volunteers.js'));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise(resolve => server.close(resolve)));
test.beforeEach(() => {
  filters = [];
  results = {
    congregations: { data: { stripe_charges_enabled: false }, error: null },
    event_volunteers: { data: [], error: null },
    role_members: { data: [], error: null }
  };
});
async function read(route, authenticated = true) {
  const response = await fetch(base + route, { headers: authenticated ? { 'x-test-user': 'member' } : {} });
  return { status: response.status, body: await response.json() };
}
test('mobile reads require authentication before database access', async () => {
  assert.equal((await read('/api/v1/stripe/status/1/public', false)).status, 401);
  assert.equal((await read('/api/v1/volunteers/hub', false)).status, 401);
  assert.deepEqual(filters, []);
});
test('Giving distinguishes disabled and enabled church status', async () => {
  assert.deepEqual(await read('/api/v1/stripe/status/1/public'), { status: 200, body: { isGivingEnabled: false } });
  results.congregations.data.stripe_charges_enabled = true;
  assert.deepEqual(await read('/api/v1/stripe/status/1/public'), { status: 200, body: { isGivingEnabled: true } });
});
test('Giving database failure is not reported as disabled', async () => {
  results.congregations = { data: null, error: { code: 'DB_UNAVAILABLE' } };
  const response = await read('/api/v1/stripe/status/1/public');
  assert.equal(response.status, 500);
  assert.equal(response.body.isGivingEnabled, undefined);
});
test('missing church is not reported as disabled', async () => {
  results.congregations.data = null;
  assert.equal((await read('/api/v1/stripe/status/1/public')).status, 404);
});
test('successful empty schedule retains user-scoped reads', async () => {
  assert.deepEqual(await read('/api/v1/volunteers/hub'), { status: 200, body: { schedule: [], myTeams: [] } });
  assert.deepEqual(filters, [
    { table: 'event_volunteers', column: 'user_id', value: 'member' },
    { table: 'role_members', column: 'user_id', value: 'member' }
  ]);
});
for (const table of ['event_volunteers', 'role_members']) {
  test(`${table} read failure is not reported as an empty schedule`, async () => {
    results[table] = { data: null, error: { code: 'DB_UNAVAILABLE' } };
    const response = await read('/api/v1/volunteers/hub');
    assert.equal(response.status, 500);
    assert.equal(response.body.schedule, undefined);
    assert.equal(response.body.myTeams, undefined);
  });
}
