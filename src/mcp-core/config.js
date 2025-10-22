const path = require('path');

const getConfig = () => {
  const config = {
    mcpPort: process.env.MCP_PORT || 3000, // Default to 3000 if not set
    mcpHost: process.env.MCP_HOST || '0.0.0.0',
    mcpId: process.env.MCP_ID,
    mcpPublicKey: process.env.MCP_PUBLIC_KEY,
    mcpBaseUrl: process.env.MCP_BASE_URL,
    trustStorePath: process.env.TRUST_STORE_PATH,
    statsStoragePath: process.env.STATS_STORAGE_PATH,
    publicDir: process.env.MCP_PUBLIC_DIR || path.join(__dirname, '../../public'),
    // Add other environment variables as needed
  };

  // Basic validation for required variables - made less strict for development
  const requiredVars = ['mcpId'];
  for (const varName of requiredVars) {
    if (!config[varName]) {
      console.warn(`WARNING: Missing environment variable: ${varName.toUpperCase()}`);
      // In a real application, you might throw an error or exit
      // process.exit(1);
    }
  }

  // Provide defaults for missing optional variables
  if (!config.mcpPublicKey) {
    config.mcpPublicKey = `${config.mcpId}-default-key`;
    console.warn(`Using default public key: ${config.mcpPublicKey}`);
  }

  if (!config.mcpBaseUrl) {
    config.mcpBaseUrl = `http://localhost:${config.mcpPort}`;
    console.warn(`Using default base URL: ${config.mcpBaseUrl}`);
  }

  if (!config.trustStorePath) {
    config.trustStorePath = path.join(__dirname, '../../data/trust-store.json');
    console.warn(`Using default trust store path: ${config.trustStorePath}`);
  }

  if (!config.statsStoragePath) {
    config.statsStoragePath = path.join(__dirname, '../../data/stats.json');
    console.warn(`Using default stats storage path: ${config.statsStoragePath}`);
  }

  return config;
};

module.exports = {
  getConfig,
};
