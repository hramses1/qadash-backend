const fs = require('fs');
const path = require('path');

const PROFILES_PATH = path.join(__dirname, '..', 'profiles.json');

function readProfiles() {
  if (!fs.existsSync(PROFILES_PATH)) return {};
  return JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf-8'));
}

function writeProfiles(profiles) {
  fs.writeFileSync(PROFILES_PATH, JSON.stringify(profiles, null, 2));
}

function getProfile(name) {
  const profiles = readProfiles();
  return profiles[name] || null;
}

module.exports = { readProfiles, writeProfiles, getProfile };
