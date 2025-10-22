const { getConfig } = require('./config');
const fs = require('fs');
const path = require('path');

const getWhoami = () => {
  const config = getConfig();
  return {
    id: config.mcpId,
    publicKey: config.mcpPublicKey,
    endpoints: {
      showtrust: `${config.mcpBaseUrl}/showtrust`,
      stats: `${config.mcpBaseUrl}/stats`,
      status: `${config.mcpBaseUrl}/status`,
    },
  };
};

const getTrustedEntities = () => {
  const config = getConfig();
  const trustStorePath = path.resolve(config.trustStorePath);
  try {
    const trustData = fs.readFileSync(trustStorePath, 'utf8');
    return { trusted: JSON.parse(trustData) };
  } catch (error) {
    console.error('Error reading trust store:', error);
    // In a real application, handle specific file not found vs parsing errors
    return { trusted: [] }; // Return empty array on error
  }
};

const getStats = () => {
  const config = getConfig();
  const statsStoragePath = path.resolve(config.statsStoragePath);
  try {
    const statsData = fs.readFileSync(statsStoragePath, 'utf8');
    return JSON.parse(statsData);
  } catch (error) {
    console.error('Error reading stats storage:', error);
    // Return default stats on error
    return {
      messageCount: { received: 0, sent: 0, processed: 0, errors: 0 },
      federationCount: 0,
      trustedMcpCount: 0,
      uptimeSeconds: 0, // This would need to be calculated in a real app
    };
  }
};

const getStatus = () => {
  // In a real application, this would check dependencies like database, etc.
  // For now, return a simple 'ok' status
  return {
    status: 'ok',
    details: {
      database: 'unknown', // Placeholder
      federationConnections: 'unknown', // Placeholder
      messageQueue: 'unknown', // Placeholder
    },
    lastChecked: new Date().toISOString(),
  };
};

module.exports = {
  getWhoami,
  getTrustedEntities,
  getStats,
  getStatus,
};