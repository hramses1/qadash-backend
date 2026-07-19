const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const requireFeature = require('./middleware/requireFeature');
const resolveProfile = require('./middleware/resolveProfile');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());

// ── Migración y bootstrap de perfiles ──────────────────────────────
const { migrateIfNeeded } = require('./services/profileMigration');
const pm = require('./services/profileManager');
const migRes = migrateIfNeeded();
if (migRes.migrated) console.log('[profiles] migrado config global ->', migRes.id);
if (pm.listProfiles().length === 0) {
  const p = pm.createProfile('Perfil 1');
  console.log('[profiles] creado perfil inicial', p.id);
}

app.set('io', io);

// Gestión de perfiles: NO pasa por resolveProfile (opera sobre perfiles en sí).
app.use('/api/profile-admin', require('./routes/profileAdmin'));

// Todas las demás rutas de /api resuelven el perfil del request.
app.use('/api', resolveProfile);

app.use('/api/config', require('./routes/config'));
app.use('/api/tests', require('./routes/tests'));
app.use('/api/features', require('./routes/features'));
app.use('/api/env', requireFeature('variables'), require('./routes/env'));
app.use('/api/profiles', requireFeature('variables'), require('./routes/profiles'));
app.use('/api/reports', requireFeature('reports'), require('./routes/reports'));
app.use('/api/automation', require('./routes/automation'));
app.use('/api/txtdata', requireFeature('txtData'), require('./routes/txtdata'));
app.use('/api/jsondata', requireFeature('jsonData'), require('./routes/jsondata'));
app.use('/api/docker', requireFeature('docker'), require('./routes/docker'));
app.use('/api/schedules', requireFeature('schedules'), require('./routes/schedules'));
app.use('/api/errors', requireFeature('errorImages'), require('./routes/errors'));

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  // El cliente se une a la sala del/los perfil(es) que quiere monitorear.
  socket.on('profile:join', (id) => { if (id) socket.join(`profile:${id}`); });
  socket.on('profile:leave', (id) => { if (id) socket.leave(`profile:${id}`); });
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// Programador de tests (calendarización): revisa cada minuto y dispara.
require('./services/scheduler').start(io);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
