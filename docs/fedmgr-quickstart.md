# 🚀 Fedmgr Quickstart Guide

This guide walks you through setting up and using the fedmgr project, which provides a framework for managing OIDC Federation and MCP (Machine Consumable Policy) instances. Follow these steps to build, configure, launch, and interact with the federated environment.

## Prerequisites

Before you begin, ensure you have the following installed:
- Docker and Docker Compose
- Node.js (v14 or later)
- npm (v6 or later)
- jq (for JSON processing)
- openssl (for key generation)

## 1. Building NPM Modules

The first step is to build the required NPM modules using the provided build script:

```bash
# Navigate to the project root directory
cd /path/to/fedmgr

# Run the build script
./scripts/build-npm.sh
```

This script:
- Builds the `@letsfederate/mcp-core` package
- Builds the `@letsfederate/fedmgr` package
- Performs sanity checks on both packages
- Creates local package files (`.tgz`) for use in Docker containers

## 2. Setting Up the Environment

After building the NPM modules, you need to set up the environment and generate the Docker Compose file:

```bash
# Run the setup script
./scripts/setup.sh
```

This script:
- Checks for required dependencies (Docker, jq)
- Verifies that the NPM packages were built successfully
- Generates a `docker-compose.generated.yml` file with:
  - An OIDC Federation OP (OpenID Provider) service
  - A Fedmgr service for managing federations
  - Multiple MCP instances (by default, 3 instances)
  - A network configuration for communication between services

The generated Docker Compose file includes:
- Port mappings for each service
- Volume mounts for configuration and data
- Environment variables for service configuration

## 3. Launching Services

Once the Docker Compose file is generated, you can launch all services:

```bash
# Start all services
docker-compose -f docker-compose.generated.yml up -d
```

This command starts:
- The OIDC Federation OP on port 3000
- The Fedmgr service
- MCP instances on ports 4001, 4002, 4003, etc.

To verify that all services are running:

```bash
docker-compose -f docker-compose.generated.yml ps
```

## 4. Using the Fedmgr CLI

The `fedmgr` CLI allows you to create and manage federations, operators, and MCP instances.

### Creating a Federation

```bash
# Create a new federation named "alpha"
fedmgr create fed alpha
```

This command:
- Creates a new federation directory structure
- Generates a trust anchor keypair
- Creates an entity configuration file

### Adding an OP to the Federation

```bash
# Add an OP named "op1" to the "alpha" federation
fedmgr create op op1 --federation alpha
```

This command:
- Generates keys for the operator
- Updates the federation configuration to include the operator

### Adding MCPs to the Federation

```bash
# Add an MCP named "mcp1" to the "alpha" federation
fedmgr create mcp mcp1 --federation alpha

# Add another MCP
fedmgr create mcp mcp2 --federation alpha
```

These commands associate the MCPs with the federation.

### Distributing Entity Statements

After creating the federation and adding components, distribute the entity statements:

```bash
# Distribute entity statements from the "alpha" federation
fedmgr distribute alpha
```

This command:
- Distributes entity statements from the federation to all associated MCPs
- Establishes trust relationships between components

### Listing Federation Components

To view all components in your federation:

```bash
# List all federations, MCPs, and MCP Protocol servers
fedmgr list
```

## 5. Verifying Trust and Functionality

You can verify the trust relationships and functionality of the system by accessing the following endpoints on each MCP:

### Whoami Endpoint

The `/whoami` endpoint returns information about the MCP's identity:

```bash
# Replace 4001 with the port of your MCP instance
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" http://localhost:4001/whoami
```

Example response:
```json
{
  "id": "mcp1",
  "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
  "endpoints": {
    "showtrust": "http://localhost:4001/showtrust",
    "stats": "http://localhost:4001/stats",
    "status": "http://localhost:4001/status"
  }
}
```

### Showtrust Endpoint

The `/showtrust` endpoint shows the trusted entities for the MCP:

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" http://localhost:4001/showtrust
```

Example response:
```json
{
  "trusted": [
    {
      "id": "http://localhost:3000",
      "type": "oidc_op",
      "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
    },
    {
      "id": "http://localhost:3001",
      "type": "federation",
      "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
    }
  ]
}
```

### Stats Endpoint

The `/stats` endpoint provides statistics about the MCP's operations:

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" http://localhost:4001/stats
```

Example response:
```json
{
  "messageCount": {
    "received": 42,
    "sent": 17,
    "processed": 59,
    "errors": 0
  },
  "federationCount": 1,
  "trustedMcpCount": 2,
  "uptimeSeconds": 3600
}
```

### Status Endpoint

The `/status` endpoint shows the current status of the MCP:

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" http://localhost:4001/status
```

Example response:
```json
{
  "status": "ok",
  "details": {
    "database": "connected",
    "federationConnections": "active",
    "messageQueue": "operational"
  },
  "lastChecked": "2025-04-24T23:42:50.000Z"
}
```

## 6. Viewing MCP Logs and Visualization

### Viewing MCP Logs

You can view the logs for any service using Docker Compose:

```bash
# View logs for a specific MCP
docker-compose -f docker-compose.generated.yml logs mcp-1

# Follow logs in real-time
docker-compose -f docker-compose.generated.yml logs -f mcp-1

# View logs for all services
docker-compose -f docker-compose.generated.yml logs
```

### Accessing the Visualization Dashboard

The fedmgr project includes a web interface for visualizing the federation:

1. Open a web browser and navigate to `http://localhost:5173`
2. The dashboard shows:
   - Federation structure
   - MCP instances and their status
   - Trust relationships
   - Real-time updates via WebSocket

The dashboard provides:
- A graph visualization of the federation
- Status information for each component
- Real-time logs and updates
- Interactive controls for managing components

## 7. Resetting the Environment

When you're done or need to reset the environment:

### Deleting a Federation

```bash
# Delete the "alpha" federation
fedmgr delete fed alpha
```

This command:
- Removes the federation directory
- Updates the registry to remove the federation
- Invalidates certificates associated with the federation

### Stopping Docker Services

```bash
# Stop all services
docker-compose -f docker-compose.generated.yml down
```

This command stops and removes all containers defined in the Docker Compose file.

### Complete Reset

For a complete reset:

```bash
# Delete the federation
fedmgr delete fed alpha

# Stop Docker services
docker-compose -f docker-compose.generated.yml down

# Remove generated files (optional)
rm docker-compose.generated.yml
rm -rf data/registry.json
```

## Conclusion

You now have a functioning federated trust environment with:
- A federation trust anchor
- An OIDC Federation OP
- Multiple MCP instances
- Trust relationships between components

This environment demonstrates:
- Federation bootstrapping
- Entity statement distribution
- JWT validation
- Trust verification

For more detailed information, refer to the other documentation files in the `docs/` directory.