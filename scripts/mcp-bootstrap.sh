#!/bin/sh

# MCP Bootstrap Script
# This script initializes and starts the MCP server with both web UI and MCP protocol support
# Keys must be pre-generated before container startup - no in-container key generation

set -e

# Copy keys and configurations from build data if they exist
if [ -d "/usr/src/app/build_data/keys" ]; then
    echo "📋 Copying keys from build data..."
    mkdir -p "/usr/src/app/keys"
    cp -r /usr/src/app/build_data/keys/* "/usr/src/app/keys/" 2>/dev/null || true
fi

# Copy MCP instances from build data if they exist
if [ -d "/usr/src/app/build_data/mcp_instances" ]; then
    echo "📋 Copying MCP instances from build data..."
    mkdir -p "/usr/src/app/mcp_instances"
    cp -r /usr/src/app/build_data/mcp_instances/* "/usr/src/app/mcp_instances/" 2>/dev/null || true
fi

# Copy MCP protocol servers from build data if they exist
if [ -d "/usr/src/app/build_data/mcp_protocol_servers" ]; then
    echo "📋 Copying MCP protocol servers from build data..."
    mkdir -p "/usr/src/app/mcp_protocol_servers"
    cp -r /usr/src/app/build_data/mcp_protocol_servers/* "/usr/src/app/mcp_protocol_servers/" 2>/dev/null || true
fi

echo "🚀 Starting MCP Bootstrap..."

# Set default environment variables if not provided
export MCP_ID=${MCP_ID:-"mcp-demo"}
export MCP_PORT=${MCP_PORT:-4001}
export MCP_HOST=${MCP_HOST:-"0.0.0.0"}
export MCP_PUBLIC_DIR=${MCP_PUBLIC_DIR:-"/usr/src/app/public"}
export FEDERATION_ADMIN_URL=${FEDERATION_ADMIN_URL:-"http://federation-admin:3001"}
export FEDERATION_NAME=${FEDERATION_NAME:-"alpha"}

# Key and configuration paths
KEYS_DIR=${FEDMGR_KEYS_PATH:-"/usr/src/app/keys"}
DATA_DIR="/usr/src/app/data"

echo "🔍 MCP Bootstrap - Validating Prerequisites..."
echo "   MCP ID: $MCP_ID"
echo "   Federation: $FEDERATION_NAME"
echo "   Keys directory: $KEYS_DIR"
echo "   Data directory: $DATA_DIR"

# Function to check if required MCP keys exist
check_mcp_keys() {
    # Check for MCP instance keys first (new structure)
    local mcp_instance_dir="/usr/src/app/mcp_instances/$MCP_ID"
    local instance_private_key="$mcp_instance_dir/keys/mcp-private.pem"
    local instance_public_key="$mcp_instance_dir/keys/mcp-public.pem"
    
    if [ -f "$instance_private_key" ] && [ -f "$instance_public_key" ]; then
        echo "✅ MCP instance keys found at $mcp_instance_dir/keys/"
        # Update KEYS_DIR to point to the instance keys directory for consistency
        KEYS_DIR="$mcp_instance_dir/keys"
        return 0
    fi
    
    # Fall back to federation-specific keys (old structure)
    local mcp_key_name="${FEDERATION_NAME}-mcp"
    local private_key="$KEYS_DIR/${mcp_key_name}-private.pem"
    local public_key="$KEYS_DIR/${mcp_key_name}-public.pem"
    
    if [ -f "$private_key" ] && [ -f "$public_key" ]; then
        echo "✅ Federation MCP keys found and accessible"
        return 0
    fi
    
    # Neither key structure found
    echo "❌ FATAL: Missing MCP keys"
    echo "   Looked for instance keys: $instance_private_key"
    echo "   Looked for federation keys: $private_key"
    echo "   Run 'fedmgr create mcp $MCP_ID --federation $FEDERATION_NAME' before starting containers"
    return 1
}

# Function to check federation admin connectivity
check_federation_admin() {
    echo "🔗 Checking federation admin connectivity..."
    
    # Wait for federation admin to be ready
    max_attempts=30
    attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if wget --quiet --tries=1 --spider "$FEDERATION_ADMIN_URL/health" 2>/dev/null; then
            echo "✅ Federation admin is accessible at $FEDERATION_ADMIN_URL"
            return 0
        fi
        
        if [ $attempt -eq 1 ]; then
            echo "⏳ Waiting for federation admin to start..."
        fi
        
        echo "   Attempt $attempt/$max_attempts..."
        sleep 2
        attempt=$((attempt + 1))
    done
    
    echo "⚠️  WARNING: Federation admin not responding at $FEDERATION_ADMIN_URL"
    echo "   MCP server will start anyway, but federation integration may not work"
    return 1
}

# Validate prerequisites
echo "🔑 Checking MCP keys..."
if ! check_mcp_keys; then
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

# Check key permissions and validity
echo "🔧 Running key validation..."
MCP_PRIVATE_KEY="$KEYS_DIR/mcp-private.pem"

# Handle both new and old key naming
if [ ! -f "$MCP_PRIVATE_KEY" ]; then
    MCP_PRIVATE_KEY="$KEYS_DIR/${FEDERATION_NAME}-mcp-private.pem"
fi

if [ -r "$MCP_PRIVATE_KEY" ]; then
    echo "✅ MCP private key is readable: $MCP_PRIVATE_KEY"
else
    echo "❌ FATAL: MCP private key is not readable - check file permissions: $MCP_PRIVATE_KEY"
    exit 1
fi

# Test key validity (basic check)
if command -v openssl >/dev/null 2>&1; then
    if openssl rsa -in "$MCP_PRIVATE_KEY" -noout 2>/dev/null; then
        echo "✅ MCP private key appears to be valid"
    else
        echo "❌ FATAL: MCP private key appears to be corrupted or invalid"
        exit 1
    fi
fi

# Create data directories
echo "📁 Setting up data directories..."
mkdir -p "$DATA_DIR"

# Check federation admin (non-blocking)
check_federation_admin || true

# Set final environment variables
export FEDMGR_KEYS_PATH="$KEYS_DIR"

# Log final configuration
echo "📋 Final MCP Configuration:"
echo "  - MCP_ID: $MCP_ID"
echo "  - MCP_PORT: $MCP_PORT"
echo "  - MCP_HOST: $MCP_HOST"
echo "  - MCP_PUBLIC_DIR: $MCP_PUBLIC_DIR"
echo "  - FEDERATION_ADMIN_URL: $FEDERATION_ADMIN_URL"
echo "  - FEDERATION_NAME: $FEDERATION_NAME"
echo "  - KEYS_DIR: $KEYS_DIR"

echo "✅ All prerequisites validated successfully"
echo "🤖 Starting MCP server with dual protocol support..."

# Add health endpoint check delay
echo "⏳ Allowing time for service initialization..."
sleep 2

exec node node_modules/@letsfederate/mcp-core/mcp-server.js
