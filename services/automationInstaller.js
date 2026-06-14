const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function checkPython() {
  for (const cmd of ['python', 'python3']) {
    try {
      const out = execSync(`${cmd} --version`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      const match = (out + '').match(/Python (\d+\.\d+)/);
      if (match) return { ok: true, version: match[1], cmd };
    } catch {}
  }
  return { ok: false, error: 'Python no encontrado. Instalar desde python.org' };
}

function checkGit() {
  try {
    const out = execSync('git --version', { encoding: 'utf-8' });
    const match = out.match(/git version ([\d.]+)/);
    return { ok: true, version: match ? match[1] : 'instalado' };
  } catch {
    return { ok: false, error: 'Git no encontrado. Instalar desde git-scm.com' };
  }
}

function checkVenv(pythonCmd) {
  try {
    execSync(`${pythonCmd} -m venv --help`, { encoding: 'utf-8', stdio: 'pipe' });
    return { ok: true, type: 'venv (módulo built-in)' };
  } catch {}
  try {
    execSync('virtualenv --version', { encoding: 'utf-8' });
    return { ok: true, type: 'virtualenv' };
  } catch {
    return { ok: false, error: 'venv no disponible. Ejecutar: pip install virtualenv' };
  }
}

function checkAll() {
  const python = checkPython();
  const git = checkGit();
  const venv = python.ok
    ? checkVenv(python.cmd)
    : { ok: false, error: 'Requiere Python primero' };
  return { python, git, venv };
}

function runCommand(cmd, args, cwd, emit) {
  return new Promise((resolve, reject) => {
    const opts = { shell: process.platform === 'win32' };
    if (cwd) opts.cwd = cwd;
    const proc = spawn(cmd, args, opts);

    proc.stdout.on('data', d => {
      const text = d.toString().trim();
      if (text) text.split('\n').forEach(line => { if (line.trim()) emit(line.trim(), 'info'); });
    });
    proc.stderr.on('data', d => {
      const text = d.toString().trim();
      if (text) text.split('\n').forEach(line => { if (line.trim()) emit(line.trim(), 'info'); });
    });
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`Proceso terminó con código ${code}`));
    });
    proc.on('error', err => reject(new Error(`Error al ejecutar: ${err.message}`)));
  });
}

async function installAutomation(io, repoUrl, installPath) {
  const emit = (msg, type = 'info') => io.emit('automation:log', { message: msg, type });
  const prog = (percent, label, step) => io.emit('automation:progress', { percent, label, step });

  const checks = checkAll();
  if (!checks.python.ok) { io.emit('automation:failed', { error: checks.python.error }); return; }
  if (!checks.git.ok) { io.emit('automation:failed', { error: checks.git.error }); return; }
  if (!checks.venv.ok) { io.emit('automation:failed', { error: checks.venv.error }); return; }

  const pythonCmd = checks.python.cmd;

  try {
    // 1. Clone
    const hasGit = fs.existsSync(path.join(installPath, '.git'));
    const dirExists = fs.existsSync(installPath);

    if (dirExists && hasGit) {
      prog(10, 'Repositorio ya clonado — omitiendo', 'clone-skip');
      emit(`Repositorio git ya existe en: ${installPath}`, 'info');
      prog(30, 'Repositorio listo', 'clone-done');
    } else if (dirExists && !hasGit) {
      prog(5, 'Inicializando repositorio git...', 'clone');
      emit(`Directorio existe pero no es un repositorio git. Inicializando...`, 'info');
      await runCommand('git', ['init'], installPath, emit);
      await runCommand('git', ['remote', 'add', 'origin', repoUrl], installPath, emit);
      emit('Descargando repositorio remoto...', 'info');
      await runCommand('git', ['fetch', 'origin'], installPath, emit);
      await runCommand('git', ['checkout', '-b', 'main', '--track', 'origin/HEAD'], installPath, emit);
      emit('Repositorio inicializado exitosamente', 'success');
      prog(30, 'Repositorio listo', 'clone-done');
    } else {
      prog(5, 'Clonando repositorio...', 'clone');
      emit(`Clonando desde ${repoUrl}...`, 'info');
      await runCommand('git', ['clone', repoUrl, installPath], null, emit);
      emit('Repositorio clonado exitosamente', 'success');
      prog(30, 'Repositorio clonado', 'clone-done');
    }

    // 2. Virtual env
    const venvPath = path.join(installPath, 'venv');
    if (fs.existsSync(venvPath)) {
      prog(40, 'Entorno virtual existente — omitiendo', 'venv-skip');
      emit('Entorno virtual ya existe, omitiendo creación', 'info');
      prog(60, 'Entorno virtual listo', 'venv-done');
    } else {
      prog(35, 'Creando entorno virtual...', 'venv');
      emit('Creando entorno virtual...', 'info');
      await runCommand(pythonCmd, ['-m', 'venv', venvPath], installPath, emit);
      emit('Entorno virtual creado', 'success');
      prog(60, 'Entorno virtual creado', 'venv-done');
    }

    // 3. Install requirements
    const requirementsPath = path.join(installPath, 'requirements.txt');
    const pipCmd = process.platform === 'win32'
      ? path.join(venvPath, 'Scripts', 'pip.exe')
      : path.join(venvPath, 'bin', 'pip');

    if (!fs.existsSync(requirementsPath)) {
      prog(80, 'Sin requirements.txt — omitiendo instalación', 'deps-skip');
      emit('No se encontró requirements.txt — omitiendo instalación de paquetes', 'info');
      prog(95, 'Sin dependencias que instalar', 'deps-done');
    } else {
      prog(65, 'Instalando dependencias...', 'deps');
      emit('Instalando dependencias desde requirements.txt...', 'info');
      await runCommand(pipCmd, ['install', '-r', requirementsPath], installPath, emit);
      emit('Dependencias instaladas exitosamente', 'success');
      prog(95, 'Dependencias instaladas', 'deps-done');
    }

    const pytestCmd = process.platform === 'win32'
      ? path.join(venvPath, 'Scripts', 'pytest.exe')
      : path.join(venvPath, 'bin', 'pytest');

    prog(100, '¡Instalación completada!', 'done');
    emit('¡Instalación completada!', 'success');
    io.emit('automation:done', { projectPath: installPath, pytestCmd });
  } catch (e) {
    emit(e.message, 'error');
    io.emit('automation:failed', { error: e.message });
  }
}

module.exports = { checkAll, installAutomation };
