// Actualización del propio dashboard (backend + frontend) desde sus repos.
//
// Los dos repos son hermanos en el mismo directorio: el backend se ubica a sí
// mismo con __dirname y deduce dónde está el frontend. Si algún día dejan de
// estar juntos, esto se resuelve con una variable de entorno, no adivinando.

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const BACKEND_DIR = path.resolve(__dirname, '..');
const FRONTEND_DIR = process.env.QADASH_FRONTEND_DIR
  || path.resolve(BACKEND_DIR, '..', 'qadash-frontend');

const REPOS = [
  { key: 'backend', label: 'Backend', dir: BACKEND_DIR },
  { key: 'frontend', label: 'Frontend', dir: FRONTEND_DIR },
];

// Timeout generoso: `npm install` en un repo frío puede tardar minutos, pero
// sin límite un comando colgado dejaría la petición HTTP abierta para siempre.
const CMD_TIMEOUT_MS = 10 * 60 * 1000;

function sh(cmd, cwd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd, timeout: CMD_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = `${stdout || ''}${stderr || ''}`.trim();
      if (err) {
        const e = new Error(out || err.message);
        e.code = err.code;
        return reject(e);
      }
      resolve(out);
    });
  });
}

function isRepo(dir) {
  try { return fs.existsSync(path.join(dir, '.git')); }
  catch { return false; }
}

// Estado de un repo sin modificar nada: sirve para el botón "buscar
// actualizaciones" y para decidir si el update puede correr.
async function repoStatus(repo) {
  const base = { key: repo.key, label: repo.label, dir: repo.dir };
  if (!isRepo(repo.dir)) {
    return { ...base, ok: false, error: 'No es un repositorio git' };
  }
  try {
    const branch = await sh('git rev-parse --abbrev-ref HEAD', repo.dir);
    await sh('git fetch origin --quiet', repo.dir);
    const behind = parseInt(await sh(`git rev-list --count HEAD..origin/${branch}`, repo.dir), 10) || 0;
    const ahead = parseInt(await sh(`git rev-list --count origin/${branch}..HEAD`, repo.dir), 10) || 0;
    const dirtyOut = await sh('git status --porcelain', repo.dir);
    // Los archivos sin rastrear no impiden un fast-forward; solo los rastreados
    // con cambios locales, que git se negaría a pisar.
    const dirty = dirtyOut.split('\n').filter(l => l.trim() && !l.startsWith('??'));
    const head = await sh('git log -1 --format=%h %s', repo.dir).catch(() => '');
    return { ...base, ok: true, branch, behind, ahead, dirty: dirty.length, head };
  } catch (e) {
    return { ...base, ok: false, error: e.message };
  }
}

async function statusAll() {
  return Promise.all(REPOS.map(repoStatus));
}

// Actualiza un repo. `emit(line, type)` reporta progreso en vivo.
async function updateRepo(repo, emit) {
  const st = await repoStatus(repo);
  if (!st.ok) throw new Error(`${repo.label}: ${st.error}`);

  // Abortar antes de tocar nada es deliberado: un `git pull` sobre cambios
  // locales o los descarta o deja el repo en conflicto, y ninguna de las dos
  // cosas debe pasarle a un servidor por pulsar un botón.
  if (st.dirty > 0) {
    throw new Error(`${repo.label}: hay ${st.dirty} archivo(s) con cambios sin commitear. Resuélvelos antes de actualizar.`);
  }
  if (st.behind === 0) {
    emit(`${repo.label}: ya está al día (${st.head})`, 'info');
    return { key: repo.key, updated: false, installed: false };
  }

  emit(`${repo.label}: bajando ${st.behind} commit(s)…`, 'info');

  const before = await sh('git rev-parse HEAD', repo.dir);
  await sh(`git pull --ff-only origin ${st.branch}`, repo.dir);
  const after = await sh('git rev-parse HEAD', repo.dir);

  // Solo reinstalar si el manifiesto cambió: `npm install` en cada pulsación
  // convertiría una actualización de 2 segundos en una de varios minutos.
  const changed = await sh(`git diff --name-only ${before} ${after}`, repo.dir);
  const needsInstall = /(^|\n)package(-lock)?\.json/.test(changed);

  if (needsInstall) {
    emit(`${repo.label}: cambiaron las dependencias, instalando…`, 'info');
    await sh('npm install --no-audit --no-fund', repo.dir);
    emit(`${repo.label}: dependencias instaladas`, 'info');
  }

  const head = await sh('git log -1 --format=%h %s', repo.dir).catch(() => '');
  emit(`${repo.label}: actualizado → ${head}`, 'success');
  return { key: repo.key, updated: true, installed: needsInstall };
}

// Nota sobre el reinicio: backend y frontend corren con nodemon y vite dev,
// que recargan solos al cambiar los archivos. Por eso aquí no se reinicia
// nada: hacerlo mataría el propio proceso que está respondiendo la petición.
async function updateAll(emit) {
  const results = [];
  for (const repo of REPOS) {
    results.push(await updateRepo(repo, emit));
  }
  return results;
}

module.exports = { REPOS, statusAll, repoStatus, updateAll, updateRepo };
