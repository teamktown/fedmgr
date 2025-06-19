// src/fedmgr/config.js
require('dotenv').config();

const path = require('path');
const fs = require('fs');

// Base directory for fedmgr - resolve relative to this file's location
const FEDMGR_HOME = process.env.FEDMGR_HOME || path.resolve(__dirname, '../..');
const FEDMGR_FEDERATIONS_DIR = process.env.FEDMGR_FEDERATIONS_DIR || path.join(FEDMGR_HOME, 'federations');

// Registry directory and file with validation
let FEDMGR_FED_REG_DIR = process.env.FEDMGR_FED_REG_DIR || process.env.FEDMGR_FED_REG || path.join(FEDMGR_HOME, 'data', 'fed-reg');
let FEDMGR_FED_REG_FILE = process.env.FEDMGR_FED_REG_FILE || path.join(FEDMGR_FED_REG_DIR, 'registry.json');

// Validate and fix common registry path issues
if (fs.existsSync(FEDMGR_FED_REG_FILE)) {
  try {
    const stat = fs.statSync(FEDMGR_FED_REG_FILE);
    if (stat.isDirectory()) {
      console.warn(`⚠️  Registry path points to directory: ${FEDMGR_FED_REG_FILE}`);
      FEDMGR_FED_REG_FILE = path.join(FEDMGR_FED_REG_FILE, 'registry.json');
      console.log(`🔧 Corrected registry path: ${FEDMGR_FED_REG_FILE}`);
    }
  } catch (error) {
    // Path doesn't exist yet, which is fine
  }
}

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

// Validate critical paths
const validationErrors = [];

if (!path.isAbsolute(resolvedPaths.registryFile)) {
  validationErrors.push(`Registry file path is not absolute: ${resolvedPaths.registryFile}`);
}

if (resolvedPaths.registryFile.endsWith('/') || resolvedPaths.registryFile.endsWith('\\')) {
  validationErrors.push(`Registry file path appears to be a directory: ${resolvedPaths.registryFile}`);
}

if (validationErrors.length > 0) {
  console.error('❌ Configuration validation errors:');
  validationErrors.forEach(error => console.error(`   - ${error}`));
  console.error('   Run "fedmgr init --fix" to repair configuration');
}

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
    defaultName: process.env.FEDMGR_DEF_FED || 'alpha',
    port: process.env.FEDMGR_FEDERATION_PORT || 3001
  },
  validation: {
    errors: validationErrors,
    isValid: validationErrors.length === 0
  }
};
