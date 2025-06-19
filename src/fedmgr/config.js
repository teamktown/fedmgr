// src/fedmgr/config.js
require('dotenv').config();

const path = require('path');

// Base directory for fedmgr - resolve relative to this file's location
const FEDMGR_HOME = process.env.FEDMGR_HOME || path.resolve(__dirname, '../..');
const FEDMGR_FEDERATIONS_DIR = process.env.FEDMGR_FEDERATIONS_DIR || path.join(FEDMGR_HOME, 'federations');

// Registry directory and file
// FEDMGR_FED_REG_DIR can point at a directory
const FEDMGR_FED_REG_DIR = process.env.FEDMGR_FED_REG_DIR || path.join(FEDMGR_HOME, 'data', 'fed-reg');
// FEDMGR_FED_REG_FILE explicitly points at the registry JSON file
const FEDMGR_FED_REG_FILE = process.env.FEDMGR_FED_REG_FILE || path.join(FEDMGR_FED_REG_DIR, 'registry.json');

// Ensure we have absolute paths
const resolvedPaths = {
  home: path.resolve(FEDMGR_HOME),
  federations: path.resolve(FEDMGR_FEDERATIONS_DIR),
  registryDir: path.resolve(FEDMGR_FED_REG_DIR),
  registryFile: path.resolve(FEDMGR_FED_REG_FILE)
};

console.log('🔧 Configuration paths resolved:');
console.log(`   FEDMGR_HOME: ${resolvedPaths.home}`);
console.log(`   FEDERATIONS_DIR: ${resolvedPaths.federations}`);
console.log(`   REGISTRY_DIR: ${resolvedPaths.registryDir}`);
console.log(`   REGISTRY_FILE: ${resolvedPaths.registryFile}`);

module.exports = {
  paths: resolvedPaths,
  oidcProvider: {
    host: process.env.OIDC_PROVIDER_HOST || 'localhost',
    port: process.env.OIDC_PROVIDER_PORT || '6432',
    internalPort: process.env.OIDC_PROVIDER_INTERNAL_PORT || '3000',
    url: process.env.OIDC_PROVIDER_URL || `http://localhost:${process.env.OIDC_PROVIDER_PORT || '6432'}`
  },
  federations: {
    directory: resolvedPaths.federations,
    registryDir: resolvedPaths.registryDir,
    registryPath: resolvedPaths.registryFile,
    defaultName: process.env.FEDMGR_DEFAULT_FEDERATION || 'alpha',
    port: process.env.FEDMGR_FEDERATION_PORT || 3001
  }
};
