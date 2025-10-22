const { getWhoami, getTrustedEntities, getStats, getStatus } = require('./core-logic');

const handleWhoami = (req, res) => {
  try {
    const whoamiData = getWhoami();
    res.json(whoamiData);
  } catch (error) {
    console.error('Error handling /whoami:', error);
    res.status(500).json({ errorCode: 'INTERNAL_ERROR', errorMessage: 'Failed to retrieve identity information.' });
  }
};

const handleShowtrust = (req, res) => {
  try {
    const trustedEntities = getTrustedEntities();
    res.json(trustedEntities);
  } catch (error) {
    console.error('Error handling /showtrust:', error);
    res.status(500).json({ errorCode: 'INTERNAL_ERROR', errorMessage: 'Failed to retrieve trusted entities.' });
  }
};

const handleStats = (req, res) => {
  try {
    const stats = getStats();
    res.json(stats);
  } catch (error) {
    console.error('Error handling /stats:', error);
    res.status(500).json({ errorCode: 'INTERNAL_ERROR', errorMessage: 'Failed to retrieve statistics.' });
  }
};

const handleStatus = (req, res) => {
  try {
    const status = getStatus();
    res.json(status);
  } catch (error) {
    console.error('Error handling /status:', error);
    res.status(500).json({ errorCode: 'INTERNAL_ERROR', errorMessage: 'Failed to retrieve status.' });
  }
};

module.exports = {
  handleWhoami,
  handleShowtrust,
  handleStats,
  handleStatus,
};