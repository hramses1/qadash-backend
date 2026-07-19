const express = require('express');
const router = express.Router();
const { getFlags, setFlags } = require('../services/featureFlags');

router.get('/', (req, res) => {
  try { res.json(getFlags()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', (req, res) => {
  try { res.json(setFlags(req.body || {})); }
  catch (e) {
    const code = /No project configured/.test(e.message) ? 400 : 500;
    res.status(code).json({ error: e.message });
  }
});

module.exports = router;
