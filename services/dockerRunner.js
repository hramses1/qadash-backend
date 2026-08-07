const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const runtime = require('./runtimeRegistry');
const {
  IS_WIN, IS_MAC, DOCKER_APP, INSTALL_HINT, RUNNING_QUESTION, GROUP_HINT,
  isSocketPermissionError, dockerFailHint,
} = require('./dockerEnv');

// Estado por perfil: cada perfil corre compose en paralelo con nombre de
// proyecto namespaced (`-p qadash-<id>`) para no pisar contenedores de otro.
const state = new Map(); // profileId -> { running, currentProc, currentAction }

function _state(profileId) {
  if (!state.has(profileId)) state.set(profileId, { running: false, currentProc: null, currentAction: null });
  return state.get(profileId);
}

// Nombre de proyecto compose por perfil → aísla contenedores/redes/volúmenes.
function projectName(profile) {
  return `qadash-${profile.id}`;
}

// Argumentos de compose namespaced: docker compose -p qadash-<id> <tail...>
function composeArgs(profile, tail) {
  return ['compose', '-p', projectName(profile), ...tail];
}

// Tails de acciones (sin el prefijo `compose -p <name>`).
const ACTION_TAILS = {
  'up-build':    ['up', '--build', '--abort-on-container-exit'],
  'up-selenium': ['up', '-d', '--wait', 'selenium'],
  'rebuild':     ['up', '--build', '--force-recreate', '--abort-on-container-exit'],
  'down':        ['down'],
  'down-all':    ['down', '--remove-orphans'],
};

function isRunning(profileId) {
  const s = state.get(profileId);
  return !!(s && s.running);
}

function status(profile) {
  const s = _state(profile.id);
  return { running: s.running, action: s.currentAction };
}

function readProjectPath(profile) {
  try {
    const cfg = JSON.parse(fs.readFileSync(profile.config, 'utf-8'));
    return cfg.projectPath || '';
  } catch {
    return '';
  }
}

function hasCompose(projectPath) {
  return fs.existsSync(path.join(projectPath, 'docker-compose.yml')) ||
         fs.existsSync(path.join(projectPath, 'docker-compose.yaml')) ||
         fs.existsSync(path.join(projectPath, 'compose.yml')) ||
         fs.existsSync(path.join(projectPath, 'compose.yaml'));
}

function projectStatus(profile) {
  return new Promise(resolve => {
    const projectPath = readProjectPath(profile);
    if (!projectPath || !fs.existsSync(projectPath) || !hasCompose(projectPath)) {
      return resolve({ count: 0 });
    }
    const shell = process.platform === 'win32';
    const proc = spawn('docker', composeArgs(profile, ['ps', '-q']), { cwd: projectPath, shell });
    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.on('error', () => resolve({ count: 0 }));
    proc.on('close', () => {
      const ids = out.split('\n').map(s => s.trim()).filter(Boolean);
      resolve({ count: ids.length });
    });
  });
}

function gridStatus(profile) {
  return new Promise(resolve => {
    const projectPath = readProjectPath(profile);
    if (!projectPath || !fs.existsSync(projectPath) || !hasCompose(projectPath)) {
      return resolve({ up: false });
    }
    const shell = process.platform === 'win32';
    const proc = spawn('docker', composeArgs(profile, ['ps', '-q', 'selenium']), { cwd: projectPath, shell });
    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.on('error', () => resolve({ up: false }));
    proc.on('close', () => resolve({ up: out.trim().length > 0 }));
  });
}

// Verifica que Docker exista y el daemon responda (docker info).
function checkDocker() {
  return new Promise((resolve) => {
    const shell = process.platform === 'win32';
    const notFound = `Docker no encontrado. ${INSTALL_HINT}`;
    const ver = spawn('docker', ['--version'], { shell });
    let out = '';
    ver.stdout.on('data', d => { out += d.toString(); });
    ver.on('error', () => resolve({ ok: false, error: notFound }));
    ver.on('close', code => {
      if (code !== 0) return resolve({ ok: false, error: notFound });
      const version = out.trim();
      const info = spawn('docker', ['info', '--format', '{{.ServerVersion}}'], { shell });
      let derr = '';
      info.stderr.on('data', d => { derr += d.toString(); });
      info.on('error', () => resolve({ ok: false, version, error: `Docker instalado pero el daemon no responde. ${RUNNING_QUESTION}` }));
      info.on('close', c => {
        if (c === 0) return resolve({ ok: true, version });
        // El daemon puede estar arriba y aun asi fallar por permisos de socket:
        // distinguirlo evita mandar al usuario a "arrancar" algo ya arrancado.
        if (isSocketPermissionError(derr)) {
          return resolve({ ok: false, version, permission: true, error: GROUP_HINT });
        }
        resolve({ ok: false, version, error: `${DOCKER_APP} no está corriendo. Arráncalo y reintenta.` });
      });
    });
  });
}

// Lista los contenedores Docker en ejecución (todos, no solo del proyecto).
function listContainers() {
  return new Promise(resolve => {
    const shell = process.platform === 'win32';
    const SEP = '@@@';
    const fmt = ['{{.Names}}', '{{.Image}}', '{{.Status}}', '{{.Ports}}'].join(SEP);
    const proc = spawn('docker', ['ps', '--format', fmt], { shell });
    let out = '', err = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('error', () => resolve({ ok: false, error: `Docker no disponible. ${RUNNING_QUESTION}`, containers: [] }));
    proc.on('close', code => {
      if (code !== 0) {
        const detail = err.trim();
        return resolve({
          ok: false,
          error: isSocketPermissionError(detail) ? GROUP_HINT : (detail || 'docker ps falló'),
          containers: [],
        });
      }
      const containers = out.split('\n').map(l => l.trimEnd()).filter(Boolean).map(line => {
        const [name, image, status, ports] = line.split(SEP);
        return { name, image, status, ports: ports || '' };
      });
      resolve({ ok: true, containers });
    });
  });
}

// Lanza una acción de compose (namespaced por perfil) y transmite la salida a
// la sala del perfil. Resuelve con el código de salida.
function run(io, profile, action) {
  return new Promise((resolve, reject) => {
    const s = _state(profile.id);
    if (s.running) return reject(new Error('Ya hay una operación Docker en curso'));

    const tail = ACTION_TAILS[action];
    if (!tail) return reject(new Error(`Acción Docker inválida: ${action}`));

    const projectPath = readProjectPath(profile);
    if (!projectPath) return reject(new Error('projectPath no configurado. Configúralo en Ajustes.'));
    if (!fs.existsSync(projectPath)) return reject(new Error(`El proyecto no existe: ${projectPath}`));
    if (!hasCompose(projectPath)) return reject(new Error('No se encontró docker-compose.yml en el proyecto.'));

    const args = composeArgs(profile, tail);
    s.running = true;
    s.currentAction = action;
    runtime.start(io, profile.id, 'docker');

    const room = `profile:${profile.id}`;
    const emit = (message, type = 'info') => io.to(room).emit('docker:log', { message, type, profileId: profile.id });
    io.to(room).emit('docker:started', { action, profileId: profile.id });
    emit(`$ docker ${args.join(' ')}  (cwd: ${projectPath})`, 'cmd');

    const proc = spawn('docker', args, { cwd: projectPath, shell: process.platform === 'win32' });
    s.currentProc = proc;
    let errBuf = '';

    proc.stdout.on('data', d => d.toString().split('\n').forEach(l => { if (l.trim()) emit(l.trim()); }));
    proc.stderr.on('data', d => {
      errBuf += d.toString();
      d.toString().split('\n').forEach(l => { if (l.trim()) emit(l.trim()); });
    });

    proc.on('close', code => {
      const act = s.currentAction;
      s.running = false;
      s.currentProc = null;
      s.currentAction = null;
      runtime.stop(io, profile.id, 'docker');
      // Al fallar, la salida cruda de docker no dice qué hacer: añadimos la
      // pista accionable (permisos de socket vs daemon apagado).
      if (code !== 0) emit(dockerFailHint(errBuf), 'error');
      io.to(room).emit('docker:exit', { action: act, code, profileId: profile.id });
      resolve({ code });
    });

    proc.on('error', err => {
      const act = s.currentAction;
      s.running = false;
      s.currentProc = null;
      s.currentAction = null;
      runtime.stop(io, profile.id, 'docker');
      io.to(room).emit('docker:log', { message: err.message, type: 'error', profileId: profile.id });
      io.to(room).emit('docker:exit', { action: act, code: -1, error: err.message, profileId: profile.id });
      reject(err);
    });
  });
}

// Mata el proceso adjunto de ESTE perfil.
function stop(io, profile) {
  const s = _state(profile.id);
  if (!s.currentProc) return false;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(s.currentProc.pid), '/f', '/t'], { shell: true });
    } else {
      s.currentProc.kill('SIGTERM');
    }
    if (io) io.to(`profile:${profile.id}`).emit('docker:log', { message: 'Deteniendo proceso Docker...', type: 'error', profileId: profile.id });
    return true;
  } catch {
    return false;
  }
}

// Garantiza que el grid Selenium del perfil esté arriba y saludable.
function ensureGrid(io, profile) {
  return new Promise((resolve, reject) => {
    const projectPath = readProjectPath(profile);
    if (!projectPath || !fs.existsSync(projectPath)) {
      return reject(new Error('projectPath no configurado o inexistente.'));
    }
    if (!hasCompose(projectPath)) {
      return reject(new Error('No se encontró docker-compose.yml en el proyecto.'));
    }

    const room = `profile:${profile.id}`;
    const emit = (message, type = 'info') => io && io.to(room).emit('docker:log', { message, type, profileId: profile.id });
    const args = composeArgs(profile, ['up', '-d', '--wait', 'selenium']);
    emit(`$ docker ${args.join(' ')}  (cwd: ${projectPath})`, 'cmd');

    const proc = spawn('docker', args, { cwd: projectPath, shell: process.platform === 'win32' });
    let errBuf = '';

    proc.stdout.on('data', d => d.toString().split('\n').forEach(l => { if (l.trim()) emit(l.trim()); }));
    proc.stderr.on('data', d => {
      const text = d.toString();
      errBuf += text;
      text.split('\n').forEach(l => { if (l.trim()) emit(l.trim()); });
    });

    proc.on('error', err => {
      reject(new Error(`No se pudo ejecutar Docker: ${err.message}. ${RUNNING_QUESTION}`));
    });
    proc.on('close', code => {
      if (code === 0) {
        emit('Grid Selenium listo (healthcheck OK)', 'success');
        resolve();
      } else {
        const tail = errBuf.trim().slice(-300);
        reject(new Error(
          `No se pudo iniciar el grid Selenium en Docker (código ${code}). ` +
          `${dockerFailHint(errBuf)}${tail ? ' — ' + tail : ''}`
        ));
      }
    });
  });
}

// `docker info` falla por dos motivos muy distintos: el daemon está caído, o
// está arriba pero no tenemos permiso sobre el socket. Los separamos porque la
// acción a tomar no es la misma.
function dockerDaemonState() {
  return new Promise(resolve => {
    exec('docker info --format "{{.ServerVersion}}"', (err, _stdout, stderr) => {
      if (!err) return resolve({ up: true });
      const detail = `${stderr || ''}${err.message || ''}`;
      resolve({ up: false, permission: isSocketPermissionError(detail), detail: detail.trim() });
    });
  });
}

// Linux: no hay Docker Desktop, dockerd es un servicio de systemd. Usamos
// `sudo -n` a propósito: sin NOPASSWD el sudo se quedaría esperando una
// contraseña que nadie va a teclear y colgaría la petición HTTP.
function startLinuxDaemon() {
  return new Promise(resolve => {
    exec('systemctl is-active docker', (activeErr, activeOut) => {
      if (!activeErr && String(activeOut).trim() === 'active') return resolve({ ok: true });
      exec('sudo -n systemctl start docker', (err, _out, stderr) => {
        if (!err) return resolve({ ok: true });
        const tail = String(stderr || '').trim().slice(-200);
        resolve({
          ok: false,
          error: 'No se pudo arrancar el daemon de Docker automáticamente (hace falta sudo sin contraseña). ' +
                 'Arráncalo a mano con: sudo systemctl start docker' + (tail ? ` — ${tail}` : ''),
        });
      });
    });
  });
}

// Arranca Docker: Docker Desktop en Windows/macOS, el servicio dockerd en Linux.
async function startDockerDesktop(io) {
  const emit = (message, type = 'info') => io && io.emit('docker:log', { message, type });

  const st = await dockerDaemonState();
  if (st.up) {
    emit('Docker ya está corriendo', 'success');
    return { ready: true };
  }
  // Daemon vivo pero socket sin permiso: volver a arrancarlo no arregla nada.
  if (st.permission) {
    emit(GROUP_HINT, 'error');
    return { ready: false, error: GROUP_HINT };
  }

  if (IS_WIN) {
    const candidates = [
      'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe',
      'C:\\Program Files\\Docker\\Docker\\frontend\\Docker Desktop.exe',
    ];
    const exe = candidates.find(p => fs.existsSync(p));
    if (!exe) return { ready: false, error: 'No se encontró Docker Desktop.exe. Instala Docker Desktop.' };
    emit('Arrancando Docker Desktop...', 'cmd');
    spawn('cmd', ['/c', 'start', '', exe], { detached: true, stdio: 'ignore' }).unref();
  } else if (IS_MAC) {
    emit('Arrancando Docker Desktop...', 'cmd');
    spawn('open', ['-a', 'Docker'], { detached: true, stdio: 'ignore' }).unref();
  } else {
    emit('Arrancando el daemon de Docker (systemctl start docker)...', 'cmd');
    const started = await startLinuxDaemon();
    if (!started.ok) {
      emit(started.error, 'error');
      return { ready: false, error: started.error };
    }
  }

  emit('Esperando a que el engine de Docker responda...', 'info');
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const s = await dockerDaemonState();
    if (s.up) {
      emit(`${DOCKER_APP} listo`, 'success');
      return { ready: true };
    }
    if (s.permission) {
      emit(GROUP_HINT, 'error');
      return { ready: false, error: GROUP_HINT };
    }
  }
  return { ready: false, error: `${DOCKER_APP} no respondió tras 2 minutos. Arráncalo manualmente y reintenta.` };
}

module.exports = { run, stop, status, gridStatus, projectStatus, listContainers, isRunning, checkDocker, ensureGrid, startDockerDesktop, readProjectPath, projectName };
