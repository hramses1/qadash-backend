const { test } = require('node:test');
const assert = require('node:assert');

function fakeIo() {
  const events = [];
  return { events, emit: (ev, payload) => events.push({ ev, payload }) };
}

test('estado por perfil aislado: uno corriendo no afecta al otro', () => {
  delete require.cache[require.resolve('./runtimeRegistry')];
  const rt = require('./runtimeRegistry');
  const io = fakeIo();

  rt.start(io, 'perfil-1', 'tests');
  assert.strictEqual(rt.isProfileBusy('perfil-1'), true);
  assert.strictEqual(rt.isProfileBusy('perfil-2'), false);

  rt.start(io, 'perfil-2', 'docker');
  assert.strictEqual(rt.isProfileBusy('perfil-2'), true);
  assert.strictEqual(rt.isKindRunning('perfil-2', 'docker'), true);
  assert.strictEqual(rt.isKindRunning('perfil-1', 'docker'), false);

  // Detener perfil-1 no toca a perfil-2.
  rt.stop(io, 'perfil-1', 'tests');
  assert.strictEqual(rt.isProfileBusy('perfil-1'), false);
  assert.strictEqual(rt.isProfileBusy('perfil-2'), true);
});

test('statusList y emisión profiles:status', () => {
  delete require.cache[require.resolve('./runtimeRegistry')];
  const rt = require('./runtimeRegistry');
  const io = fakeIo();

  rt.start(io, 'perfil-1', 'tests');
  const last = io.events[io.events.length - 1];
  assert.strictEqual(last.ev, 'profiles:status');
  assert.deepStrictEqual(last.payload, [{ id: 'perfil-1', running: true, kinds: ['tests'] }]);

  rt.stop(io, 'perfil-1', 'tests');
  const last2 = io.events[io.events.length - 1];
  assert.deepStrictEqual(last2.payload, []);
});

test('varios kinds en un perfil: sigue busy hasta que todos paran', () => {
  delete require.cache[require.resolve('./runtimeRegistry')];
  const rt = require('./runtimeRegistry');
  const io = fakeIo();
  rt.start(io, 'p', 'tests');
  rt.start(io, 'p', 'docker');
  rt.stop(io, 'p', 'tests');
  assert.strictEqual(rt.isProfileBusy('p'), true);
  rt.stop(io, 'p', 'docker');
  assert.strictEqual(rt.isProfileBusy('p'), false);
});
