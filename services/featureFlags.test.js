const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Sandbox: crea un dir temporal con config.json + features.json y carga el
// servicio con rutas apuntando ahí vía variable de entorno de override.
function setup(configObj, featuresObj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(configObj || {}));
  if (featuresObj !== undefined) {
    fs.writeFileSync(path.join(dir, 'features.json'), JSON.stringify(featuresObj));
  }
  delete require.cache[require.resolve('./featureFlags')];
  process.env.QADASH_DATA_DIR = dir;
  return require('./featureFlags');
}

test('getFlags: proyecto sin entrada -> todos true', () => {
  const ff = setup({ projectPath: 'C:\\proj\\a' }, {});
  const flags = ff.getFlags();
  assert.deepStrictEqual(flags, ff.DEFAULT_FLAGS);
  assert.strictEqual(flags.docker, true);
});

test('getFlags: merge parcial sobre defaults', () => {
  const ff = setup({ projectPath: 'C:\\proj\\a' }, { 'C:\\proj\\a': { docker: false } });
  const flags = ff.getFlags();
  assert.strictEqual(flags.docker, false);
  assert.strictEqual(flags.reports, true);
});

test('getFlags: sin projectPath -> todos true', () => {
  const ff = setup({ projectPath: '' }, {});
  assert.deepStrictEqual(ff.getFlags(), ff.DEFAULT_FLAGS);
});

test('getFlags: features.json inexistente -> todos true', () => {
  const ff = setup({ projectPath: 'C:\\proj\\a' }); // sin features.json
  assert.deepStrictEqual(ff.getFlags(), ff.DEFAULT_FLAGS);
});

test('setFlags: persiste y filtra claves desconocidas', () => {
  const ff = setup({ projectPath: 'C:\\proj\\a' }, {});
  const saved = ff.setFlags({ docker: false, bogus: true });
  assert.strictEqual(saved.docker, false);
  assert.strictEqual(saved.reports, true);
  assert.strictEqual('bogus' in saved, false);
  // relee desde disco
  const ff2 = setup({ projectPath: 'C:\\proj\\a' },
    ff.readAll());
  assert.strictEqual(ff2.getFlags().docker, false);
});

test('setFlags: sin projectPath lanza error', () => {
  const ff = setup({ projectPath: '' }, {});
  assert.throws(() => ff.setFlags({ docker: false }), /No project configured/);
});
