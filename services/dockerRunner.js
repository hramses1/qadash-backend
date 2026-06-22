const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

let currentProc = null;
let running = false;
let currentAction = null;

// Mapa de acciones → argumentos de `docker`.
// --abort-on-container-exit: el run completo termina cuando el contenedor
// "tests" sale (si no, `up` queda adjunto para siempre por selenium). Así el
// dashboard recupera estado idle y muestra el código de salida de pytest.
// up-selenium usa -d: arranca el grid en segundo plano y devuelve enseguida,
// dejándolo vivo para ver el navegador en http://localhost:7900.
const ACTIONS = {
  'up-build':    ['compose', 'up', '--build', '--abort-on-container-exit'],
  // --wait: bloquea hasta que el healthcheck del grid pasa (selenium listo).
  'up-selenium': ['compose', 'up', '-d', '--wait', 'selenium'],
  'rebuild':     ['compose', 'up', '--build', '--force-recreate', '--abort-on-container-exit'],
  'down':        ['compose', 'down'],
  // Baja TODOS los contenedores del proyecto (incluye huérfanos de runs viejos).
  'down-all':    ['compose', 'down', '--remove-orphans'],
};

function isRunning() {
  return running;
}

function status() {
  return { running, action: currentAction };
}

// Cuenta los contenedores DEL PROYECTO en ejecución (`compose ps -q` → un id por
// servicio corriendo). Sirve para saber si hay algo que bajar antes de `down`.
function projectStatus() {
  return new Promise(resolve => {
    const projectPath = readProjectPath();
    if (!projectPath || !fs.existsSync(projectPath) || !hasCompose(projectPath)) {
      return resolve({ count: 0 });
    }
    const shell = process.platform === 'win32';
    const proc = spawn('docker', ['compose', 'ps', '-q'], { cwd: projectPath, shell });
    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.on('error', () => resolve({ count: 0 }));
    proc.on('close', () => {
      const ids = out.split('\n').map(s => s.trim()).filter(Boolean);
      resolve({ count: ids.length });
    });
  });
}

// ¿Está el contenedor selenium levantado? `compose ps -q selenium` devuelve el
// id solo si el servicio está corriendo (ps oculta los detenidos por defecto).
function gridStatus() {
  return new Promise(resolve => {
    const projectPath = readProjectPath();
    if (!projectPath || !fs.existsSync(projectPath) || !hasCompose(projectPath)) {
      return resolve({ up: false });
    }
    const shell = process.platform === 'win32';
    const proc = spawn('docker', ['compose', 'ps', '-q', 'selenium'], { cwd: projectPath, shell });
    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.on('error', () => resolve({ up: false }));
    proc.on('close', () => resolve({ up: out.trim().length > 0 }));
  });
}

function readProjectPath() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
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

// Verifica que Docker exista y el daemon responda (docker info).
function checkDocker() {
  return new Promise((resolve) => {
    const shell = process.platform === 'win32';
    const ver = spawn('docker', ['--version'], { shell });
    let out = '';
    ver.stdout.on('data', d => { out += d.toString(); });
    ver.on('error', () => resolve({ ok: false, error: 'Docker no encontrado. Instala Docker Desktop.' }));
    ver.on('close', code => {
      if (code !== 0) return resolve({ ok: false, error: 'Docker no encontrado. Instala Docker Desktop.' });
      const version = out.trim();
      // Daemon corriendo?
      const info = spawn('docker', ['info', '--format', '{{.ServerVersion}}'], { shell });
      let derr = '';
      info.stderr.on('data', d => { derr += d.toString(); });
      info.on('error', () => resolve({ ok: false, version, error: 'Docker instalado pero el daemon no responde. Abre Docker Desktop.' }));
      info.on('close', c => {
        if (c === 0) resolve({ ok: true, version });
        else resolve({ ok: false, version, error: 'Docker Desktop no está corriendo. Ábrelo y reintenta.' });
      });
    });
  });
}

// Lista los contenedores Docker en ejecución (todos, no solo del proyecto).
// Usa tab como separador (carácter real, no metacarácter de shell).
function listContainers() {
  return new Promise(resolve => {
    const shell = process.platform === 'win32';
    // Separador sin espacios ni metacaracteres de shell: con shell:true un \t
    // o espacio rompería el arg en varios y `docker ps` recibiría argumentos.
    const SEP = '@@@';
    const fmt = ['{{.Names}}', '{{.Image}}', '{{.Status}}', '{{.Ports}}'].join(SEP);
    const proc = spawn('docker', ['ps', '--format', fmt], { shell });
    let out = '', err = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('error', () => resolve({ ok: false, error: 'Docker no disponible. ¿Docker Desktop está abierto?', containers: [] }));
    proc.on('close', code => {
      if (code !== 0) {
        return resolve({ ok: false, error: err.trim() || 'docker ps falló', containers: [] });
      }
      const containers = out.split('\n').map(l => l.trimEnd()).filter(Boolean).map(line => {
        const [name, image, status, ports] = line.split(SEP);
        return { name, image, status, ports: ports || '' };
      });
      resolve({ ok: true, containers });
    });
  });
}

// Lanza una acción de compose y transmite la salida por Socket.io.
// Resuelve con el código de salida; rechaza solo en errores de validación/spawn.
function run(io, action) {
  return new Promise((resolve, reject) => {
    if (running) return reject(new Error('Ya hay una operación Docker en curso'));

    const args = ACTIONS[action];
    if (!args) return reject(new Error(`Acción Docker inválida: ${action}`));

    const projectPath = readProjectPath();
    if (!projectPath) return reject(new Error('projectPath no configurado. Configúralo en Ajustes.'));
    if (!fs.existsSync(projectPath)) return reject(new Error(`El proyecto no existe: ${projectPath}`));
    if (!hasCompose(projectPath)) return reject(new Error('No se encontró docker-compose.yml en el proyecto.'));

    running = true;
    currentAction = action;

    const emit = (message, type = 'info') => io.emit('docker:log', { message, type });
    io.emit('docker:started', { action });
    emit(`$ docker ${args.join(' ')}  (cwd: ${projectPath})`, 'cmd');

    const proc = spawn('docker', args, { cwd: projectPath, shell: process.platform === 'win32' });
    currentProc = proc;

    proc.stdout.on('data', d => d.toString().split('\n').forEach(l => { if (l.trim()) emit(l.trim()); }));
    // Docker compose escribe casi todo (build, pull, logs) por stderr — tratarlo como info.
    proc.stderr.on('data', d => d.toString().split('\n').forEach(l => { if (l.trim()) emit(l.trim()); }));

    proc.on('close', code => {
      const act = currentAction;
      running = false;
      currentProc = null;
      currentAction = null;
      io.emit('docker:exit', { action: act, code });
      resolve({ code });
    });

    proc.on('error', err => {
      const act = currentAction;
      running = false;
      currentProc = null;
      currentAction = null;
      io.emit('docker:log', { message: err.message, type: 'error' });
      io.emit('docker:exit', { action: act, code: -1, error: err.message });
      reject(err);
    });
  });
}

// Mata el proceso adjunto (p.ej. `up` en primer plano). Los contenedores
// pueden quedar vivos → usar la acción "down" para limpiarlos del todo.
function stop(io) {
  if (!currentProc) return false;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(currentProc.pid), '/f', '/t'], { shell: true });
    } else {
      currentProc.kill('SIGTERM');
    }
    if (io) io.emit('docker:log', { message: 'Deteniendo proceso Docker...', type: 'error' });
    return true;
  } catch {
    return false;
  }
}

// Garantiza que el grid Selenium esté arriba y saludable antes de correr tests.
// Idempotente: si ya está sano, `up -d --wait` vuelve enseguida. Lanza error
// claro si Docker Desktop está cerrado o el grid no levanta.
function ensureGrid(io) {
  return new Promise((resolve, reject) => {
    const projectPath = readProjectPath();
    if (!projectPath || !fs.existsSync(projectPath)) {
      return reject(new Error('projectPath no configurado o inexistente.'));
    }
    if (!hasCompose(projectPath)) {
      return reject(new Error('No se encontró docker-compose.yml en el proyecto.'));
    }

    const emit = (message, type = 'info') => io && io.emit('docker:log', { message, type });
    const args = ['compose', 'up', '-d', '--wait', 'selenium'];
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
      reject(new Error(`No se pudo ejecutar Docker: ${err.message}. ¿Docker Desktop está abierto?`));
    });
    proc.on('close', code => {
      if (code === 0) {
        emit('Grid Selenium listo (healthcheck OK)', 'success');
        resolve();
      } else {
        const tail = errBuf.trim().slice(-300);
        reject(new Error(
          `No se pudo iniciar el grid Selenium en Docker (código ${code}). ` +
          `¿Docker Desktop está abierto?${tail ? ' — ' + tail : ''}`
        ));
      }
    });
  });
}

// Arranca Docker Desktop y espera a que el daemon responda. Útil cuando el
// binario está instalado pero el engine está apagado (causa típica del error
// "dockerDesktopLinuxEngine: cannot find file").
function dockerDaemonUp() {
  return new Promise(resolve => {
    exec('docker info --format "{{.ServerVersion}}"', (err) => resolve(!err));
  });
}

async function startDockerDesktop(io) {
  const emit = (message, type = 'info') => io && io.emit('docker:log', { message, type });

  if (await dockerDaemonUp()) {
    emit('Docker ya está corriendo', 'success');
    return { ready: true };
  }

  // Lanzar la app según plataforma.
  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe',
      'C:\\Program Files\\Docker\\Docker\\frontend\\Docker Desktop.exe',
    ];
    const exe = candidates.find(p => fs.existsSync(p));
    if (!exe) return { ready: false, error: 'No se encontró Docker Desktop.exe. Instala Docker Desktop.' };
    emit('Arrancando Docker Desktop...', 'cmd');
    spawn('cmd', ['/c', 'start', '', exe], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    emit('Arrancando Docker Desktop...', 'cmd');
    spawn('open', ['-a', 'Docker'], { detached: true, stdio: 'ignore' }).unref();
  } else {
    return { ready: false, error: 'Arranque automático no soportado en este SO. Inicia el daemon manualmente.' };
  }

  // Poll hasta ~120s (engine tarda en levantar la primera vez).
  emit('Esperando a que el engine de Docker responda...', 'info');
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 3000));
    if (await dockerDaemonUp()) {
      emit('Docker Desktop listo', 'success');
      return { ready: true };
    }
  }
  return { ready: false, error: 'Docker Desktop no respondió tras 2 minutos. Ábrelo manualmente y reintenta.' };
}

module.exports = { run, stop, status, gridStatus, projectStatus, listContainers, isRunning, checkDocker, ensureGrid, startDockerDesktop, readProjectPath };
