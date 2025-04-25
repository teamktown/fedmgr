#!/bin/bash
# setup.sh - Dynamically generates docker-compose.yaml for MCP federation demo
# Defensive and reproducible setup script

set -euo pipefail
IFS=$'\n\t'

# Config
COMPOSE_FILE="docker-compose.generated.yml"
MCP_COUNT=3
FED_NAME="fed-alpha"
OP_NAME="oidc-op"
OP_IMAGE="sphereon/oidc-federation-op:latest"
WORKDIR="$(pwd)"

# Define local package paths - ASSUMES PACKAGES ARE ALREADY BUILT IN THE CURRENT DIRECTORY
MCP_CORE_PKG="./src/mcp-core/letsfederate-mcp-core-*.tgz"
FEDMGR_PKG="./src/fedmgr/letsfederate-fedmgr-*.tgz"

# Check requirements
command -v docker >/dev/null || { echo >&2 "❌ Docker is required."; exit 1; }
command -v jq >/dev/null || { echo >&2 "❌ jq is required for config parsing."; exit 1; }

# Check if local packages exist
if ! compgen -G "$MCP_CORE_PKG" > /dev/null; then
    echo >&2 "❌ MCP core package not found: $MCP_CORE_PKG"
    exit 1
fi
if ! compgen -G "$FEDMGR_PKG" > /dev/null; then
    echo >&2 "❌ Fedmgr package not found: $FEDMGR_PKG"
    exit 1
fi

# Initialize base file
echo "🔧 Initializing $COMPOSE_FILE..."
cat > "$COMPOSE_FILE" <<EOF
version: '3.8'
services:
EOF

# Add OP block
cat >> "$COMPOSE_FILE" <<EOF

  $OP_NAME:
    image: $OP_IMAGE
    ports:
      - "3000:3000"
    volumes:
      - ./config/oidc-op:/config
    environment:
      - NODE_ENV=production
      - FED_NAME=$FED_NAME
    networks:
      - federated_net
EOF

# Add Fedmgr service
echo "⚙️ Adding Fedmgr service..."
cat >> "$COMPOSE_FILE" <<EOF

  fedmgr:
    build:
      context: .
      dockerfile: Dockerfile.fedmgr
    volumes:
      - ./federations:/app/federations
      - ./mcp_instances:/app/mcp_instances
    environment:
      - FEDMGR_FEDERATIONS_DIR=/app/federations
      - FEDMGR_MCP_INSTANCES_DIR=/app/mcp_instances
    networks:
      - federated_net
EOF


# Add MCPs
for i in $(seq 1 $MCP_COUNT); do
  MCP_ID="mcp-$i"
  MCP_PORT=$((4000 + i))
  echo "⚙️ Adding MCP $MCP_ID..."
  cat >> "$COMPOSE_FILE" <<EOF

  $MCP_ID:
    build:
      context: .
      dockerfile: Dockerfile.mcp-core
    ports:
      - "$MCP_PORT:3000"
    volumes:
      - ./data:/app/data
      - ./mcp_instances/$MCP_ID:/app/mcp_instances/$MCP_ID
    environment:
      - FED_NAME=$FED_NAME
      - MCP_ID=$MCP_ID
      - TRUST_STORE_PATH=/app/data/trust-store.json # Example path, adjust as needed
      - STATS_STORAGE_PATH=/app/data/stats.json # Example path, adjust as needed
      - MCP_CONFIG_PATH=/app/mcp_instances/$MCP_ID/config.json # Example path, adjust as needed
    networks:
      - federated_net
EOF
done

# Define network
cat >> "$COMPOSE_FILE" <<EOF

networks:
  federated_net:
    driver: bridge
EOF

echo "✅ $COMPOSE_FILE generated with $MCP_COUNT MCPs, OP '$OP_NAME', and Fedmgr service."