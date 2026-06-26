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

// Valida la librería virtualenv (obligatoria para crear el entorno).
// Prioriza `python -m virtualenv` (mismo intérprete); cae a `virtualenv` en PATH.
function checkVirtualenv(pythonCmd) {
  try {
    const out = execSync(`${pythonCmd} -m virtualenv --version`, { encoding: 'utf-8', stdio: 'pipe' });
    const m = (out + '').match(/([\d.]+)/);
    return { ok: true, type: m ? `virtualenv ${m[1]}` : 'virtualenv', runner: [pythonCmd, '-m', 'virtualenv'] };
  } catch {}
  try {
    const out = execSync('virtualenv --version', { encoding: 'utf-8', stdio: 'pipe' });
    const m = (out + '').match(/([\d.]+)/);
    return { ok: true, type: m ? `virtualenv ${m[1]}` : 'virtualenv', runner: ['virtualenv'] };
  } catch {
    return { ok: false, error: 'virtualenv no instalado. Ejecutar: pip install virtualenv' };
  }
}

// Valida que el repositorio remoto exista y sea accesible (sin clonar).
// ASÍNCRONO: spawn no bloquea el event loop (execSync sí lo congelaría y
// detendría los emits de Socket.io). Prompts de credenciales desactivados
// + timeout duro para que NUNCA se cuelgue esperando login.
function checkRepoExists(repoUrl) {
  return new Promise((resolve) => {
    const opts = {
      shell: process.platform === 'win32',
      // stdio ignore: solo importa el exit code. Si NO se drena stdout y el repo
      // tiene muchos refs (>64KB, p.ej. octocat/Hello-World), git se bloquea
      // escribiendo en el pipe lleno y 'close' nunca dispara → cuelgue.
      stdio: 'ignore',
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',   // no prompt en terminal
        GCM_INTERACTIVE: 'Never'    // Git Credential Manager: sin popup
      }
    };
    // --heads --tags limita la salida; -c credential.guiPrompt=false evita ventana de login
    const proc = spawn('git', ['-c', 'credential.guiPrompt=false', 'ls-remote', '--heads', repoUrl], opts);

    let done = false;
    const finish = (result) => { if (!done) { done = true; clearTimeout(timer); resolve(result); } };

    const timer = setTimeout(() => {
      try { proc.kill(); } catch {}
      finish({ ok: false, error: 'Tiempo de espera agotado verificando el repositorio remoto. Revisa la URL y tus credenciales.' });
    }, 20000);

    proc.on('close', code => {
      finish(code === 0
        ? { ok: true }
        : { ok: false, error: 'Repositorio remoto no accesible. Verifica la URL y tus credenciales.' });
    });
    proc.on('error', err => finish({ ok: false, error: `No se pudo ejecutar git: ${err.message}` }));
  });
}

// Normaliza una URL git para comparar (ignora .git final, slash y mayúsculas).
function normalizeRepoUrl(url) {
  return (url || '')
    .trim()
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

// Lee la URL del remote origin de un repo local. null si no tiene.
function getRemoteOrigin(repoPath) {
  try {
    const out = execSync('git config --get remote.origin.url', {
      cwd: repoPath, encoding: 'utf-8', stdio: 'pipe'
    });
    return (out || '').trim() || null;
  } catch {
    return null;
  }
}

// Docker: binario + daemon. Distingue "no instalado" de "instalado pero
// Docker Desktop apagado" (este último es accionable → botón para arrancarlo).
function checkDocker() {
  let version = null;
  try {
    const out = execSync('docker --version', { encoding: 'utf-8', stdio: 'pipe' });
    const m = (out + '').match(/Docker version ([\d.]+)/);
    version = m ? m[1] : 'instalado';
  } catch {
    return { ok: false, installed: false, daemonRunning: false, error: 'Docker no encontrado. Instala Docker Desktop.' };
  }
  try {
    execSync('docker info --format "{{.ServerVersion}}"', { encoding: 'utf-8', stdio: 'pipe' });
    return { ok: true, installed: true, daemonRunning: true, version };
  } catch {
    return { ok: false, installed: true, daemonRunning: false, version, error: 'Docker instalado, pero Docker Desktop no está corriendo. Ábrelo.' };
  }
}

function checkAll() {
  const python = checkPython();
  const git = checkGit();
  const venv = python.ok
    ? checkVirtualenv(python.cmd)
    : { ok: false, error: 'Requiere Python primero' };
  const docker = checkDocker();
  return { python, git, venv, docker };
}

// Con shell:true en Windows los argumentos se re-parsean por cmd.exe; las rutas
// con espacios (p.ej. "Nueva carpeta\venv") se parten. Citamos lo necesario.
function quoteIfNeeded(s) {
  s = String(s);
  if (/\s/.test(s) && !/^".*"$/.test(s)) return `"${s}"`;
  return s;
}

function runCommand(cmd, args, cwd, emit) {
  return new Promise((resolve, reject) => {
    const useShell = process.platform === 'win32';
    const opts = { shell: useShell };
    if (cwd) opts.cwd = cwd;
    const realCmd  = useShell ? quoteIfNeeded(cmd) : cmd;
    const realArgs = useShell ? args.map(quoteIfNeeded) : args;
    const proc = spawn(realCmd, realArgs, opts);

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

  // ── Validaciones previas (todas deben pasar antes de tocar el disco) ──
  prog(2, 'Validando requisitos del sistema...', 'validate');
  emit('Validando Git, Python y virtualenv...', 'info');

  const checks = checkAll();
  if (!checks.git.ok)    { emit(checks.git.error, 'error');    io.emit('automation:failed', { error: checks.git.error }); return; }
  emit(`Git detectado: ${checks.git.version}`, 'success');
  if (!checks.python.ok) { emit(checks.python.error, 'error'); io.emit('automation:failed', { error: checks.python.error }); return; }
  emit(`Python detectado: ${checks.python.version}`, 'success');
  if (!checks.venv.ok)   { emit(checks.venv.error, 'error');   io.emit('automation:failed', { error: checks.venv.error }); return; }
  emit(`${checks.venv.type} detectado`, 'success');

  const pythonCmd  = checks.python.cmd;
  const venvRunner = checks.venv.runner; // p.ej. ['python','-m','virtualenv']

  try {
    // 1. Clone
    const hasGit = fs.existsSync(path.join(installPath, '.git'));
    const dirExists = fs.existsSync(installPath);

    if (dirExists && hasGit) {
      // Hay un .git, pero ¿es EL repo correcto? Comparar origin con repoUrl.
      const origin = getRemoteOrigin(installPath);
      if (origin && normalizeRepoUrl(origin) !== normalizeRepoUrl(repoUrl)) {
        const msg = `El directorio destino ya es OTRO repositorio git (origin: ${origin}). ` +
          `No se clonará encima. Elige una carpeta vacía o una subcarpeta nueva para este repo.`;
        emit(msg, 'error');
        io.emit('automation:failed', { error: msg });
        return;
      }
      if (!origin) {
        const msg = `El directorio destino ya contiene un repo git sin remote 'origin'. ` +
          `Elige una carpeta vacía o una subcarpeta nueva para clonar este repo.`;
        emit(msg, 'error');
        io.emit('automation:failed', { error: msg });
        return;
      }
      // Origin correcto, pero ¿es un clon completo (con HEAD/archivos) o uno parcial roto?
      let hasHead = false;
      try { execSync('git rev-parse --verify HEAD', { cwd: installPath, stdio: 'pipe' }); hasHead = true; } catch {}
      if (!hasHead) {
        const msg = `El directorio destino tiene un clon incompleto/roto (sin archivos). ` +
          `Vacía la carpeta "${installPath}" (borra su contenido, incluido .git) y reinténtalo.`;
        emit(msg, 'error');
        io.emit('automation:failed', { error: msg });
        return;
      }
      prog(10, 'Repositorio ya clonado — omitiendo', 'clone-skip');
      emit(`Repositorio correcto ya existe en: ${installPath} (origin: ${origin})`, 'info');
      prog(30, 'Repositorio listo', 'clone-done');
    } else if (dirExists && !hasGit) {
      // El directorio existe pero no es repo. Solo permitir si está VACÍO,
      // para no clonar encima de archivos ajenos.
      const entries = fs.readdirSync(installPath);
      if (entries.length > 0) {
        const msg = `El directorio destino no está vacío y no es un repositorio git: ${installPath}. ` +
          `Elige una carpeta vacía o una subcarpeta nueva para clonar el repo.`;
        emit(msg, 'error');
        io.emit('automation:failed', { error: msg });
        return;
      }
      // Validar repo remoto antes de clonar
      emit('Verificando acceso al repositorio remoto...', 'info');
      const repoCheck = await checkRepoExists(repoUrl);
      if (!repoCheck.ok) { emit(repoCheck.error, 'error'); io.emit('automation:failed', { error: repoCheck.error }); return; }
      emit('Repositorio remoto accesible', 'success');
      prog(5, 'Clonando repositorio...', 'clone');
      emit(`Clonando desde ${repoUrl} en carpeta vacía...`, 'info');
      // git clone funciona dentro de un directorio vacío existente y detecta
      // la rama por defecto automáticamente (sin el frágil baile init/fetch/checkout).
      await runCommand('git', ['clone', repoUrl, '.'], installPath, emit);
      emit('Repositorio clonado exitosamente', 'success');
      prog(30, 'Repositorio listo', 'clone-done');
    } else {
      // Validar repo remoto antes de clonar
      emit('Verificando acceso al repositorio remoto...', 'info');
      const repoCheck = await checkRepoExists(repoUrl);
      if (!repoCheck.ok) { emit(repoCheck.error, 'error'); io.emit('automation:failed', { error: repoCheck.error }); return; }
      emit('Repositorio remoto accesible', 'success');
      prog(5, 'Clonando repositorio...', 'clone');
      emit(`Clonando desde ${repoUrl}...`, 'info');
      await runCommand('git', ['clone', repoUrl, installPath], null, emit);
      emit('Repositorio clonado exitosamente', 'success');
      prog(30, 'Repositorio clonado', 'clone-done');
    }

    // 2. Entorno virtual — siempre llamado "venv", creado con virtualenv
    const venvPath = path.join(installPath, 'venv');
    if (fs.existsSync(venvPath)) {
      prog(40, 'Entorno virtual existente — omitiendo', 'venv-skip');
      emit('Entorno virtual "venv" ya existe, omitiendo creación', 'info');
      prog(60, 'Entorno virtual listo', 'venv-done');
    } else {
      prog(35, 'Creando entorno virtual...', 'venv');
      emit(`Creando entorno virtual "venv" con ${checks.venv.type}...`, 'info');
      // p.ej. python -m virtualenv <installPath>/venv
      await runCommand(venvRunner[0], [...venvRunner.slice(1), venvPath], installPath, emit);
      emit('Entorno virtual "venv" creado', 'success');
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

    // Ruta RELATIVA al venv (siempre llamado "venv"). pytest se ejecuta con
    // cwd = projectPath, así que esta ruta resuelve y evita problemas de
    // espacios en la ruta absoluta del proyecto.
    const pytestCmd = process.platform === 'win32'
      ? '.\\venv\\Scripts\\pytest.exe'
      : './venv/bin/pytest';

    prog(100, '¡Instalación completada!', 'done');
    emit('¡Instalación completada!', 'success');
    io.emit('automation:done', { projectPath: installPath, pytestCmd });
  } catch (e) {
    emit(e.message, 'error');
    io.emit('automation:failed', { error: e.message });
  }
}

// Asegura que la librería virtualenv esté disponible; si falta, la instala con pip.
async function ensureVirtualenv(pythonCmd, emit) {
  let venv = checkVirtualenv(pythonCmd);
  if (venv.ok) return venv;
  emit('virtualenv no encontrado. Instalando con pip...', 'info');
  await runCommand(pythonCmd, ['-m', 'pip', 'install', 'virtualenv'], null, emit);
  venv = checkVirtualenv(pythonCmd);
  if (!venv.ok) {
    throw new Error('No se pudo instalar virtualenv automáticamente. Ejecuta manualmente: pip install virtualenv');
  }
  emit('virtualenv instalado correctamente', 'success');
  return venv;
}

// Prepara el entorno de un proyecto YA EXISTENTE (sin clonar):
// valida Python → asegura virtualenv → crea el venv "venv".
async function createVenv(io, projectPath) {
  const emit = (msg, type = 'info') => io.emit('env:log', { message: msg, type });
  const prog = (percent, label) => io.emit('env:progress', { percent, label });
  try {
    if (!projectPath || !fs.existsSync(projectPath)) {
      const msg = 'La ruta del proyecto no es válida o no existe.';
      emit(msg, 'error'); io.emit('env:failed', { error: msg }); return;
    }

    prog(5, 'Validando Python...');
    const python = checkPython();
    if (!python.ok) { emit(python.error, 'error'); io.emit('env:failed', { error: python.error }); return; }
    emit(`Python detectado: ${python.version}`, 'success');

    prog(20, 'Verificando virtualenv...');
    const venv = await ensureVirtualenv(python.cmd, emit);
    emit(`${venv.type} disponible`, 'success');

    const venvPath = path.join(projectPath, 'venv');
    if (fs.existsSync(venvPath)) {
      emit('El entorno virtual "venv" ya existe — se reutiliza.', 'info');
      prog(100, 'Entorno virtual listo');
      io.emit('env:venv-done', { exists: true });
      return;
    }

    prog(50, 'Creando entorno virtual...');
    emit(`Creando entorno virtual "venv" con ${venv.type}...`, 'info');
    await runCommand(venv.runner[0], [...venv.runner.slice(1), venvPath], projectPath, emit);
    emit('Entorno virtual "venv" creado', 'success');
    prog(100, 'Entorno virtual creado');
    io.emit('env:venv-done', { exists: false });
  } catch (e) {
    emit(e.message, 'error');
    io.emit('env:failed', { error: e.message });
  }
}

// Instala las dependencias de requirements.txt usando el pip del venv del proyecto.
async function installDeps(io, projectPath) {
  const emit = (msg, type = 'info') => io.emit('env:log', { message: msg, type });
  const prog = (percent, label) => io.emit('env:progress', { percent, label });
  try {
    if (!projectPath || !fs.existsSync(projectPath)) {
      const msg = 'La ruta del proyecto no es válida o no existe.';
      emit(msg, 'error'); io.emit('env:failed', { error: msg }); return;
    }
    const venvPath = path.join(projectPath, 'venv');
    if (!fs.existsSync(venvPath)) {
      const msg = 'No existe el entorno virtual "venv". Créalo primero.';
      emit(msg, 'error'); io.emit('env:failed', { error: msg }); return;
    }

    const requirementsPath = path.join(projectPath, 'requirements.txt');
    const pipCmd = process.platform === 'win32'
      ? path.join(venvPath, 'Scripts', 'pip.exe')
      : path.join(venvPath, 'bin', 'pip');

    if (!fs.existsSync(requirementsPath)) {
      emit('No se encontró requirements.txt — no hay dependencias que instalar.', 'info');
      prog(100, 'Sin requirements.txt');
      io.emit('env:deps-done', { skipped: true });
      return;
    }

    prog(10, 'Instalando dependencias...');
    emit('Instalando dependencias desde requirements.txt...', 'info');
    await runCommand(pipCmd, ['install', '-r', requirementsPath], projectPath, emit);
    emit('Dependencias instaladas exitosamente', 'success');
    prog(100, 'Dependencias instaladas');
    io.emit('env:deps-done', { skipped: false });
  } catch (e) {
    emit(e.message, 'error');
    io.emit('env:failed', { error: e.message });
  }
}

module.exports = { checkAll, installAutomation, createVenv, installDeps };
