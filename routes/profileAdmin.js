const express = require('express');
const router = express.Router();
const pm = require('../services/profileManager');

// Servicios con estado runtime por perfil (para no borrar/renombrar en caliente).
let runtimeBusy = () => false;
try { runtimeBusy = require('../services/runtimeRegistry').isProfileBusy; } catch {}

router.get('/', (req, res) => {
  res.json({ activeProfileId: pm.getActiveProfileId(), profiles: pm.listProfiles() });
});

router.post('/', (req, res) => {
  try {
    const name = (req.body && req.body.name) || '';
    if (!name.trim()) return res.status(400).json({ error: 'name requerido' });
    res.json(pm.createProfile(name));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/rename', (req, res) => {
  try {
    const name = (req.body && req.body.name) || '';
    if (!name.trim()) return res.status(400).json({ error: 'name requerido' });
    pm.renameProfile(req.params.id, name);
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/:id/duplicate', (req, res) => {
  try {
    const name = (req.body && req.body.name) || '';
    if (!name.trim()) return res.status(400).json({ error: 'name requerido' });
    res.json(pm.duplicateProfile(req.params.id, name));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.patch('/:id/activate', (req, res) => {
  try {
    if (!pm.profileExists(req.params.id)) return res.status(404).json({ error: 'Perfil no encontrado' });
    pm.setActiveProfileId(req.params.id);
    res.json({ success: true, activeProfileId: req.params.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', (req, res) => {
  try {
    if (pm.listProfiles().length <= 1) return res.status(409).json({ error: 'No se puede borrar el último perfil' });
    if (runtimeBusy(req.params.id)) return res.status(409).json({ error: 'Perfil en ejecución; deténlo antes de borrar' });
    pm.deleteProfile(req.params.id);
    res.json({ success: true, activeProfileId: pm.getActiveProfileId() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
