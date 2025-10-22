const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const config = require('../config');
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
    const anchorPubPath = path.join(federationsDir, fedName, 'keys', 'anchor-public.pem')

    console.log(`🔍 Token validation - Issuer: ${issuer}`)
    console.log(`🔍 Looking for anchor key at: ${anchorPubPath}`)

    // Case: issued by federation anchor
    if (issuer === `http://localhost:${config.federations.port}`) {
      if (!fs.existsSync(anchorPubPath)) {
        console.error(`❌ Federation public key missing at: ${anchorPubPath}`)
        return { valid: false, reason: 'Federation public key missing' }
      }
      const verification = certificateUtils.verifyJwt(token, anchorPubPath, { algorithms: ['RS256'] })
      return verification.valid
        ? { valid: true, reason: 'Verified by anchor', payload: verification.payload }
        : { valid: false, reason: verification.reason }
    }

    // Case: issued by another federated OP
    // Attempt to find entity statement for this issuer
    const registryPath = config.federations.registryPath
    if (!fs.existsSync(registryPath)) {
      console.error(`❌ Registry file missing at: ${registryPath}`)
      return { valid: false, reason: 'Registry file missing' }
    }

    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'))
    const stmtJwt = registry.entityStatements && registry.entityStatements[issuer]
    if (stmtJwt) {
      if (!fs.existsSync(anchorPubPath)) return { valid: false, reason: 'Anchor key missing for trust chain' }
      const chainResult = certificateUtils.validateTrustChain([stmtJwt, token], anchorPubPath)
      return chainResult.valid
        ? { valid: true, reason: 'Verified via trust chain', payload: jwt.decode(token) }
        : { valid: false, reason: 'Trust chain validation failed' }
    }

    // Check if this is a token from the OIDC server mock
    if (issuer === 'http://localhost:8080') {
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

    // Unrecognized issuer
    return { valid: false, reason: `Unknown issuer: ${issuer}` }

  } catch (err) {
    console.error(`❌ Token validation error: ${err.message}`)
    return { valid: false, reason: `Validation error: ${err.message}` }
  }
}

module.exports = { validateToken };
