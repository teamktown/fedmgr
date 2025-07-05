#!/bin/sh

# Bootstrap script for Federation Admin in Docker
# Keys must be pre-generated before container startup - no in-container key generation

set -e

# Set defaults
FEDERATION_NAME=${FEDERATION_NAME:-alpha}
KEYS_DIR=${FEDMGR_KEYS_PATH:-"/usr/src/app/keys"}
FEDERATIONS_DIR=${FEDMGR_FEDERATIONS_DIR:-"/usr/src/app/federations"}
DATA_DIR="/usr/src/app/data"
REGISTRY_FILE=${FEDMGR_FED_REG_FILE:-"$DATA_DIR/registry.json"}

# Copy keys and configurations from build data if they exist
if [ -d "/usr/src/app/build_data/keys" ]; then
    echo "📋 Copying keys from build data..."
    mkdir -p "$KEYS_DIR"
    cp -r /usr/src/app/build_data/keys/* "$KEYS_DIR/" 2>/dev/null || true
fi

# Copy federation-specific keys if they exist
if [ -d "/usr/src/app/build_data/federations/$FEDERATION_NAME/keys" ]; then
    echo "📋 Copying federation-specific keys from build data..."
    mkdir -p "$KEYS_DIR"
    cp -r /usr/src/app/build_data/federations/$FEDERATION_NAME/keys/* "$KEYS_DIR/" 2>/dev/null || true
fi

if [ -d "/usr/src/app/build_data/federations" ]; then
    echo "📋 Copying federation configs from build data..."
    mkdir -p "$FEDERATIONS_DIR"
    cp -r /usr/src/app/build_data/federations/* "$FEDERATIONS_DIR/" 2>/dev/null || true
fi

if [ -d "/usr/src/app/build_data/fed-reg" ]; then
    echo "📋 Copying registry data from build data..."
    mkdir -p "$DATA_DIR"
    cp -r /usr/src/app/build_data/fed-reg/* "$DATA_DIR/" 2>/dev/null || true
fi

echo "🔍 Federation Admin Bootstrap - Validating Prerequisites..."
echo "   Federation: $FEDERATION_NAME"
echo "   Keys directory: $KEYS_DIR"
echo "   Federations directory: $FEDERATIONS_DIR"
echo "   Registry file: $REGISTRY_FILE"

# Function to check if required keys exist
check_keys() {
    local key_name=$1
    local description=$2
    local private_key="$KEYS_DIR/${key_name}-private.pem"
    local public_key="$KEYS_DIR/${key_name}-public.pem"
    
    if [ ! -f "$private_key" ]; then
        echo "❌ FATAL: Missing private key: $private_key"
        echo "   Run 'fedmgr create fed $FEDERATION_NAME' before starting containers"
        return 1
    fi
    
    if [ ! -f "$public_key" ]; then
        echo "❌ FATAL: Missing public key: $public_key"
        echo "   Run 'fedmgr create fed $FEDERATION_NAME' before starting containers"
        return 1
    fi
    
    echo "✅ $description keys found and accessible"
    return 0
}

# Function to check federation configuration
check_federation_config() {
    local config_file="$FEDERATIONS_DIR/$FEDERATION_NAME/config/entity-configuration.json"
    
    if [ ! -f "$config_file" ]; then
        echo "❌ FATAL: Missing federation configuration: $config_file"
        echo "   Run 'fedmgr create fed $FEDERATION_NAME' before starting containers"
        return 1
    fi
    
    echo "✅ Federation configuration found: $config_file"
    
    # Validate that the JSON is properly formatted
    if ! command -v jq >/dev/null 2>&1; then
        echo "⚠️  jq not available, skipping JSON validation"
    else
        if jq . "$config_file" >/dev/null 2>&1; then
            echo "✅ Federation configuration is valid JSON"
        else
            echo "❌ FATAL: Federation configuration is not valid JSON: $config_file"
            return 1
        fi
    fi
    
    return 0
}

# Function to check registry file
check_registry() {
    if [ ! -f "$REGISTRY_FILE" ]; then
        echo "⚠️  Registry file not found: $REGISTRY_FILE"
        echo "   Creating empty registry..."
        mkdir -p "$(dirname "$REGISTRY_FILE")"
        cat > "$REGISTRY_FILE" << EOF
{
  "federations": [],
  "mcps": {},
  "mcpProtocolServers": {}
}
EOF
        echo "✅ Empty registry created"
    else
        echo "✅ Registry file found: $REGISTRY_FILE"
    fi
}

# Validate all prerequisites
echo "🔑 Checking required keys..."
if ! check_keys "anchor" "Federation anchor"; then
    echo ""
    echo "💡 To generate required keys, run:"
    echo "   ./scripts/setup-keys.sh $FEDERATION_NAME"
    echo ""
    echo "🐳 Or if using Docker Compose:"
    echo "   docker-compose down"
    echo "   ./scripts/setup-keys.sh $FEDERATION_NAME"
    echo "   docker-compose up -d"
    exit 1
fi

echo "📋 Checking federation configuration..."
if ! check_federation_config; then
    echo ""
    echo "💡 To generate required configuration, run:"
    echo "   fedmgr create fed $FEDERATION_NAME"
    exit 1
fi


echo "📄 Checking registry..."
check_registry

# Additional health checks
echo "🔧 Running additional health checks..."

# Check key permissions
if [ -r "$KEYS_DIR/anchor-private.pem" ]; then
    echo "✅ Private key is readable"
else
    echo "❌ FATAL: Private key is not readable - check file permissions"
    exit 1
fi

# Test key validity (basic check)
if command -v openssl >/dev/null 2>&1; then
    if openssl rsa -in "$KEYS_DIR/anchor-private.pem" -noout 2>/dev/null; then
        echo "✅ Private key appears to be valid"
    else
        echo "❌ FATAL: Private key appears to be corrupted or invalid"
        exit 1
    fi
fi

# Set environment variables for the federation admin
export FEDMGR_KEYS_PATH="$KEYS_DIR"
export FEDMGR_FEDERATIONS_DIR="$FEDERATIONS_DIR"
export FEDMGR_FED_REG_FILE="$REGISTRY_FILE"

echo "✅ All prerequisites validated successfully"
echo "🚀 Starting Federation Admin for federation '$FEDERATION_NAME'..."

# Add health endpoint check delay
echo "⏳ Allowing time for service initialization..."
sleep 2

# Start the federation admin server
node node_modules/@letsfederate/fedmgr/server/federation-admin.js --federation "$FEDERATION_NAME" &
FEDMGR_PID=$!

# Wait for server to start and validate OpenID Federation endpoint
echo "🔍 Waiting for server to start..."
sleep 5

# Validate that /.well-known/openid-federation endpoint returns a valid JWT
echo "🔍 Validating OpenID Federation endpoint..."
if command -v curl >/dev/null 2>&1; then
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/.well-known/openid-federation" 2>/dev/null || echo "000")
    if [ "$RESPONSE" = "200" ]; then
        echo "✅ OpenID Federation endpoint is responding (HTTP 200)"
        JWT_CONTENT=$(curl -s "http://localhost:3001/.well-known/openid-federation" 2>/dev/null || echo "")
        if [ -n "$JWT_CONTENT" ] && echo "$JWT_CONTENT" | grep -q "^eyJ"; then
            echo "✅ OpenID Federation endpoint returns valid JWT format"
        else
            echo "⚠️  OpenID Federation endpoint response format may be incorrect"
        fi
    else
        echo "⚠️  OpenID Federation endpoint not responding properly (HTTP $RESPONSE)"
    fi
else
    echo "⚠️  curl not available, skipping endpoint validation"
fi

echo "🎯 Federation Admin is ready at http://localhost:3001"
echo "📡 OpenID Federation endpoint: http://localhost:3001/.well-known/openid-federation"
echo "🔍 Debug endpoint: http://localhost:3001/.well-known/openid-federation-debug"

# Wait for the federation admin process
wait $FEDMGR_PID
