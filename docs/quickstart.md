# Federation Manager Quick Start Guide

This guide will help you set up and run the Federation Manager (fedmgr) with the new standardized infrastructure that separates key generation from container runtime.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Key Generation Setup](#key-generation-setup)
4. [Development Setup](#development-setup)
5. [Production Setup](#production-setup)
6. [Common Operations](#common-operations)
7. [Troubleshooting](#troubleshooting)

## Prerequisites

- Node.js 22, 24, or 26
- npm or yarn
- Docker and Docker Compose
- OpenSSL (for key generation)
- Git

## Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd fedmgr
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Build the Project

```bash
npm run build
```

This creates NPM packages in `./build/npm/` that are used by Docker containers.

### 4. Initialize Workspace

```bash
# Initialize the workspace with proper directory structure
npm run fedmgr init

# Or if you have existing configuration that needs repair
npm run fedmgr init --fix
```

## Key Generation Setup

**IMPORTANT**: Keys must be generated before starting Docker containers. Containers will fail if keys are missing.

### Generate Keys for a Federation

```bash
# Generate all required keys for a federation named 'alpha'
./scripts/setup-keys.sh alpha

# Generate keys with custom settings
./scripts/setup-keys.sh --key-size 4096 alpha
./scripts/setup-keys.sh --force alpha  # Overwrite existing keys
```

### Verify Keys

```bash
# Verify all keys were generated correctly
cd ./build/install && ./verify-keys.sh alpha

# List all available key pairs
npm run fedmgr keys list

# Check specific key pair
npm run fedmgr keys check alpha-anchor
```

### Key Management Commands

```bash
# Generate specific key pairs
npm run fedmgr keys generate federation-anchor
npm run fedmgr keys generate alpha-mcp

# Set up all keys for a federation at once
npm run fedmgr keys setup alpha

# Import existing keys
npm run fedmgr keys import my-key /path/to/private.pem /path/to/public.pem
```

## Development Setup

### 1. Configure Environment

```bash
# Copy and customize environment file
cp .env.example .env

# Key environment variables for development:
FEDERATION_NAME=alpha
FEDMGR_BUILD_DIR=./build/install
FEDMGR_KEY_PROVIDER=filesystem
```

### 2. Generate Keys

```bash
# Generate keys for development federation
./scripts/setup-keys.sh alpha
```

### 3. Start Development Services

```bash
# Start with built containers
docker-compose up -d

# View logs
docker-compose logs -f

# For debugging, run individual containers
docker run --rm -p 3001:3001 \
  -v $(pwd)/build/install/keys:/usr/src/app/keys:ro \
  -v $(pwd)/build/install/federations:/usr/src/app/federations:ro \
  -v $(pwd)/build/install/fed-reg:/usr/src/app/data:rw \
  -v $(pwd)/public:/usr/src/app/public:ro \
  -e FEDERATION_NAME=alpha \
  -e FEDMGR_KEYS_PATH=/usr/src/app/keys \
  -e FEDMGR_FEDERATIONS_DIR=/usr/src/app/federations \
  -e FEDMGR_FED_REG_FILE=/usr/src/app/data/registry.json \
  fedmgr-admin:latest
```

### 4. Verify Services

```bash
# Check service health
curl http://localhost:3001/health  # Federation Admin
curl http://localhost:4001/health  # MCP Server

# Check federation status
npm run fedmgr list
```

## Production Setup

### 1. Setup with OIDC Integration

```bash
# Generate keys
./scripts/setup-keys.sh production

# Configure OIDC environment
export GITHUB_CLIENT_ID=your-client-id
export GITHUB_CLIENT_SECRET=your-client-secret

# Start with OIDC mock server
docker-compose -f docker-compose.oidc.yml up -d
```

### 2. Monitor Services

```bash
# Check all service health
docker-compose ps

# Monitor logs
docker-compose logs -f federation-admin
docker-compose logs -f mcp-server
```

## Common Operations

### Federation Management

```bash
# Create a new federation
npm run fedmgr create fed my-federation

# List federations
npm run fedmgr list

# Inspect federation details
npm run fedmgr inspect fed my-federation

# Delete federation
npm run fedmgr delete fed my-federation --confirm
```

### MCP Management

```bash
# Create MCP instance
npm run fedmgr create mcp my-mcp --federation alpha

# List MCP instances
npm run fedmgr list

# Start/stop MCP
npm run fedmgr restart mcp my-mcp
npm run fedmgr stop mcp my-mcp
```

### Key Rotation

```bash
# Generate new keys (backup old ones automatically)
./scripts/setup-keys.sh --force alpha

# Restart services to use new keys
docker-compose restart

# Verify new keys are working
docker-compose logs federation-admin | grep "✅"
```

## Directory Structure

After setup, your directory structure will look like:

```
fedmgr/
├── build/
│   ├── install/                    # Single source of truth for runtime files
│   │   ├── keys/                   # Global keys
│   │   │   ├── anchor-private.pem
│   │   │   ├── anchor-public.pem
│   │   │   └── alpha-mcp-*.pem
│   │   ├── federations/            # Federation-specific files
│   │   │   └── alpha/
│   │   │       ├── keys/
│   │   │       └── config/
│   │   ├── fed-reg/               # Registry data
│   │   │   └── registry.json
│   │   └── oidc-mock/             # OIDC configuration
│   └── npm/                       # Build artifacts
│       ├── letsfederate-fedmgr-*.tgz
│       └── letsfederate-mcp-core-*.tgz
├── scripts/
│   ├── setup-keys.sh              # Key generation script
│   └── migrate-build-structure.sh # Migration script
└── docker-compose*.yml            # Docker configurations
```

## Troubleshooting

### Container Startup Issues

**CRITICAL**: Containers require pre-generated keys and NPM packages. Run these steps **before** `docker-compose up`:

1. **Generate NPM packages**:
   ```bash
   # Build packages first (if not already done)
   cd src/fedmgr && npm pack && cp *.tgz ../../build/npm/
   cd ../mcp-core && npm pack && cp *.tgz ../../build/npm/
   cd ../../
   ```

2. **Generate keys**:
   ```bash
   # Generate all required keys
   ./scripts/setup-keys.sh alpha

   # Verify keys exist
   ls -la ./build/install/keys/
   ```

3. **Start containers**:
   ```bash
   docker-compose up -d
   ```

### Keys Not Found Error

If containers fail with "Keys not found" errors:

```bash
# Check if keys exist
ls -la ./build/install/keys/

# Generate missing keys
./scripts/setup-keys.sh alpha

# Restart containers
docker-compose restart
```

### Container Permission Errors

```bash
# Fix key file permissions
find ./build/install/keys -name "*.pem" -exec chmod 600 {} \;

# Fix directory permissions
chmod -R 755 ./build/install/
```

### Service Health Check Failures

```bash
# Check container logs
docker-compose logs federation-admin
docker-compose logs mcp-server

# Test endpoints manually
curl -v http://localhost:3001/health
curl -v http://localhost:4001/health

# Verify key validation in containers
docker-compose exec federation-admin ls -la /usr/src/app/keys/
```

### Registry Issues

```bash
# Check registry file
cat ./build/install/fed-reg/registry.json

# Reset registry
rm ./build/install/fed-reg/registry.json
npm run fedmgr init --fix
```

### Migration from Legacy Structure

If you have an existing installation:

```bash
# Migrate from old structure
./scripts/migrate-build-structure.sh

# Verify migration
./scripts/migrate-build-structure.sh --dry-run
```

## Development Workflow

### Making Changes

1. **Code Changes**: Edit source files in `src/`
2. **Build**: Run `npm run build` to create updated packages
3. **Key Check**: Ensure keys exist with `./build/install/verify-keys.sh alpha`
4. **Test**: Restart containers with `docker-compose restart`
5. **Verify**: Check logs and health endpoints

### Testing

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:unit
npm run test:integration
npm run test:e2e

# Test key generation
./scripts/setup-keys.sh test-federation
npm run fedmgr keys check test-federation-anchor
```

## Security Notes

- **Private keys are mounted read-only** in containers for security
- **Keys are never generated inside containers** - always pre-generated
- **File permissions are automatically set** during key generation
- **Containers fail fast** if keys are missing or invalid
- **Backup your keys** before rotation or migration

## Getting Help

- Check container logs: `docker-compose logs -f`
- Validate setup: `./build/install/verify-keys.sh alpha`
- Run health checks: `curl http://localhost:3001/health`
- Check key status: `npm run fedmgr keys list`

For more detailed information, see:
- [Architecture Documentation](./architecture-april2025.md)
- [Development Guide](./dev-guide.md)
- [Testing Documentation](./testing.md)
