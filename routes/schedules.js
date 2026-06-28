const express = require('express');
const router = express.Router();
const { load, save, uid, computeNextRun, trigger } = require('../services/scheduler');

// Normaliza el payload de una programación.
function sanitize(body, existing = {}) {
  const s = { ...existing };
  if (body.name !== undefined) s.name = String(body.name).trim() || 'Sin nombre';
  if (body.time !== undefined) s.time = String(body.time).slice(0, 5);   // HH:MM
  if (body.enabled !== undefined) s.enabled = !!body.enabled;
  if (body.days !== undefined) s.days = Array.isArray(body.days) ? body.days.map(Number).filter(n => n >= 0 && n <= 6) : [];
  if (body.testIds !== undefined) s.testIds = Array.isArray(body.testIds) ? body.testIds.filter(Boolean) : [];
  if (body.repeat !== undefined) s.repeat = Math.max(1, Number(body.repeat) || 1);
  if (body.useDocker !== undefined) s.useDocker = !!body.useDocker;
  if (body.params !== undefined && body.params && typeof body.params === 'object') {
    s.params = Object.fromEntries(
      Object.entries(body.params).filter(([k, v]) => k && String(v).trim() !== '').map(([k, v]) => [k, String(v)])
    );
  }
  if (body.paramsByTest !== undefined && body.paramsByTest && typeof body.paramsByTest === 'object') {
    const out = {};
    for (const [id, kv] of Object.entries(body.paramsByTest)) {
      if (!kv || typeof kv !== 'object') continue;
      const o = {};
      for (const [k, v] of Object.entries(kv)) if (k && String(v).trim() !== '') o[k] = String(v);
      if (Object.keys(o).length) out[id] = o;
    }
    s.paramsByTest = out;
  }
  return s;
}

function withMeta(s) {
  return { ...s, nextRun: computeNextRun(s) };
}

// GET /api/schedules → lista con nextRun
router.get('/', (req, res) => {
  res.json({ schedules: load().map(withMeta) });
});

// POST /api/schedules → crea
router.post('/', (req, res) => {
  const list = load();
  const s = sanitize(req.body, {
    id: uid(), enabled: true, days: [], testIds: [], repeat: 1, useDocker: false,
    params: {}, paramsByTest: {}, lastRun: null, createdAt: new Date().toISOString()
  });
  if (!s.time) return res.status(400).json({ error: 'Hora (HH:MM) requerida' });
  list.push(s);
  save(list);
  res.json({ schedule: withMeta(s) });
});

// PUT /api/schedules/:id → actualiza
router.put('/:id', (req, res) => {
  const list = load();
  const idx = list.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Programación no encontrada' });
  list[idx] = sanitize(req.body, list[idx]);
  save(list);
  res.json({ schedule: withMeta(list[idx]) });
});

// PATCH /api/schedules/:id/toggle → habilita/inhabilita
router.patch('/:id/toggle', (req, res) => {
  const list = load();
  const s = list.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'No encontrada' });
  s.enabled = !s.enabled;
  save(list);
  res.json({ schedule: withMeta(s) });
});

// DELETE /api/schedules/:id
router.delete('/:id', (req, res) => {
  const list = load();
  const next = list.filter(x => x.id !== req.params.id);
  if (next.length === list.length) return res.status(404).json({ error: 'No encontrada' });
  save(next);
  res.json({ success: true });
});

// POST /api/schedules/:id/run → ejecuta ahora
router.post('/:id/run', async (req, res) => {
  const s = load().find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'No encontrada' });
  const result = await trigger(s);
  if (!result.ok) return res.status(409).json({ error: result.reason });
  res.json({ success: true });
});

module.exports = router;
