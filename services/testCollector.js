const { spawn } = require('child_process');

function collectTests(projectPath, pytestCmd = 'pytest') {
  return new Promise((resolve, reject) => {
    const cmdParts = pytestCmd.trim().split(/\s+/);
    const cmd = cmdParts[0];
    const cmdArgs = cmdParts.slice(1);
    const args = [...cmdArgs, '--collect-only', '-q', '--no-header', '--override-ini=addopts='];

    const proc = spawn(cmd, args, {
      cwd: projectPath,
      shell: true,
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', (code) => {
      // exit 0 = ok, exit 2 = partial (some errors but tests collected), exit 5 = no tests found
      if (code !== 0 && code !== 2 && code !== 5) {
        const err = new Error(`pytest --collect-only failed (exit code ${code})`);
        err.raw = (stderr + '\n' + stdout).trim();
        return reject(err);
      }

      const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);

      const testIds = lines.filter(l =>
        l.includes('::') &&
        !l.startsWith('=') &&
        !l.startsWith('ERROR') &&
        !l.startsWith('WARNINGS') &&
        !l.startsWith('no tests ran') &&
        !l.includes(' selected') &&
        !l.includes(' warning')
      );

      // Extract files that failed to import
      const errorFiles = lines
        .filter(l => l.startsWith('ERROR ') && l.includes('/') || l.includes('\\'))
        .map(l => l.replace(/^ERROR\s+/, '').replace(/\\/g, '/').trim())
        .filter(l => !l.startsWith('='));

      if (!testIds.length && code !== 5) {
        const err = new Error('No tests found in the specified path');
        err.raw = (stdout + '\n' + stderr).trim();
        return reject(err);
      }

      // Group by file
      const fileMap = {};
      for (const id of testIds) {
        const normalized = id.replace(/\\/g, '/');
        const parts = normalized.split('::');
        const file = parts[0];
        if (!fileMap[file]) fileMap[file] = [];
        fileMap[file].push(normalized);
      }

      resolve({
        files: fileMap,
        total: testIds.length,
        errorFiles: errorFiles.length ? errorFiles : undefined
      });
    });

    proc.on('error', (err) => {
      err.raw = `Failed to start process: ${pytestCmd}. Make sure pytest is installed and the command is correct.`;
      reject(err);
    });
  });
}

module.exports = { collectTests };
