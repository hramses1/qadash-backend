const fs = require('fs');
const path = require('path');

// Permite override del directorio de datos en tests (QADASH_DATA_DIR).
const DATA_DIR = process.env.QADASH_DATA_DIR || path.join(__dirname, '..');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const FEATURES_PATH = path.join(DATA_DIR, 'features.json');

const FEATURE_KEYS = ['variables', 'reports', 'txtData', 'jsonData', 'errorImages', 'docker', 'schedules'];
const DEFAULT_FLAGS = Object.freeze(
  FEATURE_KEYS.reduce((acc, k) => { acc[k] = true; return acc; }, {})
);

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); }
  catch { return {}; }
}

function readAll() {
  try { return JSON.parse(fs.readFileSync(FEATURES_PATH, 'utf-8')); }
  catch { return {}; }
}

function writeAll(map) {
  fs.writeFileSync(FEATURES_PATH, JSON.stringify(map, null, 2));
}

// Fusiona una entrada parcial sobre los defaults, quedándose solo con claves conocidas.
function normalize(entry) {
  const out = { ...DEFAULT_FLAGS };
  if (entry && typeof entry === 'object') {
    for (const k of FEATURE_KEYS) {
      if (typeof entry[k] === 'boolean') out[k] = entry[k];
    }
  }
  return out;
}

function getFlags() {
  const { projectPath } = readConfig();
  if (!projectPath) return { ...DEFAULT_FLAGS };
  const map = readAll();
  return normalize(map[projectPath]);
}

function setFlags(partial) {
  const { projectPath } = readConfig();
  if (!projectPath) throw new Error('No project configured');
  const map = readAll();
  map[projectPath] = normalize({ ...map[projectPath], ...partial });
  writeAll(map);
  return map[projectPath];
}

module.exports = { FEATURE_KEYS, DEFAULT_FLAGS, getFlags, setFlags, readAll };
