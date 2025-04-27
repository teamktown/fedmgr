# @letsfederate/fedmgr

A command-line interface (CLI) for managing federated MCPs and trust environments.

## Installation

You can use this package in two ways:

### Using NPX (Recommended)

The easiest way to use `fedmgr` is through NPX, which allows you to run the CLI without installing it globally:

```bash
npx @letsfederate/fedmgr <command>
```

This approach:
- Avoids global installation
- Prevents version conflicts
- Ensures you're always using the latest version

### Global Installation

If you prefer, you can install the package globally:

```bash
npm install -g @letsfederate/fedmgr
```

Then use it directly:

```bash
fedmgr <command>
```

## Available Commands

### Creating Resources

```bash
# Create a new federation
npx @letsfederate/fedmgr create fed <federation-name>

# Add an operator to a federation
npx @letsfederate/fedmgr create op <operator-name> --federation <federation-name>

# Add an MCP to a federation
npx @letsfederate/fedmgr create mcp <mcp-name> --federation <federation-name>

# Create an MCP Protocol server
npx @letsfederate/fedmgr create mcp-protocol <server-name>
```

### Listing Resources

```bash
# List all federations, MCPs, and MCP Protocol servers
npx @letsfederate/fedmgr list
```

### Managing MCP Lifecycle

```bash
# Stop a running MCP instance
npx @letsfederate/fedmgr stop <mcp-name>

# Restart a running MCP instance
npx @letsfederate/fedmgr restart <mcp-name>
```

### Federation Operations

```bash
# Distribute entity statements from Federation Admin to MCPs
npx @letsfederate/fedmgr distribute <federation-name>
```

### MCP Protocol Server Management

```bash
# Start an MCP Protocol server
npx @letsfederate/fedmgr mcp-protocol start <server-name>

# Stop an MCP Protocol server
npx @letsfederate/fedmgr mcp-protocol stop <server-name>

# Restart an MCP Protocol server
npx @letsfederate/fedmgr mcp-protocol restart <server-name>
```

### Deleting Resources

```bash
# Delete a federation
npx @letsfederate/fedmgr delete fed <federation-name>
```

### Testing MCP Endpoints

```bash
# Send a JWT-authenticated request to an MCP
npx @letsfederate/fedmgr call <mcp-name> --token <jwt-token>
```

## Common Workflows

### Setting Up a New Federation Environment

```bash
# Create a new federation
npx @letsfederate/fedmgr create fed alpha

# Add an operator to the federation
npx @letsfederate/fedmgr create op op1 --federation alpha

# Add MCPs to the federation
npx @letsfederate/fedmgr create mcp mcp1 --federation alpha
npx @letsfederate/fedmgr create mcp mcp2 --federation alpha

# Distribute entity statements
npx @letsfederate/fedmgr distribute alpha
```

### Managing MCP Instances

```bash
# List all MCPs
npx @letsfederate/fedmgr list

# Restart an MCP
npx @letsfederate/fedmgr restart mcp1

# Test an MCP endpoint
npx @letsfederate/fedmgr call mcp1 --token <your-jwt-token>
```

### Cleaning Up

```bash
# Delete a federation
npx @letsfederate/fedmgr delete fed alpha
```

## Requirements and Dependencies

- Node.js v14 or later
- npm v6 or later
- OpenSSL (for key generation)
- Docker and Docker Compose (for running the full environment)

## Environment Variables

The CLI respects the following environment variables:

- `FEDMGR_FEDERATIONS_DIR`: Directory for federation configurations
- `FEDMGR_MCP_INSTANCES_DIR`: Directory for MCP instance configurations

## Related Documentation

For more detailed information, refer to the main project documentation:

- [Quickstart Guide](../../docs/quickstart.md)
- [Federation Manager Quickstart](../../docs/fedmgr-quickstart.md)
- [Architecture Overview](../../docs/architecture-april2025.md)