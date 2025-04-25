const express = require('express');
const { getConfig } = require('./config');
const { handleWhoami, handleShowtrust, handleStats, handleStatus } = require('./api-handlers');
const { validateJwt } = require('./jwt-middleware');

const app = express();
const config = getConfig();

// Middleware for logging requests (basic)
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Apply JWT validation middleware to all routes (for now)
// In a real application, you might apply this selectively
app.use(validateJwt);

// Define API endpoints
app.get('/whoami', handleWhoami);
app.get('/showtrust', handleShowtrust);
app.get('/stats', handleStats);
app.get('/status', handleStatus);

const startServer = () => {
  const server = app.listen(config.mcpPort, config.mcpHost, () => {
    console.log(`MCP server listening on http://${config.mcpHost}:${config.mcpPort}`);
  });

  // Handle server shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
      console.log('HTTP server closed');
    });
  });
};

// Only start the server if this file is run directly
if (require.main === module) {
  startServer();
}

module.exports = {
  app, // Export app for testing
  startServer,
};