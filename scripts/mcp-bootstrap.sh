#!/bin/sh

# Bootstrap script for MCP Server in Docker

# Set defaults
MCP_ID=${MCP_ID:-mcp-demo}
DATA_DIR="/usr/src/app/data"

# Create directories
mkdir -p "$DATA_DIR"

# Create default trust store if it doesn't exist
if [ ! -f "$DATA_DIR/trust-store.json" ]; then
    echo "🔒 Creating trust store..."
    echo '[]' > "$DATA_DIR/trust-store.json"
fi

# Create default stats file if it doesn't exist
if [ ! -f "$DATA_DIR/stats.json" ]; then
    echo "📊 Creating stats file..."
    cat > "$DATA_DIR/stats.json" << EOF
{
  "messageCount": {"received": 0, "sent": 0, "processed": 0, "errors": 0},
  "federationCount": 1,
  "trustedMcpCount": 0,
  "uptimeSeconds": 0
}
EOF
fi

# Set environment variables
export TRUST_STORE_PATH="$DATA_DIR/trust-store.json"
export STATS_STORAGE_PATH="$DATA_DIR/stats.json"

echo "🤖 Starting MCP Server..."
exec node node_modules/@letsfederate/mcp-core/dist/server.js
