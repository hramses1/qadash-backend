const fs = require('fs');
const path = require('path');

// Borra reportes + caché de colección de un perfil. Se usa al cambiar de
// proyecto: la analítica e historial pertenecen al proyecto anterior.
function resetProjectData(reportsDir, collectionPath) {
  let removedReports = 0;
  try {
    if (reportsDir && fs.existsSync(reportsDir)) {
      for (const f of fs.readdirSync(reportsDir)) {
        if (f.endsWith('.json')) {
          try { fs.unlinkSync(path.join(reportsDir, f)); removedReports++; } catch {}
        }
      }
    }
  } catch {}

  let removedCollection = false;
  try {
    if (collectionPath && fs.existsSync(collectionPath)) {
      fs.unlinkSync(collectionPath);
      removedCollection = true;
    }
  } catch {}

  return { removedReports, removedCollection };
}

// Normaliza una ruta para comparar (separadores, slash final, mayúsculas en Windows).
function samePath(a, b) {
  const norm = (p) => {
    let s = path.resolve((p || '').trim()).replace(/[\\/]+$/, '');
    if (process.platform === 'win32') s = s.toLowerCase();
    return s;
  };
  if (!a || !b) return false;
  return norm(a) === norm(b);
}

module.exports = { resetProjectData, samePath };
