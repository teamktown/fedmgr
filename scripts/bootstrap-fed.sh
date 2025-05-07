#REMOVE THIS FILE
#!/usr/bin/env bash
#TODO
echo "reviewed may6 cp: 21:00, consider EOL'ing this or converging it with the other one"
exit(1)

set -e

FED_NAME=${1:-alpha}
FED_DIR="federations/$FED_NAME"
KEY_DIR="$FED_DIR/keys"
CONFIG_DIR="$FED_DIR/config"
ENTITY_ID="https://localhost:3001"

echo "🔧 Bootstrapping Federation: $FED_NAME"

# Create directory structure
mkdir -p "$KEY_DIR" "$CONFIG_DIR"

# Generate root signing key for federation trust anchor
if [ ! -f "$KEY_DIR/anchor-private.pem" ]; then
  echo "🔑 Generating trust anchor keypair..."
  openssl genrsa -out "$KEY_DIR/anchor-private.pem" 2048
  openssl rsa -in "$KEY_DIR/anchor-private.pem" -pubout -out "$KEY_DIR/anchor-public.pem"
else
  echo "🔐 Trust anchor key already exists"
fi

# Generate trust anchor entity configuration
ENTITY_CONFIG="$CONFIG_DIR/entity-configuration.json"

cat > "$ENTITY_CONFIG" <<EOF
{
  "sub": "$ENTITY_ID",
  "metadata": {
    "federation_entity": {
      "organization_name": "fedmgr Federation $FED_NAME",
      "contacts": ["admin@$FED_NAME.local"],
      "federation_fetch_endpoint": "$ENTITY_ID/federation",
      "trust_marks": []
    }
  },
  "authority_hints": [],
  "jwks": {
    "keys": []
  },
  "iat": $(date +%s)
}
EOF

echo "📄 Entity Configuration generated at $ENTITY_CONFIG"

# Optionally: Start the Federation Admin MCP server
echo "🚀 Launching Federation Admin MCP on port 3001..."
node src/server/federation-admin.js --fed "$FED_NAME" &

echo "✅ Federation '$FED_NAME' bootstrapped successfully."
