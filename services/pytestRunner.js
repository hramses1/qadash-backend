const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');

let currentProc = null;
let running = false;
let aborted = false;

function isRunning() {
  return running;
}

function abortExecution() {
  aborted = true;
  if (currentProc) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(currentProc.pid), '/f', '/t'], { shell: true });
      } else {
        currentProc.kill('SIGTERM');
      }
    } catch {
      // Process may have already exited
    }
  }
}

async function runTests(io, testIds, projectPath, pytestCmd = 'pytest', envVars = {}) {
  running = true;
  aborted = false;
  currentProc = null;

  const startTime = Date.now();
  const results = [];

  io.emit('execution:started', { total: testIds.length });

  for (let i = 0; i < testIds.length; i++) {
    if (aborted) {
      io.emit('execution:aborted', { completed: i, total: testIds.length });
      break;
    }

    const testId = testIds[i];
    io.emit('test:started', { id: testId, index: i, total: testIds.length });

    const result = await runSingleTest(io, testId, projectPath, pytestCmd, envVars);
    results.push(result);

    io.emit('test:completed', result);
    io.emit('progress', {
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

  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORTS_DIR, `${reportId}.json`), JSON.stringify(report, null, 2));

  io.emit('execution:completed', { reportId, summary });

  running = false;
  currentProc = null;
}

function runSingleTest(io, testId, projectPath, pytestCmd, envVars = {}) {
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
      env: { ...process.env, ...envVars }
    });

    currentProc = proc;

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      io.emit('test:output', { id: testId, line: text });
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      io.emit('test:output', { id: testId, line: text });
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
