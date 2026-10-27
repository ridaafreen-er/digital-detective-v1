const { handle, initializeDatabase } = require('../server.js');

let initialized = false;

module.exports = async function (req, res) {
  if (!initialized) {
    try {
      await initializeDatabase();
      initialized = true;
    } catch (error) {
      console.error('Failed to initialize MongoDB in serverless function:', error);
    }
  }

  // Preserve original API pathname if rewritten by Vercel
  if (req.headers['x-matched-path'] && req.headers['x-matched-path'].startsWith('/api/')) {
    req.url = req.headers['x-matched-path'];
  }

  return handle(req, res);
};

