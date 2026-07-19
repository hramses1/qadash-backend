const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { collectTests } = require('../services/testCollector');
const { runTests, abortExecution, isRunning } = require('../services/pytestRunner');
const { readEnv } = require('../services/envManager');
const { getEntorno } = require('../services/profileManager');
const { ensureGrid } = require('../services/dockerRunner');

function getConfig(req) {
  return JSON.parse(fs.readFileSync(req.profile.config, 'utf-8'));
}

function resolveEnvVars(req, entornoName, envFile, projectPath) {
  if (entornoName) {
    const vars = getEntorno(req.profile.entornos, entornoName);
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
  const cachePath = req.profile.collection;
  if (!fs.existsSync(cachePath)) return res.json({ files: {}, total: 0, timestamp: null });
  try {
    res.json(JSON.parse(fs.readFileSync(cachePath, 'utf-8')));
  } catch {
    res.json({ files: {}, total: 0, timestamp: null });
  }
});

router.get('/collect', async (req, res) => {
  try {
    const { projectPath, pytestCmd } = getConfig(req);
    if (!projectPath) return res.status(400).json({ error: 'Project path not configured' });
    const result = await collectTests(projectPath, pytestCmd);

    // Persist collection so analytics can cross-reference unexecuted tests
    try {
      const dataDir = req.profile.dataDir;
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(
        req.profile.collection,
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
    if (isRunning(req.profile.id)) return res.status(409).json({ error: 'Execution already in progress' });
    const { testIds, profileName, envFile, useDocker, params, paramsByTest } = req.body;
    if (!testIds || !testIds.length) return res.status(400).json({ error: 'No tests selected' });
    const { projectPath, pytestCmd, seleniumRemoteUrl, envPath } = getConfig(req);
    if (!projectPath) return res.status(400).json({ error: 'Project path not configured' });
    let envVars = resolveEnvVars(req, profileName, envFile, projectPath);
    // Sin perfil/envFile explícito: usa el .env configurado como base, así los
    // params vacíos del modal caen al valor real del .env del proyecto.
    if (Object.keys(envVars).length === 0 && envPath && fs.existsSync(envPath)) {
      envVars = Object.fromEntries(
        readEnv(envPath).filter(v => !v.isComment && v.key).map(v => [v.key, v.value])
      );
    }
    // Overrides puntuales del usuario (modal de ejecución). Solo valores no vacíos
    // pisan al .env/perfil; lo vacío deja que el test use su valor del .env.
    if (params && typeof params === 'object') {
      for (const [k, v] of Object.entries(params)) {
        if (k && v !== undefined && v !== null && String(v).trim() !== '') {
          envVars[String(k).trim()] = String(v);
        }
      }
    }
    // Grid Selenium: inyecta SELENIUM_REMOTE_URL para que conftest use webdriver.Remote.
    // Vacío => conftest cae a Chrome local.
    if (seleniumRemoteUrl) envVars.SELENIUM_REMOTE_URL = seleniumRemoteUrl;
    const io = req.app.get('io');

    // Docker: si se pidió, levanta el grid Selenium y espera healthcheck ANTES de
    // correr los tests. Si falla (Docker cerrado, etc.) aborta con error claro.
    if (useDocker && seleniumRemoteUrl) {
      io.to(`profile:${req.profile.id}`).emit('execution:preparing', { message: 'Iniciando Selenium en Docker (esperando healthcheck)...' });
      try {
        await ensureGrid(io, req.profile);
      } catch (e) {
        io.to(`profile:${req.profile.id}`).emit('execution:prepare-failed', { error: e.message });
        return res.status(500).json({ error: e.message });
      }
    }

    // Sanea paramsByTest: { testId: { KEY: 'val' } } solo con valores no vacíos.
    const cleanPerTest = {};
    if (paramsByTest && typeof paramsByTest === 'object') {
      for (const [id, kv] of Object.entries(paramsByTest)) {
        if (!kv || typeof kv !== 'object') continue;
        const o = {};
        for (const [k, v] of Object.entries(kv)) {
          if (k && v !== undefined && v !== null && String(v).trim() !== '') o[String(k).trim()] = String(v);
        }
        if (Object.keys(o).length) cleanPerTest[id] = o;
      }
    }

    runTests(io, req.profile.id, testIds, projectPath, pytestCmd, envVars, cleanPerTest, req.profile.reportsDir);
    res.json({ success: true, message: `Starting ${testIds.length} tests sequentially` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/abort', (req, res) => {
  abortExecution(req.profile.id);
  res.json({ success: true });
});

router.get('/status', (req, res) => {
  res.json({ running: isRunning(req.profile.id) });
});

router.get('/file', (req, res) => {
  try {
    const { name } = req.query;
    if (!name) return res.status(400).json({ error: 'name requerido' });
    const { projectPath } = getConfig(req);
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

    const { projectPath } = getConfig(req);
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
