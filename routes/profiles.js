const express = require('express');
const router = express.Router();
const { readEntornos, writeEntornos } = require('../services/profileManager');

router.get('/', (req, res) => {
  try { res.json(readEntornos(req.profile.entornos)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:name', (req, res) => {
  try {
    const { vars } = req.body;
    if (!vars || !Array.isArray(vars)) return res.status(400).json({ error: 'vars required' });
    const map = readEntornos(req.profile.entornos);
    map[req.params.name] = vars;
    writeEntornos(req.profile.entornos, map);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:name/rename', (req, res) => {
  try {
    const { newName } = req.body;
    if (!newName || !newName.trim()) return res.status(400).json({ error: 'newName required' });
    const map = readEntornos(req.profile.entornos);
    if (!map[req.params.name]) return res.status(404).json({ error: 'Entorno no encontrado' });
    if (req.params.name === newName.trim()) return res.json({ success: true });
    map[newName.trim()] = map[req.params.name];
    delete map[req.params.name];
    writeEntornos(req.profile.entornos, map);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:name', (req, res) => {
  try {
    const map = readEntornos(req.profile.entornos);
    delete map[req.params.name];
    writeEntornos(req.profile.entornos, map);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
