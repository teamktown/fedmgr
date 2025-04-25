#!/bin/bash
# setup.sh - Dynamically generates docker-compose.yaml for MCP federation demo
# Defensive and reproducible setup script

set -euo pipefail
IFS=$'\n\t'

# Config
COMPOSE_FILE="docker-compose.generated.yml"
BASE_TEMPLATE="docker-compose.base.yml"
MCP_COUNT=3
FED_NAME="fed-alpha"
OP_NAME="oidc-op"
FEDMGR_IMAGE="letsfederate/fedmgr:latest"
MCP_IMAGE="letsfederate/mcp-core:latest"
OP_IMAGE="sphereon/oidc-federation-op:latest"
WORKDIR="$(pwd)"

# Check requirements
command -v docker >/dev/null || { echo >&2 "❌ Docker is required."; exit 1; }
command -v jq >/dev/null || { echo >&2 "❌ jq is required for config parsing."; exit 1; }

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

# Add MCPs
for i in $(seq 1 $MCP_COUNT); do
  MCP_ID="mcp-$i"
  MCP_PORT=$((4000 + i))
  echo "⚙️ Adding MCP $MCP_ID..."
  cat >> "$COMPOSE_FILE" <<EOF

  $MCP_ID:
    image: $MCP_IMAGE
    ports:
      - "$MCP_PORT:3000"
    volumes:
      - ./config/$MCP_ID:/config
    environment:
      - FED_NAME=$FED_NAME
      - MCP_ID=$MCP_ID
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

echo "✅ $COMPOSE_FILE generated with $MCP_COUNT MCPs and OP '$OP_NAME'."
