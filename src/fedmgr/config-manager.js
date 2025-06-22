const fs = require('fs');
const path = require('path');

function loadJson(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    return fallback;
  }
}

function saveJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function loadRegistry(registryPath) {
  return loadJson(registryPath, { federations: [], mcps: {}, users: {}, mcpProtocolServers: {} });
}

function saveRegistry(registryPath, data) {
  saveJson(registryPath, data);
}

function loadEntityConfig(file) {
  return loadJson(file, {});
}

function saveEntityConfig(file, data) {
  saveJson(file, data);
}

module.exports = {
  loadJson,
  saveJson,
  loadRegistry,
  saveRegistry,
  loadEntityConfig,
  saveEntityConfig,
};
