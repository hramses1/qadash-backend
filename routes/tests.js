const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { collectTests } = require('../services/testCollector');
const { runTests, abortExecution, isRunning } = require('../services/pytestRunner');
const { readEnv } = require('../services/envManager');
const { getProfile } = require('../services/profileManager');
const { ensureGrid } = require('../services/dockerRunner');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function getConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function resolveEnvVars(profileName, envFile, projectPath) {
  if (profileName) {
    const vars = getProfile(profileName);
    if (vars) return Object.fromEntries(vars.filter(v => !v.isComment && v.key).map(v => [v.key, v.value]));
  }
  if (envFile && projectPath) {
    const fullPath = path.join(projectPath, path.basename(envFile));
    if (fs.existsSync(fullPath)) {
      return Object.fromEntries(
        readEnv(fullPath).filter(v => !v.isComment && v.key).map(v => [v.key, v.value])
      );
    }
  }
  return {};
}

// Returns last collection from disk (fast — no pytest re-run)
router.get('/cached', (req, res) => {
  const cachePath = path.join(__dirname, '..', 'data', 'last-collection.json');
  if (!fs.existsSync(cachePath)) return res.json({ files: {}, total: 0, timestamp: null });
  try {
    res.json(JSON.parse(fs.readFileSync(cachePath, 'utf-8')));
  } catch {
    res.json({ files: {}, total: 0, timestamp: null });
  }
});

router.get('/collect', async (req, res) => {
  try {
    const { projectPath, pytestCmd } = getConfig();
    if (!projectPath) return res.status(400).json({ error: 'Project path not configured' });
    const result = await collectTests(projectPath, pytestCmd);

    // Persist collection so analytics can cross-reference unexecuted tests
    try {
      const dataDir = path.join(__dirname, '..', 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(
        path.join(dataDir, 'last-collection.json'),
        JSON.stringify({ timestamp: new Date().toISOString(), files: result.files, total: result.total || 0 }),
        'utf-8'
      );
    } catch {}

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message, raw: e.raw || '' });
  }
});

router.post('/run', async (req, res) => {
  try {
    if (isRunning()) return res.status(409).json({ error: 'Execution already in progress' });
    const { testIds, profileName, envFile, useDocker } = req.body;
    if (!testIds || !testIds.length) return res.status(400).json({ error: 'No tests selected' });
    const { projectPath, pytestCmd, seleniumRemoteUrl } = getConfig();
    if (!projectPath) return res.status(400).json({ error: 'Project path not configured' });
    const envVars = resolveEnvVars(profileName, envFile, projectPath);
    // Grid Selenium: inyecta SELENIUM_REMOTE_URL para que conftest use webdriver.Remote.
    // Vacío => conftest cae a Chrome local.
    if (seleniumRemoteUrl) envVars.SELENIUM_REMOTE_URL = seleniumRemoteUrl;
    const io = req.app.get('io');

    // Docker: si se pidió, levanta el grid Selenium y espera healthcheck ANTES de
    // correr los tests. Si falla (Docker cerrado, etc.) aborta con error claro.
    if (useDocker && seleniumRemoteUrl) {
      io.emit('execution:preparing', { message: 'Iniciando Selenium en Docker (esperando healthcheck)...' });
      try {
        await ensureGrid(io);
      } catch (e) {
        io.emit('execution:prepare-failed', { error: e.message });
        return res.status(500).json({ error: e.message });
      }
    }

    runTests(io, testIds, projectPath, pytestCmd, envVars);
    res.json({ success: true, message: `Starting ${testIds.length} tests sequentially` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/abort', (req, res) => {
  abortExecution();
  res.json({ success: true });
});

router.get('/status', (req, res) => {
  res.json({ running: isRunning() });
});

router.get('/file', (req, res) => {
  try {
    const { name } = req.query;
    if (!name) return res.status(400).json({ error: 'name requerido' });
    const { projectPath } = getConfig();
    if (!projectPath) return res.status(400).json({ error: 'Proyecto no configurado' });

    const filePath = path.resolve(projectPath, name);
    if (!filePath.startsWith(path.resolve(projectPath))) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado' });

    const content = fs.readFileSync(filePath, 'utf-8');
    const stats = fs.statSync(filePath);
    res.json({ content, path: filePath, size: stats.size, mtime: stats.mtime });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/file', (req, res) => {
  try {
    const { name, content } = req.body;
    if (!name) return res.status(400).json({ error: 'name requerido' });
    if (content === undefined || content === null) return res.status(400).json({ error: 'content requerido' });

    const { projectPath } = getConfig();
    if (!projectPath) return res.status(400).json({ error: 'Proyecto no configurado' });

    const filePath = path.resolve(projectPath, name);
    if (!filePath.startsWith(path.resolve(projectPath))) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado' });

    fs.writeFileSync(filePath, content, 'utf-8');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
