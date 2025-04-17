# Example 01: Testing Trust Anchor Certificate Functionality

This document provides a step-by-step guide to test the trust anchor certificate functionality in the federation management system. It demonstrates how to create a federation, register MCPs, distribute entity statements, and validate JWT tokens.

## Prerequisites

- Node.js installed
- fedmgr project cloned and dependencies installed

## Step 1: Start the Federation Admin Server

The Federation Admin server is responsible for managing the federation and issuing entity statements. Start it with:

```bash
# Create the federation if it doesn't exist
node src/cli/fedmgr.js create fed alpha

# Start the Federation Admin server
node src/server/federation-admin.js --federation alpha
```

You should see output indicating that the server is running:
```
📤 Serving entity configuration for alpha
```

## Step 2: Create and Start an MCP Instance

MCP (Model Context Protocol) instances are the entities that participate in the federation. Create and start an MCP instance:

```bash
# Create and start an MCP instance
node src/cli/fedmgr.js create mcp test-mcp
```

This command will:
1. Generate RSA key pairs for the MCP
2. Create entity configuration with JWKS (JSON Web Key Set)
3. Register the MCP in the federation registry
4. Start the MCP server

## Step 3: Distribute Entity Statements

Entity statements establish trust relationships between federation entities. Distribute entity statements from the Federation Admin to the MCPs:

```bash
# Distribute entity statements
node src/cli/fedmgr.js distribute alpha
```

If successful, you'll see output like:
```
📡 Distributed entity statements to MCP 'test-mcp' on port 3103
✅ Entity statements distributed from federation 'alpha'
📡 Distribution results:
  - test-mcp: ✅ Success
```

## Step 4: Verify Entity Configuration

Check that the MCP is serving its entity configuration with the proper JWKS:

```bash
curl -v http://localhost:3103/.well-known/openid-federation
```

The response should include:
- The MCP's entity ID (`sub`)
- Metadata about the federation entity
- Authority hints pointing to the federation admin
- JWKS containing the MCP's public key

## Step 5: Test Entity Resolution

Verify that the Federation Admin can resolve entity information and provide a valid trust chain:

```bash
curl -v "http://localhost:3001/resolve?entity_id=http://localhost:3103"
```

The response should include:
- The entity's configuration
- A trust chain with a valid JWT token
- Status information about the entity

## Step 6: Test Token Validation

Finally, test that the MCP can validate tokens signed by the Federation Admin:

```bash
# Extract the JWT from the trust chain and use it to make a request to the MCP
JWT=$(curl -s "http://localhost:3001/resolve?entity_id=http://localhost:3103" | jq -r '.trust_chain[0].jwt') && curl -v -H "Authorization: Bearer $JWT" http://localhost:3103/api
```

If the token validation is successful, you'll see a response like:
```json
{
  "message": "Hello from test-mcp!",
  "validation": "passed",
  "timestamp": "2025-04-17T23:02:51.587Z"
}
```

And in the MCP server logs, you'll see:
```
[INFO] CALL_RECEIVED: Token received: eyJhbGciOi...
[INFO] VALIDATION_PASSED: Trust validation passed: Token signature verified
```

## Understanding the Trust Chain

The trust anchor certificate functionality implements a chain of trust:

1. **Federation Admin** (Trust Anchor)
   - Generates and signs entity statements with its private key
   - Provides its public key in JWKS format for verification

2. **MCP Instances** (Relying Parties)
   - Receive signed entity statements from the Federation Admin
   - Verify the signatures using the Federation Admin's public key
   - Use the validated statements to establish trust

3. **JWT Tokens**
   - Contain claims about the entity (issuer, subject, expiration)
   - Are signed with the issuer's private key
   - Can be verified using the issuer's public key

This implementation ensures that only entities with valid certificates signed by trusted authorities can participate in the federation.

## Troubleshooting

If you encounter issues:

1. **Connection Refused**: Ensure all servers are running on the expected ports
2. **Token Validation Failures**: Check that the keys are properly generated and distributed
3. **JWT Errors**: Verify that the token format and signing algorithm are correct
4. **Expiration Issues**: Ensure that token expiration times are properly set

## Technical Implementation

The trust anchor certificate functionality is implemented in several key files:

- `src/server/utils/certificate-utils.js`: Utilities for certificate handling
- `src/server/federation-admin.js`: Federation management and entity statement generation
- `src/server/mcp-server.js`: MCP server with token validation
- `src/server/mcp-interface.js`: Interface for managing MCPs and distributing entity statements

The implementation uses the `jsonwebtoken` library for JWT signing and verification, along with standard cryptographic functions for key management.