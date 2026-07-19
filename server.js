const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const requireFeature = require('./middleware/requireFeature');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());

// ── Ensure all required dirs/files exist on every startup ──────────
const DIRS = ['reports', 'data', 'profiles'];
DIRS.forEach(d => {
  const p = path.join(__dirname, d);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  fs.writeFileSync(configPath, JSON.stringify({
    projectPath: '', envPath: '', pytestCmd: 'pytest',
    installPath: '', repoUrl: ''
  }, null, 2));
}

const profilesPath = path.join(__dirname, 'profiles.json');
if (!fs.existsSync(profilesPath)) {
  fs.writeFileSync(profilesPath, JSON.stringify({}, null, 2));
}

app.set('io', io);

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
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// Programador de tests (calendarización): revisa cada minuto y dispara.
require('./services/scheduler').start(io);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
