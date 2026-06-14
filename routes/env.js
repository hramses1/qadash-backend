const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { readEnv, writeEnv } = require('../services/envManager');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function getConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function resolveEnvPath(file, projectPath, fallbackEnvPath) {
  if (file && projectPath) {
    return path.join(projectPath, path.basename(file));
  }
  return fallbackEnvPath || '';
}

router.get('/files', (req, res) => {
  try {
    const { projectPath } = getConfig();
    if (!projectPath || !fs.existsSync(projectPath)) return res.json({ files: [] });
    const files = fs.readdirSync(projectPath)
      .filter(f => /^\.env(\..+)?$/.test(f) && f !== '.env.example')
      .sort();
    res.json({ files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/', (req, res) => {
  try {
    const { projectPath, envPath } = getConfig();
    const targetPath = resolveEnvPath(req.query.file, projectPath, envPath);
    if (!targetPath) return res.status(400).json({ error: 'Env path not configured' });
    if (!fs.existsSync(targetPath)) return res.status(404).json({ error: 'Env file not found', path: targetPath });
    const vars = readEnv(targetPath);
    res.json({ vars, path: targetPath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', (req, res) => {
  try {
    const { vars } = req.body;
    const { projectPath, envPath } = getConfig();
    const targetPath = resolveEnvPath(req.query.file, projectPath, envPath);
    if (!targetPath) return res.status(400).json({ error: 'Env path not configured' });
    writeEnv(targetPath, vars);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
