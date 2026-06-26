const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { checkAll, installAutomation, createVenv, installDeps } = require('../services/automationInstaller');
const { resetProjectData, samePath } = require('../services/projectData');
const { spawn } = require('child_process');

const AUTO_CONFIG_PATH = path.join(__dirname, '..', 'automation-config.json');
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const DEFAULT_INSTALL_PATH = path.join(__dirname, '..', '..', 'automation');

function readAutoConfig() {
  const defaults = { repoUrl: '', installPath: DEFAULT_INSTALL_PATH };
  if (!fs.existsSync(AUTO_CONFIG_PATH)) return defaults;
  return { ...defaults, ...JSON.parse(fs.readFileSync(AUTO_CONFIG_PATH, 'utf-8')) };
}

function writeAutoConfig(data) {
  fs.writeFileSync(AUTO_CONFIG_PATH, JSON.stringify(data, null, 2));
}

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function writeConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
}

router.get('/config', (req, res) => {
  res.json(readAutoConfig());
});

router.post('/config', (req, res) => {
  try {
    const { repoUrl, installPath } = req.body;
    writeAutoConfig({ repoUrl, installPath });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/check', (req, res) => {
  try {
    res.json(checkAll());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

let installing = false;
let pulling = false;

router.post('/install', async (req, res) => {
  if (installing) return res.status(409).json({ error: 'Instalación ya en progreso' });

  const { repoUrl, installPath } = req.body;
  if (!repoUrl) return res.status(400).json({ error: 'repoUrl requerido' });
  if (!installPath) return res.status(400).json({ error: 'installPath requerido' });
  if (installPath.includes('..')) return res.status(400).json({ error: 'Ruta inválida' });
  if (!repoUrl.startsWith('https://') && !repoUrl.startsWith('git@')) {
    return res.status(400).json({ error: 'URL de repositorio inválida' });
  }

  const io = req.app.get('io');
  installing = true;
  res.json({ started: true });

  installAutomation(io, repoUrl, installPath)
    .catch(err => {
      // Red de seguridad: cualquier error no controlado siempre llega al usuario
      io.emit('automation:log', { message: err.message, type: 'error' });
      io.emit('automation:failed', { error: err.message });
    })
    .finally(() => { installing = false; });
});

router.post('/update', async (req, res) => {
  if (pulling) return res.status(409).json({ error: 'Actualización ya en progreso' });

  const { installPath, branch } = req.body;
  if (!installPath) return res.status(400).json({ error: 'installPath requerido' });
  if (installPath.includes('..')) return res.status(400).json({ error: 'Ruta inválida' });
  if (!fs.existsSync(installPath)) return res.status(400).json({ error: 'Directorio no existe. Instala primero.' });
  if (!fs.existsSync(path.join(installPath, '.git'))) {
    return res.status(400).json({ error: 'No es un repositorio git válido.' });
  }

  const targetBranch = (branch || 'develop').replace(/[^a-zA-Z0-9/_.\-]/g, '');
  if (!targetBranch) return res.status(400).json({ error: 'Nombre de rama inválido' });

  const io = req.app.get('io');
  pulling = true;
  res.json({ started: true });

  const emit = (msg, type = 'info') => io.emit('automation:log', { message: msg, type });
  const prog = (percent, label, step) => io.emit('automation:update-progress', { percent, label, step });

  prog(5, 'Conectando con repositorio remoto...', 'connect');
  emit(`Iniciando git pull origin ${targetBranch}...`, 'info');

  const opts = { shell: process.platform === 'win32', cwd: installPath };
  const proc = spawn('git', ['pull', 'origin', targetBranch], opts);

  let phase = 'connect';

  function processLine(line) {
    if (!line) return;
    emit(line, 'info');

    if (phase === 'connect' && line.includes('remote:')) {
      prog(20, 'Conectando con repositorio remoto...', 'connect');
    }
    if (phase === 'connect' && (line.includes('Receiving objects') || line.includes('Unpacking objects'))) {
      phase = 'download';
      prog(35, 'Descargando cambios...', 'download');
    }
    if (phase === 'download' && line.match(/Receiving objects:\s+\d+%/)) {
      const m = line.match(/(\d+)%/);
      if (m) prog(35 + Math.round(parseInt(m[1]) * 0.35), 'Descargando cambios...', 'download');
    }
    if (phase === 'download' && line.includes('Resolving deltas')) {
      phase = 'apply';
      prog(75, 'Aplicando cambios...', 'apply');
    }
    if ((line.includes('Updating ') || line.includes('Fast-forward') || line.includes('Already up to date')) && phase !== 'apply') {
      phase = 'apply';
      prog(85, 'Aplicando cambios...', 'apply');
    }
  }

  proc.stdout.on('data', d => d.toString().split('\n').forEach(l => processLine(l.trim())));
  proc.stderr.on('data', d => d.toString().split('\n').forEach(l => processLine(l.trim())));

  proc.on('close', code => {
    pulling = false;
    if (code === 0) {
      prog(100, 'Repositorio actualizado exitosamente', 'done');
      emit('Repositorio actualizado exitosamente', 'success');
      io.emit('automation:update-done');
    } else {
      emit(`git pull falló con código ${code}`, 'error');
      io.emit('automation:update-failed', { error: `git pull falló con código ${code}` });
    }
  });
  proc.on('error', err => {
    pulling = false;
    emit(err.message, 'error');
    io.emit('automation:update-failed', { error: err.message });
  });
});

// Lista las ramas remotas reales del repositorio clonado (git branch -r).
router.get('/branches', (req, res) => {
  const installPath = req.query.installPath;
  if (!installPath || installPath.includes('..')) {
    return res.status(400).json({ error: 'installPath inválido' });
  }
  if (!fs.existsSync(path.join(installPath, '.git'))) {
    return res.status(400).json({ error: 'No es un repositorio git válido.' });
  }

  const opts = {
    shell: process.platform === 'win32',
    cwd: installPath,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  };
  const proc = spawn('git', ['branch', '-r', '--format=%(refname:short)'], opts);

  let out = '', err = '', done = false;
  const finish = (fn) => { if (!done) { done = true; clearTimeout(timer); fn(); } };
  const timer = setTimeout(() => {
    try { proc.kill(); } catch {}
    finish(() => res.status(504).json({ error: 'Tiempo agotado listando ramas' }));
  }, 15000);

  proc.stdout.on('data', d => out += d.toString());
  proc.stderr.on('data', d => err += d.toString());
  proc.on('close', code => finish(() => {
    if (code !== 0) return res.status(500).json({ error: err.trim() || 'git branch falló' });
    const branches = [...new Set(
      out.split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .filter(l => !l.includes('->'))        // excluye 'origin/HEAD -> origin/main'
        .map(l => l.replace(/^origin\//, ''))  // origin/main -> main
        .filter(b => b && b !== 'HEAD')
    )];
    res.json({ branches });
  }));
  proc.on('error', e => finish(() => res.status(500).json({ error: e.message })));
});

router.get('/status', (req, res) => {
  res.json({ installing, pulling, envBusy });
});

// ── Preparar entorno Python de un proyecto existente (sin clonar) ──
let envBusy = false;

function resolveProjectPath(req) {
  const fromBody = req.body && req.body.projectPath;
  if (fromBody) return fromBody;
  try { return readConfig().projectPath || ''; } catch { return ''; }
}

router.post('/setup-venv', (req, res) => {
  if (envBusy) return res.status(409).json({ error: 'Operación de entorno ya en progreso' });
  const projectPath = resolveProjectPath(req);
  if (!projectPath) return res.status(400).json({ error: 'Proyecto no configurado' });

  const io = req.app.get('io');
  envBusy = true;
  res.json({ started: true });

  createVenv(io, projectPath)
    .catch(err => {
      io.emit('env:log', { message: err.message, type: 'error' });
      io.emit('env:failed', { error: err.message });
    })
    .finally(() => { envBusy = false; });
});

router.post('/setup-deps', (req, res) => {
  if (envBusy) return res.status(409).json({ error: 'Operación de entorno ya en progreso' });
  const projectPath = resolveProjectPath(req);
  if (!projectPath) return res.status(400).json({ error: 'Proyecto no configurado' });

  const io = req.app.get('io');
  envBusy = true;
  res.json({ started: true });

  installDeps(io, projectPath)
    .catch(err => {
      io.emit('env:log', { message: err.message, type: 'error' });
      io.emit('env:failed', { error: err.message });
    })
    .finally(() => { envBusy = false; });
});

router.get('/install-status', (req, res) => {
  try {
    const installPath = req.query.installPath;
    if (!installPath || installPath.includes('..')) {
      return res.json({ checked: false });
    }

    const repoCloned = fs.existsSync(path.join(installPath, '.git'));
    const venvCreated = fs.existsSync(path.join(installPath, 'venv'));
    const pytestBin = process.platform === 'win32'
      ? path.join(installPath, 'venv', 'Scripts', 'pytest.exe')
      : path.join(installPath, 'venv', 'bin', 'pytest');
    const depsInstalled = fs.existsSync(pytestBin);
    const hasRequirements = fs.existsSync(path.join(installPath, 'requirements.txt'));

    res.json({
      checked: true,
      repoCloned,
      venvCreated,
      depsInstalled,
      hasRequirements,
      fullyInstalled: repoCloned && venvCreated && depsInstalled
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/apply', (req, res) => {
  try {
    const { projectPath, pytestCmd } = req.body;
    const config = readConfig();

    const prevProjectPath = config.projectPath || '';
    const projectChanged = !samePath(prevProjectPath, projectPath);

    config.projectPath = projectPath;
    config.pytestCmd = pytestCmd;
    writeConfig(config);

    let reset = null;
    if (projectChanged && prevProjectPath) {
      reset = resetProjectData();
    }

    res.json({ success: true, projectChanged, reset });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
