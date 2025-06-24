#!/bin/bash

# Federation Key Setup Script
# This script generates all required keys for a federation before Docker container startup
# Replaces the in-container key generation approach

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Helper function for colored output
log_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; }
log_header() { echo -e "${BOLD}${BLUE}$1${NC}"; }

# Default values
FEDERATION_NAME=""
KEY_SIZE="2048"
FORCE_OVERWRITE=false
BUILD_DIR="./build/install"
KEYS_DIR="$BUILD_DIR/keys"
FEDERATIONS_DIR="$BUILD_DIR/federations"

# Usage function
usage() {
    cat << EOF
Usage: $0 [OPTIONS] <federation-name>

Generate all required keys for a federation before Docker container startup.

Arguments:
    federation-name     Name of the federation to generate keys for

Options:
    -s, --key-size     RSA key size in bits (default: 2048)
    -f, --force        Overwrite existing keys
    -d, --build-dir    Build directory (default: ./build/install)
    -h, --help         Show this help message

Examples:
    $0 alpha                           # Generate keys for 'alpha' federation
    $0 --key-size 4096 alpha          # Generate 4096-bit keys
    $0 --force alpha                  # Overwrite existing keys
    $0 --build-dir /custom/build alpha # Use custom build directory

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -s|--key-size)
            KEY_SIZE="$2"
            shift 2
            ;;
        -f|--force)
            FORCE_OVERWRITE=true
            shift
            ;;
        -d|--build-dir)
            BUILD_DIR="$2"
            KEYS_DIR="$BUILD_DIR/keys"
            FEDERATIONS_DIR="$BUILD_DIR/federations"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        -*|--*)
            log_error "Unknown option $1"
            usage
            exit 1
            ;;
        *)
            if [[ -z "$FEDERATION_NAME" ]]; then
                FEDERATION_NAME="$1"
            else
                log_error "Multiple federation names provided"
                usage
                exit 1
            fi
            shift
            ;;
    esac
done

# Validate required arguments
if [[ -z "$FEDERATION_NAME" ]]; then
    log_error "Federation name is required"
    usage
    exit 1
fi

# Validate key size
if ! [[ "$KEY_SIZE" =~ ^[0-9]+$ ]] || [[ "$KEY_SIZE" -lt 1024 ]]; then
    log_error "Key size must be a number >= 1024"
    exit 1
fi

log_header "🔐 Federation Key Setup"
log_info "Federation: $FEDERATION_NAME"
log_info "Key size: $KEY_SIZE bits"
log_info "Build directory: $BUILD_DIR"
log_info "Keys directory: $KEYS_DIR"

# Create directory structure
log_info "Creating directory structure..."
mkdir -p "$KEYS_DIR"
mkdir -p "$FEDERATIONS_DIR/$FEDERATION_NAME/keys"
mkdir -p "$FEDERATIONS_DIR/$FEDERATION_NAME/config"

# Function to generate a key pair
generate_key_pair() {
    local key_name="$1"
    local description="$2"
    local output_dir="$3"
    
    local private_key="$output_dir/${key_name}-private.pem"
    local public_key="$output_dir/${key_name}-public.pem"
    
    # Check if keys already exist
    if [[ -f "$private_key" && -f "$public_key" ]]; then
        if [[ "$FORCE_OVERWRITE" == "true" ]]; then
            log_warning "Overwriting existing keys for $description"
        else
            log_info "$description keys already exist, skipping..."
            return 0
        fi
    fi
    
    log_info "Generating $description keys..."
    
    # Generate private key
    if ! openssl genrsa -out "$private_key" "$KEY_SIZE" 2>/dev/null; then
        log_error "Failed to generate private key for $description"
        return 1
    fi
    
    # Generate public key from private key
    if ! openssl rsa -in "$private_key" -pubout -out "$public_key" 2>/dev/null; then
        log_error "Failed to generate public key for $description"
        return 1
    fi
    
    # Set appropriate permissions
    chmod 600 "$private_key"
    chmod 644 "$public_key"
    
    log_success "$description keys generated"
    log_info "  Private: $private_key"
    log_info "  Public:  $public_key"
}

# Generate federation anchor keys (for trust anchor)
generate_key_pair "anchor" "Federation anchor" "$KEYS_DIR"

# Generate federation-specific keys
FED_KEYS_DIR="$FEDERATIONS_DIR/$FEDERATION_NAME/keys"
generate_key_pair "anchor" "Federation entity" "$FED_KEYS_DIR"

# Generate MCP keys for this federation
generate_key_pair "$FEDERATION_NAME-mcp" "MCP server" "$KEYS_DIR"

# Create federation entity configuration
CONFIG_FILE="$FEDERATIONS_DIR/$FEDERATION_NAME/config/entity-configuration.json"
if [[ ! -f "$CONFIG_FILE" || "$FORCE_OVERWRITE" == "true" ]]; then
    log_info "Creating entity configuration..."
    
    cat > "$CONFIG_FILE" << EOF
{
  "sub": "http://localhost:3001",
  "metadata": {
    "federation_entity": {
      "organization_name": "Federation $FEDERATION_NAME",
      "federation_fetch_endpoint": "http://localhost:3001/.well-known/openid-federation",
      "federation_resolve_endpoint": "http://localhost:3001/resolve",
      "federation_trust_mark_status_endpoint": "http://localhost:3001/trust-mark-status"
    }
  },
  "jwks": {
    "keys": []
  },
  "iat": $(date +%s)
}
EOF
    
    log_success "Entity configuration created: $CONFIG_FILE"
else
    log_info "Entity configuration already exists, skipping..."
fi

# Create OIDC mock configuration if needed
OIDC_CONFIG_DIR="$BUILD_DIR/oidc-mock/oidc-config"
if [[ ! -d "$OIDC_CONFIG_DIR" ]]; then
    log_info "Creating OIDC mock configuration..."
    mkdir -p "$OIDC_CONFIG_DIR"
    
    # Server options
    cat > "$OIDC_CONFIG_DIR/server-options.json" << EOF
{
  "Issuer": "http://localhost:8080",
  "Authentication": {
    "CookieSameSiteMode": "Lax",
    "CheckSessionEndpointEnabled": true
  }
}
EOF

    # Client configuration
    cat > "$OIDC_CONFIG_DIR/clients-config.json" << EOF
[
  {
    "ClientId": "fedmgr-client",
    "ClientSecrets": ["fedmgr-secret"],
    "Description": "Federation Manager Client",
    "AllowedGrantTypes": ["authorization_code", "client_credentials", "refresh_token"],
    "AllowedScopes": ["openid", "profile", "email", "fedmgr"],
    "RedirectUris": ["http://localhost:3001/oauth/callback"],
    "PostLogoutRedirectUris": ["http://localhost:3001/logout"],
    "AllowOfflineAccess": true
  }
]
EOF

    # Users configuration
    cat > "$OIDC_CONFIG_DIR/users-config.json" << EOF
[
  {
    "SubjectId": "test-user",
    "Username": "testuser",
    "Password": "password",
    "Claims": [
      {
        "Type": "name",
        "Value": "Test User"
      },
      {
        "Type": "email",
        "Value": "test@example.com"
      },
      {
        "Type": "fedmgr_role",
        "Value": "admin"
      }
    ]
  }
]
EOF
    
    log_success "OIDC mock configuration created"
fi

# Create environment file template
ENV_FILE="$BUILD_DIR/.env.docker"
if [[ ! -f "$ENV_FILE" || "$FORCE_OVERWRITE" == "true" ]]; then
    log_info "Creating Docker environment file..."
    
    cat > "$ENV_FILE" << EOF
# Docker Environment Configuration
# Generated by setup-keys.sh

# Federation settings
FEDERATION_NAME=$FEDERATION_NAME
FEDMGR_BUILD_REL_NPM_DIR=./build/npm

# Key provider settings
FEDMGR_KEY_PROVIDER=filesystem
FEDMGR_KEYS_PATH=$KEYS_DIR
FEDMGR_KEY_SIZE=$KEY_SIZE

# OIDC Mock settings
OIDC_MOCK_CONFIG_DIR_REL=./build/install/oidc-mock/oidc-config

# Build paths
FEDMGR_BUILD_DIR=$BUILD_DIR
FEDMGR_FEDERATIONS_DIR=$FEDERATIONS_DIR
FEDMGR_FED_REG_DIR=$BUILD_DIR/fed-reg
EOF
    
    log_success "Docker environment file created: $ENV_FILE"
else
    log_info "Docker environment file already exists, skipping..."
fi

# Generate a verification script
VERIFY_SCRIPT="$BUILD_DIR/verify-keys.sh"
cat > "$VERIFY_SCRIPT" << 'EOF'
#!/bin/bash

# Key Verification Script
# Verifies that all required keys are present and valid

set -e

KEYS_DIR="./keys"
FEDERATIONS_DIR="./federations"
FEDERATION_NAME="${1:-alpha}"

echo "🔍 Verifying keys for federation: $FEDERATION_NAME"

# Function to verify a key pair
verify_key_pair() {
    local private_key="$1"
    local public_key="$2"
    local description="$3"
    
    if [[ ! -f "$private_key" ]]; then
        echo "❌ Missing private key: $private_key"
        return 1
    fi
    
    if [[ ! -f "$public_key" ]]; then
        echo "❌ Missing public key: $public_key"
        return 1
    fi
    
    # Test key validity by trying to extract public key from private key
    if ! openssl rsa -in "$private_key" -pubout -noout 2>/dev/null; then
        echo "❌ Invalid private key: $private_key"
        return 1
    fi
    
    # Verify public key format
    if ! openssl rsa -pubin -in "$public_key" -noout 2>/dev/null; then
        echo "❌ Invalid public key: $public_key"
        return 1
    fi
    
    echo "✅ $description keys are valid"
}

# Verify federation anchor keys
verify_key_pair "$KEYS_DIR/anchor-private.pem" "$KEYS_DIR/anchor-public.pem" "Federation anchor"

# Verify federation entity keys
verify_key_pair "$FEDERATIONS_DIR/$FEDERATION_NAME/keys/anchor-private.pem" "$FEDERATIONS_DIR/$FEDERATION_NAME/keys/anchor-public.pem" "Federation entity"

# Verify MCP keys
verify_key_pair "$KEYS_DIR/$FEDERATION_NAME-mcp-private.pem" "$KEYS_DIR/$FEDERATION_NAME-mcp-public.pem" "MCP server"

echo "🔐 All keys verified successfully for federation: $FEDERATION_NAME"
EOF

chmod +x "$VERIFY_SCRIPT"
log_success "Key verification script created: $VERIFY_SCRIPT"

# Summary
log_header "📋 Setup Summary"
log_success "Federation '$FEDERATION_NAME' key setup completed successfully!"
log_info "Generated keys:"
log_info "  • Federation anchor keys (trust anchor)"
log_info "  • Federation entity keys (federation-specific)"
log_info "  • MCP server keys"
log_info "  • Entity configuration file"
log_info "  • OIDC mock configuration"

log_header "🚀 Next Steps"
echo "1. Verify keys: cd $BUILD_DIR && ./verify-keys.sh $FEDERATION_NAME"
echo "2. Start Docker services: docker-compose up -d"
echo "3. Check container logs: docker-compose logs -f"

log_header "📁 Generated Files"
find "$BUILD_DIR" -name "*.pem" -o -name "*.json" -o -name ".env.docker" | sort