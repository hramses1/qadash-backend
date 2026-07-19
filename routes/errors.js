const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

function getConfig(req) {
  try { return JSON.parse(fs.readFileSync(req.profile.config, 'utf-8')); }
  catch { return {}; }
}

// Carpeta de imágenes: override en config o <projectPath>/reports/errors.
function resolveFolder(req) {
  const cfg = getConfig(req);
  if (cfg.errorImagesPath) return cfg.errorImagesPath;
  if (cfg.projectPath) return path.join(cfg.projectPath, 'reports', 'errors');
  return '';
}

// GET /api/errors/images → { configured, folder, images: [{name, mtime, size}] }
router.get('/images', (req, res) => {
  try {
    const folder = resolveFolder(req);
    if (!folder) return res.json({ configured: false, folder: '', images: [] });
    if (!fs.existsSync(folder)) return res.json({ configured: true, folder, images: [], missing: true });

    const images = fs.readdirSync(folder)
      .filter(f => IMG_EXT.has(path.extname(f).toLowerCase()))
      .map(name => {
        const st = fs.statSync(path.join(folder, name));
        return { name, mtime: st.mtimeMs, size: st.size };
      })
      .sort((a, b) => b.mtime - a.mtime);

    res.json({ configured: true, folder, images });
  } catch (e) {
    res.status(500).json({ error: e.message, images: [] });
  }
});

// GET /api/errors/image?name=... → sirve el archivo (validado dentro de la carpeta)
router.get('/image', (req, res) => {
  try {
    const folder = resolveFolder(req);
    if (!folder) return res.status(400).send('Carpeta no configurada');
    const name = req.query.name || '';
    const filePath = path.resolve(folder, name);
    if (!filePath.startsWith(path.resolve(folder))) return res.status(403).send('Acceso denegado');
    if (!fs.existsSync(filePath)) return res.status(404).send('Imagen no encontrada');
    if (!IMG_EXT.has(path.extname(filePath).toLowerCase())) return res.status(400).send('No es imagen');
    res.sendFile(filePath);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

module.exports = router;
