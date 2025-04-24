# Certificate Handling in Federation Manager

This document provides an overview of how certificates and cryptographic keys are used, created, and handled throughout the Federation Manager system.

## Overview

The Federation Manager uses certificates and cryptographic keys for several purposes:

1. **Identity Verification**: Establishing the identity of federation entities
2. **Trust Chain Validation**: Verifying the trust relationships between entities
3. **Secure Communication**: Enabling secure communication between components
4. **Token Signing**: Creating and validating JWT tokens for authentication and authorization

## Certificate Generation

### Methods Used

The system uses **OpenSSL** for certificate and key generation:

```javascript
// Example from src/server/mcp-interface.js
execSync(`openssl genrsa -out ${keysPath}/mcp-private.pem 2048`);
execSync(`openssl rsa -in ${keysPath}/mcp-private.pem -pubout -out ${keysPath}/mcp-public.pem`);
```

Key characteristics:
- 2048-bit RSA key pairs
- Private keys stored in PEM format
- Public keys exported in PEM format
- Generated via command-line OpenSSL calls

### Generation Locations

Certificates are generated in the following components:

1. **MCP Instance Creation** (`src/server/mcp-interface.js:createMcp`):
   - When a new MCP instance is created
   - Keys stored in `mcp_instances/<name>/keys/`

2. **MCP Protocol Server Creation** (`src/server/mcp-interface.js:createMcpProtocolServer`):
   - When a new MCP Protocol server is created
   - Keys stored in `mcp_protocol_servers/<name>/keys/`

## Certificate Storage

Certificates and keys are stored in the following locations:

| Component | Private Key Path | Public Key Path |
|-----------|------------------|-----------------|
| MCP Instance | `mcp_instances/<name>/keys/mcp-private.pem` | `mcp_instances/<name>/keys/mcp-public.pem` |
| MCP Protocol Server | `mcp_protocol_servers/<name>/keys/mcp-private.pem` | `mcp_protocol_servers/<name>/keys/mcp-public.pem` |
| Federation | `federations/<name>/keys/anchor-private.pem` | Not explicitly stored |

## Certificate Usage

### Entity Configuration

Certificates are referenced in entity configuration files:

```javascript
// Example entity configuration (simplified)
{
  "sub": "http://localhost:3100",
  "metadata": {
    "federation_entity": {
      "organization_name": "MCP Instance example",
      "federation_fetch_endpoint": "http://localhost:3100/.well-known/openid-federation"
    }
  },
  "authority_hints": ["http://localhost:3001"],
  "jwks": { "keys": [] },  // Would contain public key information
  "iat": 1650000000
}
```

These configuration files are stored at:
- `mcp_instances/<name>/config/entity-configuration.json`
- `mcp_protocol_servers/<name>/config/entity-configuration.json`

### Federation Trust Chain

The federation trust chain uses certificates for:

1. **Entity Statements** (`src/server/federation-admin.js:generateEntityStatement`):
   - Currently uses simulated signatures
   - In production, would sign statements with the federation's private key

```javascript
// Current implementation (simplified)
const statement = {
  iss: entityConfig.sub,  // Federation entity ID
  sub: subject,           // Subject entity ID
  iat: now,
  exp: now + 86400,       // Valid for 24 hours
  // ... metadata and other fields ...
  signature: "simulated_signature_" + crypto.randomBytes(8).toString('hex')
};
```

2. **Token Validation** (`src/server/mcp-server.js:simulateTokenValidation`):
   - Currently simulates validation
   - In production, would verify JWT signatures using public keys

```javascript
// Current implementation (simplified)
function simulateTokenValidation(token) {
  // Check if it looks like a JWT (three dot-separated segments)
  const segments = token.split('.');
  if (segments.length !== 3) {
    return { valid: false, reason: 'Invalid token format' };
  }
  
  // In a real implementation, would verify signature and validate claims
  return { valid: true, reason: 'Token format valid (simulated validation)' };
}
```

## JWT Implementation

The system uses JWT for secure token exchange. While the main codebase currently simulates JWT operations, the test suite (`scripts/tests/security/token-validation.test.js`) demonstrates proper JWT implementation using the `jsonwebtoken` library:

```javascript
// JWT creation (from tests)
const token = jwt.sign(payload, privateKey, {
  algorithm: 'RS256',
  expiresIn: '1h'
});

// JWT verification (from tests)
const verified = jwt.verify(token, publicKey, {
  algorithms: ['RS256']
});
```

JWT tokens include standard claims:
- `sub`: Subject (entity identifier)
- `iss`: Issuer (federation identifier)
- `aud`: Audience (intended recipient)
- `iat`: Issued At (timestamp)
- `exp`: Expiration (timestamp)
- `jti`: JWT ID (unique identifier)

## OpenID Federation Implementation

The system implements parts of the OpenID Federation protocol:

1. **Discovery Endpoints**:
   - `/.well-known/openid-federation` - Serves entity configuration

2. **Federation Endpoints**:
   - `/federation` - Lists federation entities and statements
   - `/register` - Registers new entities with the federation
   - `/resolve` - Resolves entity information and trust chain
   - `/status` - Provides trust mark status information

## Security Practices

The current implementation includes several security practices:

1. **Key Separation**:
   - Private keys stored in separate directories from configuration files
   - Different keys for different components (MCPs, Protocol Servers, Federation)

2. **Industry Standards**:
   - 2048-bit RSA keys (industry standard)
   - PEM format for key storage
   - JWT for token exchange

3. **Validation Checks** (in test suite):
   - Signature verification
   - Expiration validation
   - Audience validation
   - Tamper detection

## Implementation Recommendations

When implementing trustanchor certificate creation and validation:

1. **Continue using OpenSSL** for certificate generation as established in the codebase
2. **Implement proper JWT signing** for entity statements using the `jsonwebtoken` library as demonstrated in the test files
3. **Replace simulated validation** with actual JWT verification using the public keys from the trust chain
4. **Follow the OpenID Federation protocol** for entity statements and trust chains

## Related Files

- `src/server/federation-admin.js` - Federation administration and entity statements
- `src/server/mcp-server.js` - MCP server implementation with token validation
- `src/server/mcp-interface.js` - Interface for creating and managing MCPs with certificate generation
- `src/server/mcp-protocol-server.js` - Protocol server implementation
- `scripts/tests/security/token-validation.test.js` - Tests for token validation