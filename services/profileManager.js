const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.QADASH_DATA_DIR || path.join(__dirname, '..');
const PROFILES_DIR = path.join(DATA_DIR, 'profiles');
const INDEX_PATH = path.join(PROFILES_DIR, 'index.json');

const DEFAULT_CONFIG = {
  projectPath: '', envPath: '', pytestCmd: 'pytest',
  txtFolderPath: '', seleniumRemoteUrl: '', errorImagesPath: '', jsonDataPath: '',
};
const DEFAULT_FEATURES = {
  variables: true, reports: true, txtData: true, jsonData: true,
  errorImages: true, docker: true, schedules: true,
};

function slugify(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'perfil';
}

function readIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8')); }
  catch { return { activeProfileId: null, profiles: [] }; }
}

function writeIndex(index) {
  if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR, { recursive: true });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
}

function listProfiles() {
  return readIndex().profiles || [];
}

function profileExists(id) {
  return listProfiles().some(p => p.id === id);
}

function getActiveProfileId() {
  return readIndex().activeProfileId || null;
}

function setActiveProfileId(id) {
  const index = readIndex();
  index.activeProfileId = id;
  writeIndex(index);
}

function profilePaths(id) {
  const dir = path.join(PROFILES_DIR, id);
  return {
    id,
    dir,
    config: path.join(dir, 'config.json'),
    automationConfig: path.join(dir, 'automation-config.json'),
    features: path.join(dir, 'features.json'),
    entornos: path.join(dir, 'entornos.json'),
    schedules: path.join(dir, 'schedules.json'),
    reportsDir: path.join(dir, 'reports'),
    dataDir: path.join(dir, 'data'),
    collection: path.join(dir, 'data', 'last-collection.json'),
  };
}

function resolveProfile(id) {
  if (!profileExists(id)) throw new Error('Perfil no encontrado');
  return profilePaths(id);
}

// ── CRUD ───────────────────────────────────────────────────────────

function uniqueId(base) {
  let id = base, n = 1;
  while (profileExists(id)) { n += 1; id = `${base}-${n}`; }
  return id;
}

function seedProfileFiles(paths, { config, features, entornos, schedules } = {}) {
  fs.mkdirSync(paths.dir, { recursive: true });
  fs.mkdirSync(paths.reportsDir, { recursive: true });
  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.writeFileSync(paths.config, JSON.stringify(config || DEFAULT_CONFIG, null, 2));
  fs.writeFileSync(paths.features, JSON.stringify(features || DEFAULT_FEATURES, null, 2));
  fs.writeFileSync(paths.entornos, JSON.stringify(entornos || {}, null, 2));
  fs.writeFileSync(paths.schedules, JSON.stringify(schedules || [], null, 2));
  fs.writeFileSync(paths.automationConfig, JSON.stringify({ repoUrl: '', installPath: '' }, null, 2));
}

function createProfile(name) {
  const id = uniqueId(slugify(name));
  const paths = profilePaths(id);
  seedProfileFiles(paths);
  const index = readIndex();
  const entry = { id, name: name.trim() || id, createdAt: new Date().toISOString() };
  index.profiles.push(entry);
  if (!index.activeProfileId) index.activeProfileId = id;
  writeIndex(index);
  return entry;
}

function renameProfile(id, newName) {
  const index = readIndex();
  const entry = index.profiles.find(p => p.id === id);
  if (!entry) throw new Error('Perfil no encontrado');
  entry.name = newName.trim();
  writeIndex(index);
}

function copyFileIfExists(src, dst) {
  if (fs.existsSync(src)) fs.copyFileSync(src, dst);
}

function duplicateProfile(id, newName) {
  if (!profileExists(id)) throw new Error('Perfil no encontrado');
  const src = profilePaths(id);
  const dstId = uniqueId(slugify(newName));
  const dst = profilePaths(dstId);
  fs.mkdirSync(dst.dir, { recursive: true });
  fs.mkdirSync(dst.reportsDir, { recursive: true });
  fs.mkdirSync(dst.dataDir, { recursive: true });
  for (const key of ['config', 'automationConfig', 'features', 'entornos', 'schedules']) {
    copyFileIfExists(src[key], dst[key]);
  }
  const index = readIndex();
  const entry = { id: dstId, name: newName.trim() || dstId, createdAt: new Date().toISOString() };
  index.profiles.push(entry);
  writeIndex(index);
  return entry;
}

function deleteProfile(id) {
  const index = readIndex();
  index.profiles = index.profiles.filter(p => p.id !== id);
  if (index.activeProfileId === id) {
    index.activeProfileId = index.profiles[0] ? index.profiles[0].id : null;
  }
  writeIndex(index);
  try { fs.rmSync(profilePaths(id).dir, { recursive: true, force: true }); } catch {}
}

// ── Entornos (ex profiles.json), por perfil ────────────────────────

function readEntornos(entornosPath) {
  try { return JSON.parse(fs.readFileSync(entornosPath, 'utf-8')); }
  catch { return {}; }
}
function writeEntornos(entornosPath, map) {
  fs.writeFileSync(entornosPath, JSON.stringify(map, null, 2));
}
function getEntorno(entornosPath, name) {
  const map = readEntornos(entornosPath);
  return map[name] || null;
}

module.exports = {
  DATA_DIR, PROFILES_DIR, INDEX_PATH, DEFAULT_CONFIG, DEFAULT_FEATURES,
  slugify, readIndex, writeIndex, listProfiles, profileExists,
  getActiveProfileId, setActiveProfileId, profilePaths, resolveProfile,
  seedProfileFiles, createProfile, renameProfile, duplicateProfile, deleteProfile,
  readEntornos, writeEntornos, getEntorno,
};
