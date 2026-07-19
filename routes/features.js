const express = require('express');
const router = express.Router();
const { getFlags, setFlags } = require('../services/featureFlags');

router.get('/', (req, res) => {
  try { res.json(getFlags(req.profile.features)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', (req, res) => {
  try { res.json(setFlags(req.profile.features, req.body || {})); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
