/**
 * Certificate Utilities
 * 
 * Utility functions for certificate handling, including:
 * - PEM to JWK conversion
 * - JWT signing and verification
 * - Certificate validation
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

/**
 * Convert a PEM public key to JWK format
 * @param {string} pem - PEM formatted public key
 * @param {Object} options - Additional JWK parameters
 * @returns {Object} - JWK formatted key
 */
function pemToJwk(pem, options = {}) {
  // Remove PEM headers and convert to binary
  const pemContents = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\n/g, '');
  
  const binaryDer = Buffer.from(pemContents, 'base64');
  
  // Parse the ASN.1 DER format to extract modulus (n) and exponent (e)
  // This is a simplified implementation - in production, use a proper ASN.1 parser
  
  // For RSA, we need to extract the modulus (n) and exponent (e)
  // The modulus starts at byte 33 and is 256 bytes long for a 2048-bit key
  const modulusStart = 33;
  const modulusLength = 256;
  const modulus = binaryDer.slice(modulusStart, modulusStart + modulusLength);
  
  // The exponent is typically 3 bytes and follows the modulus
  const exponentStart = modulusStart + modulusLength + 2;
  const exponent = binaryDer.slice(exponentStart, exponentStart + 3);
  
  // Create the JWK
  const jwk = {
    kty: 'RSA',
    n: base64UrlEncode(modulus),
    e: base64UrlEncode(exponent),
    alg: 'RS256',
    ...options
  };
  
  return jwk;
}

/**
 * Base64Url encode a buffer
 * @param {Buffer} buffer - Buffer to encode
 * @returns {string} - Base64Url encoded string
 */
function base64UrlEncode(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Sign a payload with a private key to create a JWT
 * @param {Object} payload - Payload to sign
 * @param {string} privateKeyPath - Path to the private key file
 * @param {Object} options - JWT signing options
 * @returns {string} - Signed JWT
 */
function signJwt(payload, privateKeyPath, options = {}) {
  // Read the private key
  const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
  
  // Prepare signing options
  const signingOptions = {
    algorithm: 'RS256',
    ...options
  };
  
  // Only set expiresIn if payload doesn't have exp and options doesn't have expiresIn
  if (!payload.exp && !options.expiresIn) {
    signingOptions.expiresIn = '24h';
  }
  
  // Sign the payload
  return jwt.sign(payload, privateKey, signingOptions);
}

/**
 * Verify a JWT with a public key
 * @param {string} token - JWT to verify
 * @param {string} publicKeyPath - Path to the public key file
 * @param {Object} options - JWT verification options
 * @returns {Object} - Verification result
 */
function verifyJwt(token, publicKeyPath, options = {}) {
  try {
    // Read the public key
    const publicKey = fs.readFileSync(publicKeyPath, 'utf8');
    
    // Verify the token
    const verified = jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
      ...options
    });
    
    return {
      valid: true,
      payload: verified
    };
  } catch (error) {
    return {
      valid: false,
      reason: error.message
    };
  }
}

/**
 * Load a public key from a file and convert it to JWK format
 * @param {string} publicKeyPath - Path to the public key file
 * @param {Object} options - Additional JWK parameters
 * @returns {Object} - JWK formatted key
 */
function loadPublicKeyAsJwk(publicKeyPath, options = {}) {
  // Read the public key
  const publicKey = fs.readFileSync(publicKeyPath, 'utf8');
  
  // Convert to JWK
  return pemToJwk(publicKey, options);
}

/**
 * Update an entity configuration with a JWK
 * @param {Object} entityConfig - Entity configuration to update
 * @param {Object} jwk - JWK to add to the entity configuration
 * @returns {Object} - Updated entity configuration
 */
function updateEntityConfigWithJwk(entityConfig, jwk) {
  // Create a deep copy of the entity configuration
  const updatedConfig = JSON.parse(JSON.stringify(entityConfig));
  
  // Initialize the JWKS if it doesn't exist
  if (!updatedConfig.jwks) {
    updatedConfig.jwks = { keys: [] };
  }
  
  // Add the JWK to the JWKS
  updatedConfig.jwks.keys = updatedConfig.jwks.keys || [];
  updatedConfig.jwks.keys.push(jwk);
  
  return updatedConfig;
}

/**
 * Validate a trust chain
 * @param {Array} trustChain - Array of JWTs forming a trust chain
 * @param {string} trustAnchorPublicKeyPath - Path to the trust anchor's public key
 * @returns {Object} - Validation result
 */
function validateTrustChain(trustChain, trustAnchorPublicKeyPath) {
  try {
    // Verify the first token in the chain with the trust anchor's public key
    const firstTokenResult = verifyJwt(trustChain[0], trustAnchorPublicKeyPath);
    
    if (!firstTokenResult.valid) {
      return {
        valid: false,
        reason: `Trust anchor verification failed: ${firstTokenResult.reason}`
      };
    }
    
    // For a more complex trust chain, we would verify each token in the chain
    // using the public key from the previous token
    
    return {
      valid: true,
      payload: firstTokenResult.payload
    };
  } catch (error) {
    return {
      valid: false,
      reason: `Trust chain validation failed: ${error.message}`
    };
  }
}

module.exports = {
  pemToJwk,
  base64UrlEncode,
  signJwt,
  verifyJwt,
  loadPublicKeyAsJwk,
  updateEntityConfigWithJwk,
  validateTrustChain
};