const getConfig = () => {
  const config = {
    mcpPort: process.env.MCP_PORT || 3000, // Default to 3000 if not set
    mcpHost: process.env.MCP_HOST || '0.0.0.0',
    mcpId: process.env.MCP_ID,
    mcpPublicKey: process.env.MCP_PUBLIC_KEY,
    mcpBaseUrl: process.env.MCP_BASE_URL,
    trustStorePath: process.env.TRUST_STORE_PATH,
    statsStoragePath: process.env.STATS_STORAGE_PATH,
    // Add other environment variables as needed
  };

  // Basic validation for required variables
  const requiredVars = ['mcpId', 'mcpPublicKey', 'mcpBaseUrl', 'trustStorePath', 'statsStoragePath'];
  for (const varName of requiredVars) {
    if (!config[varName]) {
      console.error(`FATAL ERROR: Missing required environment variable: ${varName.toUpperCase()}`);
      // In a real application, you might throw an error or exit
      // process.exit(1);
    }
  }

  return config;
};

module.exports = {
  getConfig,
};