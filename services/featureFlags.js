const fs = require('fs');

const FEATURE_KEYS = ['variables', 'reports', 'txtData', 'jsonData', 'errorImages', 'docker', 'schedules'];
const DEFAULT_FLAGS = Object.freeze(
  FEATURE_KEYS.reduce((acc, k) => { acc[k] = true; return acc; }, {})
);

function normalize(entry) {
  const out = { ...DEFAULT_FLAGS };
  if (entry && typeof entry === 'object') {
    for (const k of FEATURE_KEYS) {
      if (typeof entry[k] === 'boolean') out[k] = entry[k];
    }
  }
  return out;
}

function readFile(featuresPath) {
  try { return JSON.parse(fs.readFileSync(featuresPath, 'utf-8')); }
  catch { return {}; }
}

function getFlags(featuresPath) {
  return normalize(readFile(featuresPath));
}

function setFlags(featuresPath, partial) {
  const merged = normalize({ ...readFile(featuresPath), ...partial });
  fs.writeFileSync(featuresPath, JSON.stringify(merged, null, 2));
  return merged;
}

module.exports = { FEATURE_KEYS, DEFAULT_FLAGS, getFlags, setFlags };
