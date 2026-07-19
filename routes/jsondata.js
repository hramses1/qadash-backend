const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const SNAP_PATH = path.join(__dirname, '..', 'data', 'json-snapshots.json');

function getConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function getBase() {
  const cfg = getConfig();
  return cfg.jsonDataPath || '';
}

// ── Snapshots (perfiles por archivo) ──────────────────────────────
function readSnaps() {
  try { return JSON.parse(fs.readFileSync(SNAP_PATH, 'utf-8')); }
  catch { return {}; }
}
function writeSnaps(data) {
  fs.writeFileSync(SNAP_PATH, JSON.stringify(data, null, 2));
}
function snapKey(folder, file) {
  return `${folder || ''}/${file}`;
}

// ── Resolución segura de rutas (evita traversal) ──────────────────
function resolveFilePath(base, folder, file) {
  if (!file) throw new Error('Archivo no especificado');
  const safeFolder = folder ? path.basename(folder) : '';
  const safeFile = path.basename(file);
  if (!safeFile.toLowerCase().endsWith('.json')) throw new Error('Solo archivos .json');
  const target = safeFolder
    ? path.join(base, safeFolder, safeFile)
    : path.join(base, safeFile);
  const rel = path.relative(base, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Ruta inválida');
  return target;
}

function buildTree(base) {
  const out = [];
  const entries = fs.readdirSync(base, { withFileTypes: true });

  const rootFiles = entries
    .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.json'))
    .map(e => e.name)
    .sort();
  if (rootFiles.length) out.push({ folder: '', files: rootFiles });

  for (const e of entries.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    let files = [];
    try {
      files = fs.readdirSync(path.join(base, e.name))
        .filter(f => f.toLowerCase().endsWith('.json'))
        .sort();
    } catch {}
    out.push({ folder: e.name, files });
  }
  return out;
}

// GET /api/jsondata/tree → carpetas + archivos json
router.get('/tree', (req, res) => {
  try {
    const base = getBase();
    if (!base) return res.json({ configured: false, base: '', tree: [] });
    if (!fs.existsSync(base)) return res.status(400).json({ configured: true, base, tree: [], error: 'La carpeta configurada no existe' });
    res.json({ configured: true, base, tree: buildTree(base) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/jsondata/file?folder=&file= → contenido json
router.get('/file', (req, res) => {
  try {
    const base = getBase();
    if (!base) return res.status(400).json({ error: 'Carpeta de datos JSON no configurada' });
    const target = resolveFilePath(base, req.query.folder, req.query.file);
    if (!fs.existsSync(target)) return res.status(404).json({ error: 'Archivo no encontrado', path: target });
    const raw = fs.readFileSync(target, 'utf-8');
    let data;
    try { data = JSON.parse(raw); }
    catch (e) { return res.status(400).json({ error: `JSON inválido: ${e.message}` }); }
    res.json({ data, path: target });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/jsondata/file?folder=&file=  body:{ data }
router.post('/file', (req, res) => {
  try {
    const base = getBase();
    if (!base) return res.status(400).json({ error: 'Carpeta de datos JSON no configurada' });
    const target = resolveFilePath(base, req.query.folder, req.query.file);
    if (!('data' in req.body)) return res.status(400).json({ error: 'Falta el campo data' });
    fs.writeFileSync(target, JSON.stringify(req.body.data, null, 2) + '\n');
    res.json({ success: true, path: target });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Snapshots ─────────────────────────────────────────────────────
// GET /api/jsondata/snapshots?folder=&file= → { nombre: data }
router.get('/snapshots', (req, res) => {
  try {
    const snaps = readSnaps();
    res.json(snaps[snapKey(req.query.folder, req.query.file)] || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/jsondata/snapshots/:name?folder=&file=  body:{ data }
router.post('/snapshots/:name', (req, res) => {
  try {
    const name = req.params.name.trim();
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });
    if (!('data' in req.body)) return res.status(400).json({ error: 'Falta el campo data' });
    const key = snapKey(req.query.folder, req.query.file);
    const snaps = readSnaps();
    if (!snaps[key]) snaps[key] = {};
    snaps[key][name] = req.body.data;
    writeSnaps(snaps);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/jsondata/snapshots/:name?folder=&file=
router.delete('/snapshots/:name', (req, res) => {
  try {
    const key = snapKey(req.query.folder, req.query.file);
    const snaps = readSnaps();
    if (snaps[key]) { delete snaps[key][req.params.name]; writeSnaps(snaps); }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
