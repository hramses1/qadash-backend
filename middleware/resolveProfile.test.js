const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

function load(indexObj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-'));
  fs.mkdirSync(path.join(dir, 'profiles'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'profiles', 'index.json'), JSON.stringify(indexObj));
  delete require.cache[require.resolve('../services/profileManager')];
  delete require.cache[require.resolve('./resolveProfile')];
  process.env.QADASH_DATA_DIR = dir;
  return require('./resolveProfile');
}

function mockRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

const INDEX = { activeProfileId: 'perfil-1', profiles: [{ id: 'perfil-1', name: 'Perfil 1', createdAt: 'x' }] };

test('sin header usa el perfil activo', () => {
  const mw = load(INDEX);
  const req = { headers: {} }; const res = mockRes(); let nexted = false;
  mw(req, res, () => { nexted = true; });
  assert.ok(nexted);
  assert.strictEqual(req.profile.id, 'perfil-1');
});

test('header valido selecciona ese perfil', () => {
  const mw = load({ activeProfileId: 'perfil-1', profiles: [INDEX.profiles[0], { id: 'perfil-2', name: 'P2', createdAt: 'x' }] });
  const req = { headers: { 'x-profile-id': 'perfil-2' } }; const res = mockRes(); let nexted = false;
  mw(req, res, () => { nexted = true; });
  assert.ok(nexted);
  assert.strictEqual(req.profile.id, 'perfil-2');
});

test('header invalido -> 400', () => {
  const mw = load(INDEX);
  const req = { headers: { 'x-profile-id': 'fantasma' } }; const res = mockRes(); let nexted = false;
  mw(req, res, () => { nexted = true; });
  assert.ok(!nexted);
  assert.strictEqual(res.statusCode, 400);
});
