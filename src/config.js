// src/config.js
require('dotenv').config();

module.exports = {
  oidcProvider: {
    host: process.env.OIDC_PROVIDER_HOST || 'localhost',
    port: process.env.OIDC_PROVIDER_PORT || '6432',
    internalPort: process.env.OIDC_PROVIDER_INTERNAL_PORT || '3000',
    url: process.env.OIDC_PROVIDER_URL || `http://localhost:${process.env.OIDC_PROVIDER_PORT || '6432'}`
  },
  // Add other configuration sections as needed
};
