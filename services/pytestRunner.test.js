const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// io falso que registra a qué sala se emite cada evento.
function fakeIo() {
  const roomEvents = {};
  return {
    roomEvents,
    to(room) {
      return { emit: (ev, payload) => { (roomEvents[room] ||= []).push({ ev, payload }); } };
    },
    emit() {},
  };
}

test('dos perfiles en paralelo: reportes en carpetas separadas y eventos por sala', async () => {
  delete require.cache[require.resolve('./runtimeRegistry')];
  delete require.cache[require.resolve('./pytestRunner')];
  const { runTests } = require('./pytestRunner');

  const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'pr1-'));
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pr2-'));
  const io = fakeIo();

  // pytestCmd trivial multiplataforma: node -e "" (ignora args extra, sale 0/!=0
  // pero SIEMPRE genera un reporte). Corremos ambos perfiles concurrentemente.
  const cmd = `node -e ""`;
  const cwd = process.cwd();

  await Promise.all([
    runTests(io, 'perfil-1', ['t1'], cwd, cmd, {}, {}, dir1),
    runTests(io, 'perfil-2', ['t2'], cwd, cmd, {}, {}, dir2),
  ]);

  const r1 = fs.readdirSync(dir1).filter(f => f.endsWith('.json'));
  const r2 = fs.readdirSync(dir2).filter(f => f.endsWith('.json'));
  assert.strictEqual(r1.length, 1, 'perfil-1 debe tener 1 reporte propio');
  assert.strictEqual(r2.length, 1, 'perfil-2 debe tener 1 reporte propio');

  // Eventos aislados por sala.
  assert.ok((io.roomEvents['profile:perfil-1'] || []).length > 0);
  assert.ok((io.roomEvents['profile:perfil-2'] || []).length > 0);
  const p1HasT1 = io.roomEvents['profile:perfil-1'].some(e => JSON.stringify(e.payload).includes('t1'));
  const p1HasT2 = io.roomEvents['profile:perfil-1'].some(e => JSON.stringify(e.payload).includes('"id":"t2"'));
  assert.ok(p1HasT1, 'sala perfil-1 recibe su test t1');
  assert.ok(!p1HasT2, 'sala perfil-1 NO recibe el test t2 del otro perfil');
});
