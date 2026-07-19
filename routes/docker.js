const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { run, stop, status, gridStatus, projectStatus, listContainers, checkDocker, startDockerDesktop, readProjectPath } = require('../services/dockerRunner');

router.get('/check', async (req, res) => {
  try {
    res.json(await checkDocker());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/start-desktop', async (req, res) => {
  try {
    const io = req.app.get('io');
    res.json(await startDockerDesktop(io));
  } catch (e) {
    res.status(500).json({ ready: false, error: e.message });
  }
});

router.get('/status', async (req, res) => {
  const projectPath = readProjectPath(req.profile);
  const reportPath = projectPath ? path.join(projectPath, 'reports', 'report.html') : '';
  const [grid, proj] = await Promise.all([gridStatus(req.profile), projectStatus(req.profile)]);
  res.json({
    ...status(req.profile),
    projectPath,
    gridUp: grid.up,
    projectUp: proj.count,
    hasReport: !!reportPath && fs.existsSync(reportPath)
  });
});

router.get('/containers', async (req, res) => {
  try {
    res.json(await listContainers());
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, containers: [] });
  }
});

router.post('/run', (req, res) => {
  const { action } = req.body;
  const io = req.app.get('io');
  const profile = req.profile;

  run(io, profile, action)
    .catch(err => {
      // Errores de validación llegan aquí antes de responder; reflejarlos en logs.
      io.to(`profile:${profile.id}`).emit('docker:log', { message: err.message, type: 'error', profileId: profile.id });
      io.to(`profile:${profile.id}`).emit('docker:exit', { action, code: -1, error: err.message, profileId: profile.id });
    });

  // Responder enseguida; el progreso real va por Socket.io.
  res.json({ started: true });
});

router.post('/stop', (req, res) => {
  const io = req.app.get('io');
  const stopped = stop(io, req.profile);
  res.json({ stopped });
});

// Sirve el report.html generado por pytest en el host (./reports/report.html).
router.get('/report', (req, res) => {
  const projectPath = readProjectPath(req.profile);
  if (!projectPath) return res.status(400).send('projectPath no configurado');
  const f = path.join(projectPath, 'reports', 'report.html');
  if (!fs.existsSync(f)) return res.status(404).send('Aún no hay reporte. Ejecuta los tests primero.');
  res.sendFile(f);
});

module.exports = router;
