const fs = require('fs');
const path = require('path');

const REPORTS_DIR     = path.join(__dirname, '..', 'reports');
const COLLECTION_PATH = path.join(__dirname, '..', 'data', 'last-collection.json');

// Borra reportes + caché de colección. Se usa al cambiar de proyecto: la
// analítica e historial pertenecen al proyecto anterior y ya no aplican.
function resetProjectData() {
  let removedReports = 0;
  try {
    if (fs.existsSync(REPORTS_DIR)) {
      for (const f of fs.readdirSync(REPORTS_DIR)) {
        if (f.endsWith('.json')) {
          try { fs.unlinkSync(path.join(REPORTS_DIR, f)); removedReports++; } catch {}
        }
      }
    }
  } catch {}

  let removedCollection = false;
  try {
    if (fs.existsSync(COLLECTION_PATH)) {
      fs.unlinkSync(COLLECTION_PATH);
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
