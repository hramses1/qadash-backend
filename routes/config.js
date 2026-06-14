const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function openNativeDialog(type, startPath) {
  return new Promise((resolve) => {
    const safe = (startPath || '').replace(/'/g, "''").replace(/`/g, '').replace(/\$/g, '');

    if (process.platform === 'win32') {
      let script;
      if (type === 'folder') {
        script = [
          'Add-Type -AssemblyName System.Windows.Forms;',
          '$d = New-Object System.Windows.Forms.FolderBrowserDialog;',
          "$d.Description = 'Seleccionar carpeta';",
          '$d.ShowNewFolderButton = $true;',
          safe ? `$d.SelectedPath = '${safe}';` : '',
          "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }"
        ].join(' ');
      } else {
        script = [
          'Add-Type -AssemblyName System.Windows.Forms;',
          '$d = New-Object System.Windows.Forms.OpenFileDialog;',
          "$d.Filter = 'Env files (*.env)|*.env|All files (*.*)|*.*';",
          safe ? `$d.InitialDirectory = '${path.dirname(safe) || safe}';` : '',
          "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.FileName }"
        ].join(' ');
      }

      const proc = spawn('powershell', ['-NoProfile', '-Command', script]);
      let out = '';
      proc.stdout.on('data', d => { out += d.toString(); });
      proc.on('close', () => resolve(out.trim() || null));
      proc.on('error', () => resolve(null));

    } else if (process.platform === 'darwin') {
      const applescript = type === 'folder'
        ? `POSIX path of (choose folder with prompt "Seleccionar carpeta")`
        : `POSIX path of (choose file with prompt "Seleccionar archivo .env")`;
      const proc = spawn('osascript', ['-e', applescript]);
      let out = '';
      proc.stdout.on('data', d => { out += d.toString(); });
      proc.on('close', () => resolve(out.trim().replace(/\n$/, '') || null));
      proc.on('error', () => resolve(null));

    } else {
      const args = type === 'folder'
        ? ['--file-selection', '--directory', '--title=Seleccionar carpeta']
        : ['--file-selection', '--title=Seleccionar archivo .env'];
      const proc = spawn('zenity', args);
      let out = '';
      proc.stdout.on('data', d => { out += d.toString(); });
      proc.on('close', () => resolve(out.trim() || null));
      proc.on('error', () => resolve(null));
    }
  });
}

router.get('/browse', async (req, res) => {
  const type = req.query.type === 'file' ? 'file' : 'folder';
  const startPath = req.query.startPath || '';
  try {
    const selected = await openNativeDialog(type, startPath);
    res.json(selected ? { path: selected } : { path: null, cancelled: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function writeConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
}

router.get('/', (req, res) => {
  try {
    res.json(readConfig());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', (req, res) => {
  try {
    const { projectPath, envPath, pytestCmd } = req.body;
    const updated = { projectPath, envPath, pytestCmd: pytestCmd || 'pytest' };
    writeConfig(updated);
    res.json({ success: true, config: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/validate', (req, res) => {
  try {
    const { projectPath } = req.body;
    if (!projectPath) return res.json({ valid: false, reason: 'No path provided' });
    if (!fs.existsSync(projectPath)) return res.json({ valid: false, reason: 'Path does not exist' });

    const stat = fs.statSync(projectPath);
    if (!stat.isDirectory()) return res.json({ valid: false, reason: 'Path is not a directory' });

    const contents = fs.readdirSync(projectPath);
    const hasTests = contents.some(f =>
      f === 'pytest.ini' || f === 'conftest.py' || f === 'setup.cfg' ||
      f === 'pyproject.toml' || f.startsWith('test_') || f.endsWith('_test.py')
    );

    if (!hasTests) {
      return res.json({ valid: false, reason: 'No pytest markers found (pytest.ini, conftest.py, test_*.py)' });
    }
    res.json({ valid: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
