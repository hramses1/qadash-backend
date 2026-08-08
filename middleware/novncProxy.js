// Proxy de /novnc hacia el noVNC del contenedor selenium (puerto 7900).
//
// Antes esto lo hacia el proxy del dev server de Vite, que solo existe cuando
// se corre `vite dev`. En la app de escritorio (Electron carga desde file://)
// y en el build de produccion no hay tal proxy, asi que el enlace "ver
// navegador en vivo" abria una pestana en blanco.
//
// Se implementa con el modulo http de Node en vez de http-proxy-middleware
// para no anadir dependencias. noVNC necesita websocket (/websockify), asi que
// ademas del proxy HTTP hay que reenviar el upgrade de la conexion.

const http = require('http');
const net = require('net');

const TARGET_HOST = process.env.QADASH_NOVNC_HOST || '127.0.0.1';
const TARGET_PORT = parseInt(process.env.QADASH_NOVNC_PORT || '7900', 10);
const PREFIX = '/novnc';

function stripPrefix(url) {
  const rest = url.slice(PREFIX.length);
  return rest.startsWith('/') ? rest : `/${rest}`;
}

module.exports = function novncProxy(app, server) {
  // ── HTTP ────────────────────────────────────────────────────────
  app.use(PREFIX, (req, res) => {
    // req.url dentro de app.use ya viene sin el prefijo.
    const target = req.url.startsWith('/') ? req.url : `/${req.url}`;

    const upstream = http.request(
      {
        host: TARGET_HOST,
        port: TARGET_PORT,
        method: req.method,
        path: target,
        headers: { ...req.headers, host: `${TARGET_HOST}:${TARGET_PORT}` },
      },
      (up) => {
        res.writeHead(up.statusCode || 502, up.headers);
        up.pipe(res);
      },
    );

    upstream.on('error', (err) => {
      if (res.headersSent) return res.destroy();
      res.status(502).type('text/plain').send(
        `No se pudo contactar el noVNC en ${TARGET_HOST}:${TARGET_PORT}.\n` +
        `Levanta el contenedor selenium (vista Docker) y reintenta.\n\n${err.message}`,
      );
    });

    req.pipe(upstream);
  });

  // ── WebSocket ───────────────────────────────────────────────────
  // socket.io tiene su propio manejador de upgrade sobre el mismo server; hay
  // que dejar pasar lo que no sea nuestro o se rompe el socket del dashboard.
  server.on('upgrade', (req, socket, head) => {
    if (!req.url || !req.url.startsWith(PREFIX)) return;

    const upstream = net.connect(TARGET_PORT, TARGET_HOST, () => {
      const path = stripPrefix(req.url);
      const headers = Object.entries(req.headers)
        .filter(([k]) => k.toLowerCase() !== 'host')
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join('\r\n');

      upstream.write(
        `GET ${path} HTTP/1.1\r\n` +
        `Host: ${TARGET_HOST}:${TARGET_PORT}\r\n` +
        `${headers}\r\n\r\n`,
      );
      if (head && head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });

    // Sin estos handlers un fallo del contenedor tumbaria el proceso entero
    // con un error no capturado.
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });

  console.log(`[novnc] proxy ${PREFIX} -> ${TARGET_HOST}:${TARGET_PORT}`);
};
