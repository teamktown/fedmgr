const jwt = require('jsonwebtoken');
const fs = require('fs');

/**
 * Admin Authentication Middleware
 * Validates JWT tokens and ensures user has admin privileges
 */

function createAdminMiddleware(publicKeyPath) {
  let publicKey;
  
  try {
    publicKey = fs.readFileSync(publicKeyPath, 'utf-8');
  } catch (error) {
    console.error('❌ Failed to load public key for admin middleware:', error.message);
    throw error;
  }

  return function adminMiddleware(req, res, next) {
    try {
      // Extract JWT token from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Missing or invalid Authorization header'
        });
      }

      const token = authHeader.substring(7); // Remove 'Bearer ' prefix

      // Verify and decode JWT token
      let decoded;
      try {
        decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
      } catch (jwtError) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid or expired token'
        });
      }

      // Check if user has admin privileges
      if (!decoded.admin && decoded.role !== 'admin' && !decoded.roles?.includes('admin')) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Admin privileges required'
        });
      }

      // Add user info to request object for downstream use
      req.user = {
        id: decoded.sub,
        login: decoded.preferred_username,
        name: decoded.name,
        email: decoded.email,
        admin: decoded.admin || false,
        role: decoded.role,
        roles: decoded.roles || []
      };

      console.log(`🔐 Admin access granted to: ${req.user.login}`);
      next();
    } catch (error) {
      console.error('❌ Admin middleware error:', error.message);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Authentication check failed'
      });
    }
  };
}

/**
 * Create a simplified auth middleware that just validates JWT without admin check
 * Useful for general authenticated endpoints
 */
function createAuthMiddleware(publicKeyPath) {
  let publicKey;
  
  try {
    publicKey = fs.readFileSync(publicKeyPath, 'utf-8');
  } catch (error) {
    console.error('❌ Failed to load public key for auth middleware:', error.message);
    throw error;
  }

  return function authMiddleware(req, res, next) {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Missing or invalid Authorization header'
        });
      }

      const token = authHeader.substring(7);

      let decoded;
      try {
        decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
      } catch (jwtError) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid or expired token'
        });
      }

      req.user = {
        id: decoded.sub,
        login: decoded.preferred_username,
        name: decoded.name,
        email: decoded.email,
        admin: decoded.admin || false,
        role: decoded.role,
        roles: decoded.roles || []
      };

      next();
    } catch (error) {
      console.error('❌ Auth middleware error:', error.message);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Authentication check failed'
      });
    }
  };
}

/**
 * Utility function to check if current user is admin
 * Can be used in route handlers that use authMiddleware
 */
function requireAdmin(req, res, next) {
  if (!req.user?.admin && req.user?.role !== 'admin' && !req.user?.roles?.includes('admin')) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Admin privileges required'
    });
  }
  next();
}

module.exports = {
  createAdminMiddleware,
  createAuthMiddleware,
  requireAdmin
};