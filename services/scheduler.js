const fs = require('fs');
const path = require('path');
const { readEnv } = require('./envManager');
const { runTests, isRunning } = require('./pytestRunner');
const { ensureGrid } = require('./dockerRunner');

const SCHED_PATH = path.join(__dirname, '..', 'schedules.json');
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

let io = null;
let lastTickMinute = null;

function load() {
  try { return JSON.parse(fs.readFileSync(SCHED_PATH, 'utf-8')); }
  catch { return []; }
}

function save(list) {
  fs.writeFileSync(SCHED_PATH, JSON.stringify(list, null, 2));
}

function getConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); }
  catch { return {}; }
}

function uid() {
  return 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Próxima ejecución (ISO) a partir de `from`. days: [] = todos los días.
function computeNextRun(s, from = new Date()) {
  if (!s.enabled || !s.time) return null;
  const [hh, mm] = s.time.split(':').map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  for (let i = 0; i < 8; i++) {
    const d = new Date(from);
    d.setDate(from.getDate() + i);
    d.setHours(hh, mm, 0, 0);
    if (d <= from) continue;
    const dow = d.getDay();
    if (!s.days || s.days.length === 0 || s.days.includes(dow)) return d.toISOString();
  }
  return null;
}

function emitLog(message, type = 'info') {
  if (io) io.emit('schedule:log', { message, type, ts: Date.now() });
  console.log('[scheduler]', message);
}

// Entorno del subprocess: .env base + grid + params de la programación.
function buildEnv(cfg, schedule) {
  let env = {};
  if (cfg.envPath && fs.existsSync(cfg.envPath)) {
    env = Object.fromEntries(
      readEnv(cfg.envPath).filter(v => !v.isComment && v.key).map(v => [v.key, v.value])
    );
  }
  if (cfg.seleniumRemoteUrl) env.SELENIUM_REMOTE_URL = cfg.seleniumRemoteUrl;
  if (schedule.params && typeof schedule.params === 'object') {
    for (const [k, v] of Object.entries(schedule.params)) {
      if (k && v !== undefined && v !== null && String(v).trim() !== '') env[String(k).trim()] = String(v);
    }
  }
  return env;
}

// Dispara una programación. manual=true ignora el guard de "ya corriendo"? No:
// si hay un run en curso, se omite siempre para no pisar la sesión del usuario.
async function trigger(schedule) {
  if (isRunning()) {
    emitLog(`Programación "${schedule.name}" omitida: ya hay una ejecución en curso`, 'error');
    return { ok: false, reason: 'busy' };
  }
  const cfg = getConfig();
  if (!cfg.projectPath) {
    emitLog(`Programación "${schedule.name}" sin proyecto configurado`, 'error');
    return { ok: false, reason: 'no-project' };
  }
  const base = (schedule.testIds || []).filter(Boolean);
  if (!base.length) {
    emitLog(`Programación "${schedule.name}" sin tests`, 'error');
    return { ok: false, reason: 'no-tests' };
  }

  const repeat = Math.max(1, schedule.repeat || 1);
  const testIds = Array.from({ length: repeat }, () => base).flat();
  const env = buildEnv(cfg, schedule);

  if (schedule.useDocker && cfg.seleniumRemoteUrl) {
    emitLog(`"${schedule.name}": levantando Selenium en Docker...`);
    try { await ensureGrid(io); }
    catch (e) { emitLog(`"${schedule.name}": Docker falló — ${e.message}`, 'error'); }
  }

  // Sella lastRun.
  const list = load();
  const item = list.find(x => x.id === schedule.id);
  if (item) { item.lastRun = new Date().toISOString(); save(list); }

  emitLog(`▶ Ejecutando programación "${schedule.name}" (${testIds.length} test${testIds.length !== 1 ? 's' : ''})`, 'success');
  if (io) io.emit('schedule:run', { id: schedule.id, name: schedule.name, total: testIds.length });

  runTests(io, testIds, cfg.projectPath, cfg.pytestCmd, env, schedule.paramsByTest || {});
  return { ok: true };
}

// Tick: una vez por minuto, lanza las programaciones cuyo HH:MM y día coinciden.
function tick() {
  const now = new Date();
  const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
  if (minuteKey === lastTickMinute) return;
  lastTickMinute = minuteKey;

  const hhmm = now.toTimeString().slice(0, 5);
  const dow = now.getDay();
  for (const s of load()) {
    if (!s.enabled || s.time !== hhmm) continue;
    if (s.days && s.days.length && !s.days.includes(dow)) continue;
    trigger(s);
  }
}

function start(_io) {
  io = _io;
  setInterval(tick, 20000);
  tick();
  console.log('[scheduler] iniciado');
}

module.exports = { load, save, getConfig, uid, computeNextRun, trigger, start };
