const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const express = require('express');

function server() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-'));
  fs.mkdirSync(path.join(dir, 'profiles'), { recursive: true });
  process.env.QADASH_DATA_DIR = dir;
  ['../services/profileManager', './profileAdmin'].forEach(m => { try { delete require.cache[require.resolve(m)]; } catch {} });
  const app = express();
  app.use(express.json());
  app.use('/api/profile-admin', require('./profileAdmin'));
  return http.createServer(app);
}

function req(srv, method, urlPath, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ ...srv.address(), method, path: urlPath, headers: { 'content-type': 'application/json' } }, (res) => {
      let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
    });
    if (data) r.write(data); r.end();
  });
}

test('crear, listar, activar, borrar', async () => {
  const app = server();
  await new Promise(r => app.listen(0, r));
  const c = await req(app, 'POST', '/api/profile-admin', { name: 'Perfil 1' });
  assert.strictEqual(c.status, 200);
  assert.strictEqual(c.body.id, 'perfil-1');
  const list = await req(app, 'GET', '/api/profile-admin');
  assert.strictEqual(list.body.profiles.length, 1);
  await req(app, 'POST', '/api/profile-admin', { name: 'Perfil 2' });
  const act = await req(app, 'PATCH', '/api/profile-admin/perfil-2/activate');
  assert.strictEqual(act.status, 200);
  const del = await req(app, 'DELETE', '/api/profile-admin/perfil-1');
  assert.strictEqual(del.status, 200);
  app.close();
});

test('no permite borrar el ultimo perfil', async () => {
  const app = server();
  await new Promise(r => app.listen(0, r));
  await req(app, 'POST', '/api/profile-admin', { name: 'Solo' });
  const del = await req(app, 'DELETE', '/api/profile-admin/solo');
  assert.strictEqual(del.status, 409);
  app.close();
});
