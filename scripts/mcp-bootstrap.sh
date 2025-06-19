#!/bin/sh

# MCP Bootstrap Script
# This script initializes and starts the MCP server with both web UI and MCP protocol support

echo "🚀 Starting MCP Bootstrap..."

# Set default environment variables if not provided
export MCP_ID=${MCP_ID:-"mcp-demo"}
export MCP_PORT=${MCP_PORT:-4001}
export MCP_HOST=${MCP_HOST:-"0.0.0.0"}
export MCP_PUBLIC_DIR=${MCP_PUBLIC_DIR:-"/usr/src/app/public"}
export FEDERATION_ADMIN_URL=${FEDERATION_ADMIN_URL:-"http://federation-admin:3001"}

# Create data directories
mkdir -p /usr/src/app/data

# Log environment
echo "📋 MCP Configuration:"
echo "  - MCP_ID: $MCP_ID"
echo "  - MCP_PORT: $MCP_PORT"
echo "  - MCP_HOST: $MCP_HOST"
echo "  - MCP_PUBLIC_DIR: $MCP_PUBLIC_DIR"
echo "  - FEDERATION_ADMIN_URL: $FEDERATION_ADMIN_URL"

# Start the MCP server
echo "🤖 Starting MCP server with dual protocol support..."
exec node node_modules/@letsfederate/mcp-core/mcp-server.js
