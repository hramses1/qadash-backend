const pm = require('../services/profileManager');

module.exports = function resolveProfile(req, res, next) {
  const headerId = req.headers['x-profile-id'];
  const id = headerId || pm.getActiveProfileId();
  if (!id) return res.status(400).json({ error: 'No hay perfil configurado' });
  try {
    req.profile = pm.resolveProfile(id);
    next();
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};
