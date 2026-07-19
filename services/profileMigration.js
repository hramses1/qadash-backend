const fs = require('fs');
const path = require('path');
const pm = require('./profileManager');

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
  catch { return fallback; }
}

function moveFileIfExists(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.renameSync(src, dst);
}

// Colapsa el features.json viejo (mapa keyed por projectPath) a objeto plano.
function collapseFeatures(oldMap, projectPath) {
  const entry = (oldMap && projectPath && oldMap[projectPath]) || {};
  return { ...pm.DEFAULT_FEATURES, ...entry };
}

function migrateIfNeeded() {
  if (fs.existsSync(pm.INDEX_PATH)) return { migrated: false };

  const D = pm.DATA_DIR;
  const id = 'perfil-1';
  const paths = pm.profilePaths(id);
  fs.mkdirSync(paths.dir, { recursive: true });
  fs.mkdirSync(paths.reportsDir, { recursive: true });
  fs.mkdirSync(paths.dataDir, { recursive: true });

  const oldConfig = readJson(path.join(D, 'config.json'), { ...pm.DEFAULT_CONFIG });
  const oldFeatures = readJson(path.join(D, 'features.json'), {});

  // config
  fs.writeFileSync(paths.config, JSON.stringify({ ...pm.DEFAULT_CONFIG, ...oldConfig }, null, 2));
  // automation-config
  moveFileIfExists(path.join(D, 'automation-config.json'), paths.automationConfig);
  if (!fs.existsSync(paths.automationConfig)) {
    fs.writeFileSync(paths.automationConfig, JSON.stringify({ repoUrl: '', installPath: '' }, null, 2));
  }
  // features colapsado
  fs.writeFileSync(paths.features, JSON.stringify(collapseFeatures(oldFeatures, oldConfig.projectPath), null, 2));
  // profiles.json -> entornos.json
  const oldEntornos = readJson(path.join(D, 'profiles.json'), {});
  fs.writeFileSync(paths.entornos, JSON.stringify(oldEntornos, null, 2));
  // schedules
  moveFileIfExists(path.join(D, 'schedules.json'), paths.schedules);
  if (!fs.existsSync(paths.schedules)) fs.writeFileSync(paths.schedules, JSON.stringify([], null, 2));
  // reports/*.json
  const oldReports = path.join(D, 'reports');
  if (fs.existsSync(oldReports)) {
    for (const f of fs.readdirSync(oldReports)) {
      if (f.endsWith('.json')) moveFileIfExists(path.join(oldReports, f), path.join(paths.reportsDir, f));
    }
  }
  // colección
  moveFileIfExists(path.join(D, 'data', 'last-collection.json'), paths.collection);

  // Solo al final: escribir index (si algo falló arriba, se reintenta)
  pm.writeIndex({ activeProfileId: id, profiles: [{ id, name: 'Perfil 1', createdAt: new Date().toISOString() }] });
  return { migrated: true, id };
}

module.exports = { migrateIfNeeded };
