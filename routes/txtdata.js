const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { parseFolder } = require('../services/txtParser');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

// GET /api/txtdata → parsed table from the configured txt folder
router.get('/', (req, res) => {
  try {
    const cfg = readConfig();
    const folder = cfg.txtFolderPath || '';
    if (!folder) {
      return res.json({ configured: false, folder: '', columns: [], rows: [], files: [], fileCount: 0 });
    }
    const result = parseFolder(folder);
    res.json({ configured: true, ...result });
  } catch (e) {
    res.status(400).json({ configured: true, error: e.message, columns: [], rows: [] });
  }
});

module.exports = router;
