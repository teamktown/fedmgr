// src/config.js
require('dotenv').config();

const path = require('path');

// Base directory for fedmgr
const FEDMGR_HOME = process.env.FEDMGR_FEDMGR_HOME || path.resolve(__dirname, '..');
const FEDMGR_FEDERATIONS_DIR = process.env.FEDMGR_FEDERATIONS_DIR || path.join(FEDMGR_HOME, 'federations');

// Registry directory and file
// FEDMGR_FED_REG_DIR can point at a directory
const FEDMGR_FED_REG_DIR = process.env.FEDMGR_FED_REG || path.join(FEDMGR_HOME, 'data', 'fed-reg');
// FEDMGR_FED_REG_FILE explicitly points at the registry JSON file
const FEDMGR_FED_REG_FILE = process.env.FEDMGR_FED_REG_FILE 
//|| path.join(FEDMGR_FED_REG_DIR, 'registry.json');

module.exports = {
  oidcProvider: {
    host: process.env.OIDC_PROVIDER_HOST || 'localhost',
    port: process.env.OIDC_PROVIDER_PORT || '6432',
    internalPort: process.env.OIDC_PROVIDER_INTERNAL_PORT || '3000',
    url: process.env.OIDC_PROVIDER_URL || `http://localhost:${process.env.OIDC_PROVIDER_PORT || '6432'}`
  },
  federations: {
    directory: FEDMGR_FEDERATIONS_DIR,
    registryDir: FEDMGR_FED_REG_DIR,
    registryPath: FEDMGR_FED_REG_FILE
  }
};
