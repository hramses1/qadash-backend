const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

function setup(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content));
  }
  delete require.cache[require.resolve('./profileManager')];
  delete require.cache[require.resolve('./profileMigration')];
  process.env.QADASH_DATA_DIR = dir;
  return { mig: require('./profileMigration'), dir };
}

test('migrateIfNeeded: mueve config global a perfil-1 y colapsa features', () => {
  const { mig, dir } = setup({
    'config.json': { projectPath: 'C:\\proj\\a', pytestCmd: 'pytest' },
    'automation-config.json': { repoUrl: 'https://x', installPath: 'C:\\i' },
    'features.json': { 'C:\\proj\\a': { docker: false, reports: true, variables: true, txtData: true, jsonData: true, errorImages: true, schedules: true } },
    'profiles.json': { Prepo: [{ key: 'USER', value: 'u', isComment: false }] },
    'schedules.json': [{ id: 's1', name: 'x' }],
    'reports/report_1.json': { id: 'report_1' },
  });

  const r = mig.migrateIfNeeded();
  assert.strictEqual(r.migrated, true);
  assert.strictEqual(r.id, 'perfil-1');

  const base = path.join(dir, 'profiles', 'perfil-1');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(base, 'config.json'), 'utf-8')).projectPath, 'C:\\proj\\a');
  const feat = JSON.parse(fs.readFileSync(path.join(base, 'features.json'), 'utf-8'));
  assert.strictEqual(feat.docker, false);
  assert.strictEqual(feat.reports, true);
  assert.ok(fs.existsSync(path.join(base, 'entornos.json')));
  assert.ok(JSON.parse(fs.readFileSync(path.join(base, 'entornos.json'), 'utf-8')).Prepo);
  assert.ok(fs.existsSync(path.join(base, 'reports', 'report_1.json')));
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'profiles', 'index.json'), 'utf-8'));
  assert.strictEqual(idx.activeProfileId, 'perfil-1');
});

test('migrateIfNeeded: idempotente si index existe', () => {
  const { mig } = setup({ 'profiles/index.json': { activeProfileId: 'perfil-1', profiles: [{ id: 'perfil-1', name: 'Perfil 1', createdAt: 'x' }] } });
  assert.strictEqual(mig.migrateIfNeeded().migrated, false);
});
