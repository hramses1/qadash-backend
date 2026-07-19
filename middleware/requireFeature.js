const { getFlags } = require('../services/featureFlags');

function requireFeature(key) {
  return (req, res, next) => {
    const flags = getFlags(req.profile.features);
    if (flags[key] === false) {
      return res.status(403).json({
        error: `Módulo "${key}" desactivado para este perfil`,
        feature: key
      });
    }
    next();
  };
}

module.exports = requireFeature;
