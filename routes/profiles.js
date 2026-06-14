const express = require('express');
const router = express.Router();
const { readProfiles, writeProfiles } = require('../services/profileManager');

router.get('/', (req, res) => {
  try {
    res.json(readProfiles());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:name', (req, res) => {
  try {
    const { vars } = req.body;
    if (!vars || !Array.isArray(vars)) return res.status(400).json({ error: 'vars required' });
    const profiles = readProfiles();
    profiles[req.params.name] = vars;
    writeProfiles(profiles);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:name/rename', (req, res) => {
  try {
    const { newName } = req.body;
    if (!newName || !newName.trim()) return res.status(400).json({ error: 'newName required' });
    const profiles = readProfiles();
    if (!profiles[req.params.name]) return res.status(404).json({ error: 'Profile not found' });
    if (req.params.name === newName.trim()) return res.json({ success: true });
    profiles[newName.trim()] = profiles[req.params.name];
    delete profiles[req.params.name];
    writeProfiles(profiles);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:name', (req, res) => {
  try {
    const profiles = readProfiles();
    delete profiles[req.params.name];
    writeProfiles(profiles);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
