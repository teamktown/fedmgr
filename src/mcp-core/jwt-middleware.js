// Basic JWT validation middleware
const validateJwt = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (token == null) {
    // No token provided
    return res.sendStatus(401); // Unauthorized
  }

  // Basic check: for now, just check if the token is 'valid-token'
  // In a real implementation, this would involve verifying the token signature,
  // checking claims, expiration, etc.
  if (token === 'valid-token') {
    // Token is valid (for this basic check)
    next();
  } else {
    // Invalid token
    res.sendStatus(403); // Forbidden
  }
};

module.exports = {
  validateJwt,
};