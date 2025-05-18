// src/config.js
require('dotenv').config();

// Set up paths based on environment variables or defaults
const path = require('path');
const FEDMGR_HOME = process.env.FEDMGR_HOME || path.resolve(__dirname, '..');
const FEDMGR_FEDERATIONS_DIR = process.env.FEDMGR_FEDERATIONS_DIR || path.join(FEDMGR_HOME, 'federations');
const FEDMGR_FED_REG = process.env.FEDMGR_FED_REG || path.join(FEDMGR_HOME, 'data', 'registry.json');

module.exports = {
  oidcProvider: {
    host: process.env.OIDC_PROVIDER_HOST || 'localhost',
    port: process.env.OIDC_PROVIDER_PORT || '6432',
    internalPort: process.env.OIDC_PROVIDER_INTERNAL_PORT || '3000',
    url: process.env.OIDC_PROVIDER_URL || `http://localhost:${process.env.OIDC_PROVIDER_PORT || '6432'}`
  },
  federations: {
    directory: FEDMGR_FEDERATIONS_DIR,
    registryPath: FEDMGR_FED_REG
  },
  // Add other configuration sections as needed
};
