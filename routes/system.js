const express = require('express');
const router = express.Router();
const { statusAll, updateAll } = require('../services/selfUpdate');

// El endpoint de actualización ejecuta `git pull` y `npm install`, o sea código
// arbitrario del repo remoto. Este dashboard se publica por un túnel de
// Cloudflare, así que sin protección cualquiera con la URL podría dispararlo.
//
// Por eso viene DESHABILITADO por defecto: hay que definir UPDATE_TOKEN en el
// entorno del backend. El token no se envía en el bundle del frontend — lo
// teclea la persona al pulsar el botón — porque cualquier cosa incrustada en
// el JS es pública para quien cargue la página.
function requireUpdateToken(req, res, next) {
  const expected = process.env.UPDATE_TOKEN;
  if (!expected) {
    return res.status(503).json({
      error: 'La actualización remota está deshabilitada. Define UPDATE_TOKEN en el entorno del backend para activarla.',
      disabled: true,
    });
  }
  const given = req.get('x-update-token') || '';
  // Comparación de longitud constante para no filtrar el token carácter a
  // carácter mediante diferencias de tiempo.
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  const ok = a.length === b.length && require('crypto').timingSafeEqual(a, b);
  if (!ok) return res.status(401).json({ error: 'Token de actualización inválido.' });
  next();
}

// Estado de ambos repos. Es solo lectura (fetch + conteo), así que no pide
// token: sirve para que el dashboard muestre "hay N actualizaciones".
router.get('/updates', async (req, res) => {
  try {
    res.json({ repos: await statusAll(), enabled: !!process.env.UPDATE_TOKEN });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

let running = false;

router.post('/update', requireUpdateToken, async (req, res) => {
  // Dos actualizaciones simultáneas se pisarían en el mismo working tree.
  if (running) return res.status(409).json({ error: 'Ya hay una actualización en curso.' });
  running = true;

  const io = req.app.get('io');
  const emit = (message, type = 'info') => {
    if (io) io.emit('system:update', { message, type, at: Date.now() });
  };

  try {
    emit('Buscando actualizaciones…', 'info');
    const results = await updateAll(emit);
    const cambiaron = results.filter(r => r.updated);
    emit(
      cambiaron.length
        ? `Listo: ${cambiaron.map(r => r.key).join(' y ')} actualizado(s).`
        : 'Todo estaba al día.',
      'success',
    );
    res.json({ success: true, results });
  } catch (e) {
    emit(`Falló: ${e.message}`, 'error');
    res.status(500).json({ error: e.message });
  } finally {
    running = false;
  }
});

module.exports = router;
