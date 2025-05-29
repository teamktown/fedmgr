#!/bin/sh

# Bootstrap script for Federation Admin in Docker

# Set defaults
FEDERATION_NAME=${FEDERATION_NAME:-alpha}
DATA_DIR="/usr/src/app/data"
KEYS_DIR="$DATA_DIR/keys"
CONFIG_DIR="$DATA_DIR/config"

# Create directories
mkdir -p "$KEYS_DIR" "$CONFIG_DIR"

# Generate keys if they don't exist
if [ ! -f "$KEYS_DIR/anchor-private.pem" ]; then
    echo "🔑 Generating federation keys..."
    openssl genrsa -out "$KEYS_DIR/anchor-private.pem" 2048
    openssl rsa -in "$KEYS_DIR/anchor-private.pem" -pubout -out "$KEYS_DIR/anchor-public.pem"
fi

# Create entity configuration if it doesn't exist
if [ ! -f "$CONFIG_DIR/entity-configuration.json" ]; then
    echo "📋 Creating entity configuration..."
    cat > "$CONFIG_DIR/entity-configuration.json" << EOF
{
  "sub": "http://localhost:3001",
  "metadata": {
    "federation_entity": {
      "organization_name": "Federation Alpha",
      "federation_fetch_endpoint": "http://localhost:3001/.well-known/openid-federation"
    }
  },
  "jwks": {"keys": []},
  "iat": $(date +%s)
}
EOF
fi

# Set environment variables for the federation admin
export FEDMGR_FEDERATIONS_DIR="$DATA_DIR"
export FEDMGR_FED_REG="$DATA_DIR/registry.json"

echo "🚀 Starting Federation Admin..."
exec node node_modules/@letsfederate/fedmgr/server/federation-admin.js --federation "$FEDERATION_NAME"
