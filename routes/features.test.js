const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const express = require('express');

function server() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffr-'));
  const featuresPath = path.join(dir, 'features.json');
  process.env.QADASH_DATA_DIR = dir;
  delete require.cache[require.resolve('../services/featureFlags')];
  delete require.cache[require.resolve('./features')];
  const app = express();
  app.use(express.json());
  // Simula el middleware resolveProfile: adjunta la ruta de features del perfil.
  app.use((req, _res, next) => { req.profile = { features: featuresPath }; next(); });
  app.use('/api/features', require('./features'));
  return app.listen(0);
}

function req(srv, method, body) {
  const { port } = srv.address();
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ port, method, path: '/api/features',
      headers: { 'Content-Type': 'application/json' } }, (res) => {
      let buf = ''; res.on('data', d => buf += d);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(buf) }));
    });
    if (data) r.write(data);
    r.end();
  });
}

test('GET /api/features devuelve 7 flags default true', async () => {
  const srv = server();
  const { status, body } = await req(srv, 'GET');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.docker, true);
  assert.strictEqual(Object.keys(body).length, 7);
  srv.close();
});

test('POST /api/features guarda flags', async () => {
  const srv = server();
  const { status, body } = await req(srv, 'POST', { docker: false });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.docker, false);
  const get = await req(srv, 'GET');
  assert.strictEqual(get.body.docker, false);
  srv.close();
});
