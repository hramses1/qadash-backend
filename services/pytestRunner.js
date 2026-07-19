const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const runtime = require('./runtimeRegistry');

const DEFAULT_REPORTS_DIR = path.join(__dirname, '..', 'reports');

// Estado por perfil: cada perfil corre en paralelo sin pisar al otro.
const state = new Map(); // profileId -> { running, currentProc, aborted }

function _state(profileId) {
  if (!state.has(profileId)) state.set(profileId, { running: false, currentProc: null, aborted: false });
  return state.get(profileId);
}

function isRunning(profileId) {
  const s = state.get(profileId);
  return !!(s && s.running);
}

function abortExecution(profileId) {
  const s = state.get(profileId);
  if (!s) return;
  s.aborted = true;
  if (s.currentProc) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(s.currentProc.pid), '/f', '/t'], { shell: true });
      } else {
        s.currentProc.kill('SIGTERM');
      }
    } catch {
      // Process may have already exited
    }
  }
}

// Emite un evento solo a la sala del perfil (aislamiento de logs en paralelo).
function emit(io, profileId, event, payload) {
  if (io) io.to(`profile:${profileId}`).emit(event, { ...payload, profileId });
}

async function runTests(io, profileId, testIds, projectPath, pytestCmd = 'pytest', envVars = {}, paramsByTest = {}, reportsDir = DEFAULT_REPORTS_DIR) {
  const s = _state(profileId);
  s.running = true;
  s.aborted = false;
  s.currentProc = null;
  runtime.start(io, profileId, 'tests');

  const startTime = Date.now();
  const results = [];

  emit(io, profileId, 'execution:started', { total: testIds.length });

  for (let i = 0; i < testIds.length; i++) {
    if (s.aborted) {
      emit(io, profileId, 'execution:aborted', { completed: i, total: testIds.length });
      break;
    }

    const testId = testIds[i];
    emit(io, profileId, 'test:started', { id: testId, index: i, total: testIds.length });

    // Params específicos de este test pisan a los globales.
    const perTest = paramsByTest[testId] || {};
    const result = await runSingleTest(io, profileId, testId, projectPath, pytestCmd, { ...envVars, ...perTest });
    results.push(result);

    emit(io, profileId, 'test:completed', result);
    emit(io, profileId, 'progress', {
      current: i + 1,
      total: testIds.length,
      percentage: Math.round(((i + 1) / testIds.length) * 100)
    });
  }

  const totalDuration = (Date.now() - startTime) / 1000;
  const summary = {
    total: results.length,
    passed: results.filter(r => r.status === 'passed').length,
    failed: results.filter(r => r.status === 'failed').length,
    errors: results.filter(r => r.status === 'error').length,
    duration: totalDuration
  };

  const reportId = `report_${Date.now()}`;
  const report = {
    id: reportId,
    timestamp: new Date().toISOString(),
    summary,
    tests: results
  };

  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(reportsDir, `${reportId}.json`), JSON.stringify(report, null, 2));

  emit(io, profileId, 'execution:completed', { reportId, summary });

  s.running = false;
  s.currentProc = null;
  runtime.stop(io, profileId, 'tests');
}

function runSingleTest(io, profileId, testId, projectPath, pytestCmd, envVars = {}) {
  return new Promise((resolve) => {
    const testStart = Date.now();
    const cmdParts = pytestCmd.trim().split(/\s+/);
    const cmd = cmdParts[0];
    const cmdArgs = cmdParts.slice(1);
    const args = [...cmdArgs, testId, '-v', '--tb=short', '--no-header', '-p', 'no:cacheprovider'];

    let output = '';

    const proc = spawn(cmd, args, {
      cwd: projectPath,
      shell: true,
      // UTF-8 forzado: mismos ids con tildes que en la colección (si no, en
      // Windows pytest usaría cp1252 y el nodeid no coincidiría → 0 tests).
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...envVars }
    });

    _state(profileId).currentProc = proc;

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      emit(io, profileId, 'test:output', { id: testId, line: text });
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      emit(io, profileId, 'test:output', { id: testId, line: text });
    });

    proc.on('close', (code) => {
      const duration = (Date.now() - testStart) / 1000;
      let status;
      let errorMsg = '';

      if (code === 0) {
        status = 'passed';
      } else if (code === 1) {
        status = 'failed';
        // Extract relevant error lines from output
        const lines = output.split('\n');
        const failIdx = lines.findIndex(l =>
          l.includes('FAILED') || l.includes('AssertionError') ||
          l.includes('Error') || l.includes('assert ')
        );
        if (failIdx !== -1) {
          errorMsg = lines.slice(failIdx, failIdx + 8).join('\n').trim();
        } else {
          errorMsg = output.slice(-400).trim();
        }
      } else {
        status = 'error';
        errorMsg = output.slice(-400).trim() || `pytest exited with code ${code}`;
      }

      resolve({ id: testId, status, duration, output, errorMsg });
    });

    proc.on('error', (err) => {
      resolve({
        id: testId,
        status: 'error',
        duration: (Date.now() - testStart) / 1000,
        output: '',
        errorMsg: `Failed to spawn pytest: ${err.message}`
      });
    });
  });
}

module.exports = { runTests, abortExecution, isRunning };
