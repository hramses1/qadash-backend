// Estado runtime por perfil. Permite ejecución paralela: cada perfil tiene su
// propio conjunto de "kinds" activos (tests, docker, install, pull). Emite
// `profiles:status` global (broadcast) para que la UI pinte badges "corriendo".

const busy = new Map(); // profileId -> Set<kind>

function _set(profileId) {
  if (!busy.has(profileId)) busy.set(profileId, new Set());
  return busy.get(profileId);
}

function statusList() {
  const out = [];
  for (const [id, kinds] of busy.entries()) {
    if (kinds.size) out.push({ id, running: true, kinds: [...kinds] });
  }
  return out;
}

function emitStatus(io) {
  if (io) io.emit('profiles:status', statusList());
}

function start(io, profileId, kind) {
  _set(profileId).add(kind);
  emitStatus(io);
}

function stop(io, profileId, kind) {
  const s = _set(profileId);
  s.delete(kind);
  if (!s.size) busy.delete(profileId);
  emitStatus(io);
}

function isKindRunning(profileId, kind) {
  const s = busy.get(profileId);
  return !!(s && s.has(kind));
}

function isProfileBusy(profileId) {
  const s = busy.get(profileId);
  return !!(s && s.size);
}

module.exports = { start, stop, isKindRunning, isProfileBusy, statusList, emitStatus };
