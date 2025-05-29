// Only showing the modified validateToken function, the rest of the file remains unchanged
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const config = require('./config');
const certificateUtils = require('./utils/certificate-utils');

// Validate JWT token
async function validateToken(token) {
  if (!token || token === 'none') {
    return { valid: false, reason: 'Missing token' };
  }

  try {
    const segments = token.split('.')
    if (segments.length !== 3) return { valid: false, reason: 'Invalid token format' }

    const decoded = jwt.decode(token, { complete: true })
    if (!decoded) return { valid: false, reason: 'Failed to decode token' }

    const issuer = decoded.payload.iss
    const fedName = config.federations.defaultName || 'alpha'
    const federationsDir = config.federations.directory
    const anchorPubPath = path.join(federationsDir, fedName, 'keys/anchor-public.pem')

    // Case: issued by federation anchor
    if (issuer === `http://localhost:${config.federations.port}`) {
      if (!fs.existsSync(anchorPubPath)) return { valid: false, reason: 'Federation public key missing' }
      const verification = certificateUtils.verifyJwt(token, anchorPubPath, { algorithms: ['RS256'] })
      return verification.valid
        ? { valid: true, reason: 'Verified by anchor', payload: verification.payload }
        : { valid: false, reason: verification.reason }
    }

    // Case: issued by another federated OP
    // Attempt to find entity statement for this issuer
    const registry = JSON.parse(fs.readFileSync(config.federations.registryPath, 'utf-8'))
    const stmtJwt = registry.entityStatements && registry.entityStatements[issuer]
    if (stmtJwt) {
      if (!fs.existsSync(anchorPubPath)) return { valid: false, reason: 'Anchor key missing for trust chain' }
      const chainResult = certificateUtils.validateTrustChain([stmtJwt, token], anchorPubPath)
      return chainResult.valid
        ? { valid: true, reason: 'Verified via trust chain', payload: jwt.decode(token) }
        : { valid: false, reason: 'Trust chain validation failed' }
    }

    // Unrecognized issuer
    return { valid: false, reason: `Unknown issuer: ${issuer}` }

  } catch (err) {
    return { valid: false, reason: `Validation error: ${err.message}` }
  }
};
  
  
  try {
    // Check if it looks like a JWT (three dot-separated segments)
    const segments = token.split('.');
    if (segments.length !== 3) {
      return { valid: false, reason: 'Invalid token format' };
    }
    
    // First, decode the token without verification to check the issuer
    const decoded = jwt.decode(token, { complete: true });
    
    if (!decoded) {
      return { valid: false, reason: 'Failed to decode token' };
    }
    
    // Get the issuer from the decoded token
    const issuer = decoded.payload.iss;
    
    // Check if this is a token from our federation or from the OIDC server
    if (issuer === 'http://localhost:3001') {
      // This is from our federation, so we can verify it
      const fedPublicKeyPath = path.join(config.federations.directory, 'alpha/keys/anchor-public.pem');
      
      if (!fs.existsSync(fedPublicKeyPath)) {
        return { valid: false, reason: 'Federation public key not available' };
      }
      
      // Use certificate utilities to verify the token
      const verificationResult = certificateUtils.verifyJwt(token, fedPublicKeyPath, {
        algorithms: ['RS256']
      });
      
      if (verificationResult.valid) {
        return {
          valid: true,
          reason: 'Token signature verified',
          payload: verificationResult.payload
        };
      } else {
        return {
          valid: false,
          reason: verificationResult.reason
        };
      }
    } 
    // Check if this is a token from the OIDC server mock
    else if (issuer === 'http://localhost:8080') {
      // For tokens from the OIDC server, we need to fetch its JWKS
      // In a real implementation, we would cache this JWKS
      
      // For simplicity in this demo, we'll accept tokens from the OIDC server
      // A real implementation would verify them against the OIDC server's JWKS
      
      // Extract the claims we need
      const { sub, federation } = decoded.payload;
      
      // Check if the token has the required federation claim
      if (!federation || federation !== 'fed-alpha') {
        return { valid: false, reason: 'Token does not contain required federation claim' };
      }
      
      return {
        valid: true,
        reason: 'Token from trusted OIDC provider accepted',
        payload: decoded.payload
      };
    } 
    else {
      // For other issuers, we would need to fetch their public key
      return { valid: false, reason: `Unknown issuer: ${issuer}` };
    }
  } catch (error) {
    return {
      valid: false,
      reason: `Token validation failed: ${error.message}`
    };
  }

