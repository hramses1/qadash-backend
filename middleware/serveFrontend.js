// Sirve el build de produccion del frontend desde el propio backend.
//
// Antes el servidor corria `vite dev`, que entrega cada modulo por separado y
// sin minificar: 65 peticiones y 3.4 MB por carga. Eso se nota sobre todo en
// tablet o telefono por wifi, donde cada round-trip cuesta. El build son 2
// archivos y ~380 KB comprimidos.

const express = require('express');
const fs = require('fs');
const path = require('path');

const DIST = process.env.QADASH_DIST_DIR
  || path.resolve(__dirname, '..', '..', 'qadash-frontend', 'dist');

module.exports = function serveFrontend(app) {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.warn(`[frontend] no hay build en ${DIST}; el backend solo servira /api. Ejecuta "npm run build" en qadash-frontend.`);
    return false;
  }

  // Sirve el .gz precomprimido cuando el cliente lo acepta. Se hace antes de
  // express.static para poder fijar Content-Type y Content-Encoding a mano:
  // si no, el navegador recibiria el gzip como si fuera texto plano.
  app.get(/\.(js|css|html|svg|json|map)$/, (req, res, next) => {
    if (!/\bgzip\b/.test(req.headers['accept-encoding'] || '')) return next();

    // path.join con una ruta del cliente permitiria salirse de DIST con "..".
    // normalize + comprobacion de prefijo lo impide.
    const rel = path.normalize(decodeURIComponent(req.path)).replace(/^([/\\])+/, '');
    const target = path.join(DIST, rel);
    if (!target.startsWith(DIST)) return res.status(403).end();

    const gz = `${target}.gz`;
    if (!fs.existsSync(gz)) return next();

    res.set('Content-Encoding', 'gzip');
    res.type(path.extname(target));
    // Vary evita que un proxy sirva el gzip a un cliente que no lo acepta.
    res.set('Vary', 'Accept-Encoding');
    if (req.path.startsWith('/assets/')) {
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
    }
    res.sendFile(gz);
  });

  app.use(express.static(DIST, {
    setHeaders(res, filePath) {
      // Los assets llevan hash en el nombre: cambian de nombre al cambiar de
      // contenido, asi que se pueden cachear para siempre sin quedarse viejos.
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        // index.html no: es quien apunta a los assets nuevos tras un deploy.
        res.set('Cache-Control', 'no-cache');
      }
    },
  }));

  // Fallback de SPA: el router usa history, asi que /reportes o /configuracion
  // deben devolver index.html en vez de 404. Se excluye /api y /socket.io para
  // no tragarse rutas reales del backend.
  app.get(/^\/(?!api\/|socket\.io\/|novnc\/).*/, (req, res, next) => {
    if (req.method !== 'GET') return next();
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(DIST, 'index.html'));
  });

  console.log(`[frontend] sirviendo build desde ${DIST}`);
  return true;
};
