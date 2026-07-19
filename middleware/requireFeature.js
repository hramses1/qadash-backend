const { getFlags } = require('../services/featureFlags');

function requireFeature(key) {
  return (req, res, next) => {
    const flags = getFlags();
    if (flags[key] === false) {
      return res.status(403).json({
        error: `Módulo "${key}" desactivado para este proyecto`,
        feature: key
      });
    }
    next();
  };
}

module.exports = requireFeature;
