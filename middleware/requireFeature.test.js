// qadash-backend/middleware/requireFeature.test.js
const { test, mock } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// Mock de featureFlags.getFlags vía inyección: cargamos el módulo y
// sobreescribimos la dependencia con un require stub.
function loadWith(flags) {
  const ffPath = require.resolve('../services/featureFlags');
  require.cache[ffPath] = {
    id: ffPath, filename: ffPath, loaded: true,
    exports: { getFlags: () => flags }
  };
  delete require.cache[require.resolve('./requireFeature')];
  return require('./requireFeature');
}

function fakeRes() {
  return {
    statusCode: 0, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
}

test('requireFeature: flag true -> next()', () => {
  const requireFeature = loadWith({ docker: true });
  const res = fakeRes();
  let called = false;
  requireFeature('docker')({}, res, () => { called = true; });
  assert.strictEqual(called, true);
  assert.strictEqual(res.statusCode, 0);
});

test('requireFeature: flag false -> 403', () => {
  const requireFeature = loadWith({ docker: false });
  const res = fakeRes();
  let called = false;
  requireFeature('docker')({}, res, () => { called = true; });
  assert.strictEqual(called, false);
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.feature, 'docker');
});
