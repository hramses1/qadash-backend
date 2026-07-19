const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

function setup(featuresObj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-'));
  const featuresPath = path.join(dir, 'features.json');
  if (featuresObj !== undefined) fs.writeFileSync(featuresPath, JSON.stringify(featuresObj));
  delete require.cache[require.resolve('./featureFlags')];
  return { ff: require('./featureFlags'), featuresPath };
}

test('getFlags: archivo ausente -> todos true', () => {
  const { ff, featuresPath } = setup(undefined);
  assert.deepStrictEqual(ff.getFlags(featuresPath), ff.DEFAULT_FLAGS);
});

test('getFlags: merge parcial sobre defaults', () => {
  const { ff, featuresPath } = setup({ docker: false });
  assert.strictEqual(ff.getFlags(featuresPath).docker, false);
  assert.strictEqual(ff.getFlags(featuresPath).reports, true);
});

test('setFlags: persiste y normaliza', () => {
  const { ff, featuresPath } = setup({});
  const out = ff.setFlags(featuresPath, { docker: false, basura: 1 });
  assert.strictEqual(out.docker, false);
  assert.strictEqual(out.basura, undefined);
  assert.strictEqual(JSON.parse(fs.readFileSync(featuresPath, 'utf-8')).docker, false);
});
