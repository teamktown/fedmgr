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
 * Base64Url decode a string
 * @param {string} str - Base64Url encoded string
 * @returns {Buffer} - Decoded buffer
 */
function base64UrlDecode(str) {
  // Add padding if necessary
  const padding = 4 - (str.length % 4);
  if (padding !== 4) {
    str += '='.repeat(padding);
  }
  
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Convert a JWK to PEM format (simplified implementation for RSA keys)
 * @param {Object} jwk - JWK to convert
 * @returns {string} - PEM formatted public key
 */
function jwkToPem(jwk) {
  if (jwk.kty !== 'RSA') {
    throw new Error('Only RSA keys are supported');
  }
  
  // Decode the modulus and exponent
  const modulus = base64UrlDecode(jwk.n);
  const exponent = base64UrlDecode(jwk.e);
  
  // Build the ASN.1 DER structure for RSA public key
  // This is a simplified implementation - in production, use a proper ASN.1 library
  const modulusLength = modulus.length;
  const exponentLength = exponent.length;
  
  // Calculate total length
  const totalLength = 15 + modulusLength + exponentLength;
  const der = Buffer.alloc(totalLength);
  
  let offset = 0;
  
  // SEQUENCE
  der[offset++] = 0x30;
  der[offset++] = totalLength - 2;
  
  // SEQUENCE (algorithm identifier)
  der[offset++] = 0x30;
  der[offset++] = 0x0d;
  
  // OBJECT IDENTIFIER (RSA encryption)
  der[offset++] = 0x06;
  der[offset++] = 0x09;
  der[offset++] = 0x2a;
  der[offset++] = 0x86;
  der[offset++] = 0x48;
  der[offset++] = 0x86;
  der[offset++] = 0xf7;
  der[offset++] = 0x0d;
  der[offset++] = 0x01;
  der[offset++] = 0x01;
  der[offset++] = 0x01;
  
  // NULL
  der[offset++] = 0x05;
  der[offset++] = 0x00;
  
  // BIT STRING
  der[offset++] = 0x03;
  der[offset++] = modulusLength + exponentLength + 5;
  der[offset++] = 0x00;
  
  // SEQUENCE
  der[offset++] = 0x30;
  der[offset++] = modulusLength + exponentLength + 2;
  
  // Copy modulus
  der[offset++] = 0x02;
  der[offset++] = modulusLength;
  modulus.copy(der, offset);
  offset += modulusLength;
  
  // Copy exponent
  der[offset++] = 0x02;
  der[offset++] = exponentLength;
  exponent.copy(der, offset);
  
  // Convert to PEM
  const base64 = der.toString('base64');
  const pem = `-----BEGIN PUBLIC KEY-----\n${base64.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
  
  return pem;
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
 * Validate a trust chain - verifies ALL tokens in chain per OpenID Federation draft-43
 * @param {Array} trustChain - Array of JWTs forming a trust chain
 * @param {string} trustAnchorPublicKeyPath - Path to the trust anchor's public key
 * @returns {Object} - Validation result
 */
function validateTrustChain(trustChain, trustAnchorPublicKeyPath) {
  try {
    if (!trustChain || trustChain.length === 0) {
      return {
        valid: false,
        reason: 'Trust chain is empty'
      };
    }
    
    // For single token (direct trust relationship)
    if (trustChain.length === 1) {
      const result = verifyJwt(trustChain[0], trustAnchorPublicKeyPath);
      return {
        valid: result.valid,
        reason: result.valid ? 'Single token chain validated' : `Trust anchor verification failed: ${result.reason}`,
        payload: result.payload
      };
    }
    
    // For multi-hop trust chain validation
    const validatedTokens = [];
    let currentPublicKeyPath = trustAnchorPublicKeyPath;
    
    for (let i = 0; i < trustChain.length; i++) {
      const token = trustChain[i];
      const result = verifyJwt(token, currentPublicKeyPath);
      
      if (!result.valid) {
        return {
          valid: false,
          reason: `Token ${i} verification failed: ${result.reason}`,
          validatedTokens: validatedTokens
        };
      }
      
      validatedTokens.push(result.payload);
      
      // For multi-hop chains, extract the public key from current token's JWKS
      // to verify the next token in the chain
      if (i < trustChain.length - 1) {
        const jwks = result.payload.jwks;
        if (!jwks || !jwks.keys || jwks.keys.length === 0) {
          return {
            valid: false,
            reason: `Token ${i} missing JWKS for chain validation`,
            validatedTokens: validatedTokens
          };
        }
        
        // Convert the first JWK to PEM format for verifying the next token
        try {
          const jwk = jwks.keys[0]; // Use the first key
          const pemForNextToken = jwkToPem(jwk);
          
          // Write temporary PEM file for next token verification
          const tempPemPath = `/tmp/temp_key_${i}.pem`;
          fs.writeFileSync(tempPemPath, pemForNextToken);
          currentPublicKeyPath = tempPemPath;
          
        } catch (error) {
          return {
            valid: false,
            reason: `Failed to convert JWK to PEM for token ${i}: ${error.message}`,
            validatedTokens: validatedTokens
          };
        }
      }
    }
    
    return {
      valid: true,
      reason: `Full trust chain validated (${trustChain.length} tokens)`,
      payload: validatedTokens[validatedTokens.length - 1], // Return the last token's payload
      validatedTokens: validatedTokens
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
  base64UrlDecode,
  jwkToPem,
  signJwt,
  verifyJwt,
  loadPublicKeyAsJwk,
  updateEntityConfigWithJwk,
  validateTrustChain
};