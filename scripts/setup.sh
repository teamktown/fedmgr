#!/bin/bash

# Complete setup script for the federation demo

set -e

echo "🚀 Setting up Federation Demo..."

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found. Please create one from .env.example"
    echo "   cp .env.example .env"
    echo "   # Edit .env with your GitHub OAuth credentials"
    exit 1
fi

# Source environment variables
source .env

# Check required environment variables
if [ -z "$GITHUB_CLIENT_ID" ] || [ -z "$GITHUB_CLIENT_SECRET" ]; then
    echo "❌ Missing required environment variables:"
    echo "   GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set in .env"
    exit 1
fi

# Build npm packages
echo "Building npm packages..."
./scripts/build-npm.sh

#TODO: uninstall the old packaged and install the fedmgr package from ./build/npm/letsfederate-fedmgr*tgz

echo "Uninstalling old npm packages..."
npm uninstall -g @letsfederate/fedmgr
npm uninstall -g @letsfederate/mcp-core

echo "Installing npm packages..."
npm install -g ./build/npm/letsfederate-fedmgr-0.1.0.tgz
npm install -g ./build/npm/letsfederate-mcp-core-0.1.0.tgz

# Configure fedmgr workspace paths to use the repository build/install directory
export FEDMGR_HOME="$(pwd)"
export FEDMGR_FEDERATIONS_DIR="$FEDMGR_HOME/build/install/federations"
export FEDMGR_FED_REG_FILE="$FEDMGR_HOME/build/install/data/fed-reg/registry.json"

mkdir -p "$FEDMGR_FEDERATIONS_DIR" \
         "$FEDMGR_HOME/build/install/mcp_instances" \
         "$(dirname "$FEDMGR_FED_REG_FILE")"


# Clean up any existing containers and volumes
echo "🧹 Cleaning up existing containers..."
docker-compose down -v

# Initialize volumes with proper permissions
#echo "🔧 Initializing volumes..."
#docker-compose run --rm volume-init

# Ensure a test federation exists in the build/federations with appropriate private keys 
# this creates the boilerplate for a federation and an MCP instance

echo "📁 Setting up federation and MCP instance..."
FEDERATION_CONFIG="$FEDMGR_FEDERATIONS_DIR/alpha/config/entity-configuration.json"
if [ -f "$FEDERATION_CONFIG" ]; then
    echo "⚠️  Federation 'alpha' already exists - skipping creation"
else
    fedmgr create fed alpha
    echo "✅ Federation 'alpha' created"
fi

MCP_CONFIG="$FEDMGR_HOME/build/install/mcp_instances/mcp-demo/config/entity-configuration.json"
if [ -f "$MCP_CONFIG" ]; then
    echo "⚠️  MCP instance 'mcp-demo' already exists - skipping creation"
else
    echo "Setting up MCP instance 'mcp-demo' in federation 'alpha'"
    fedmgr create mcp mcp-demo --federation alpha
    echo "✅ MCP instance 'mcp-demo' created in federation 'alpha'"
fi


# Validate that key directories exist before starting containers
FEDERATION_NAME=${FEDERATION_NAME:-alpha}
MCP_INSTANCE=${MCP_ID:-mcp-demo}
ANCHOR_KEYS_DIR="./build/install/federations/${FEDERATION_NAME}/keys"
MCP_KEYS_DIR="./build/install/mcp_instances/${MCP_INSTANCE}/keys"
REGISTRY_DIR="./build/install/fed-reg"

echo "🔍 Validating required directories before container startup..."

if [ ! -d "$ANCHOR_KEYS_DIR" ]; then
    echo "❌ Missing federation keys directory: $ANCHOR_KEYS_DIR"
    echo "   Ensure 'fedmgr create fed ${FEDERATION_NAME}' completed successfully before running docker-compose."
    exit 1
fi

if [ ! -f "$ANCHOR_KEYS_DIR/anchor-private.pem" ] || [ ! -f "$ANCHOR_KEYS_DIR/anchor-public.pem" ]; then
    echo "❌ Federation key files not found in $ANCHOR_KEYS_DIR"
    echo "   Expected anchor-private.pem and anchor-public.pem to exist."
    exit 1
fi

if [ ! -d "$MCP_KEYS_DIR" ]; then
    echo "❌ Missing MCP keys directory: $MCP_KEYS_DIR"
    echo "   Ensure 'fedmgr create mcp ${MCP_INSTANCE} --federation ${FEDERATION_NAME}' completed successfully before running docker-compose."
    exit 1
fi

if [ ! -f "$MCP_KEYS_DIR/mcp-private.pem" ] || [ ! -f "$MCP_KEYS_DIR/mcp-public.pem" ]; then
    echo "❌ MCP key files not found in $MCP_KEYS_DIR"
    echo "   Expected mcp-private.pem and mcp-public.pem to exist."
    exit 1
fi

if [ ! -d "$REGISTRY_DIR" ]; then
    echo "ℹ️  Creating registry directory at $REGISTRY_DIR"
    mkdir -p "$REGISTRY_DIR"
fi


# Start the services

echo "🚀 Starting services..."
docker-compose up --build -d

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 10

# Check service health
echo "🏥 Checking service health..."
if curl -f http://localhost:3001/health > /dev/null 2>&1; then
    echo "✅ Federation Admin is healthy"
else
    echo "❌ Federation Admin is not responding"
fi

if curl -f http://localhost:4001/health > /dev/null 2>&1; then
    echo "✅ MCP Server is healthy"
else
    echo "❌ MCP Server is not responding"
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "📖 Next steps:"
echo "   1. Open http://localhost:3001 in your browser"
echo "   2. Click 'Login with GitHub'"
echo "   3. Test the MCP API integration"
echo ""
echo "🔍 View logs:"
echo "   docker-compose logs -f federation-admin"
echo "   docker-compose logs -f mcp-server"
echo ""
echo "🛑 Stop services:"
echo "   docker-compose down"
