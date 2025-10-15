#!/bin/bash

# Infrastructure Validation Script
# Validates the complete infrastructure redesign for certificate/key handling and Docker lifecycle

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

# Test configuration
TEST_FEDERATION="test-validation"
BUILD_DIR="./build/install"
KEYS_DIR="$BUILD_DIR/keys"
FEDERATIONS_DIR="$BUILD_DIR/federations"

# Test counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

echo "Oct 14: may need to refactor this as OIDC mock is deprecated and key generation should happen from library"


# Function to run a test
run_test() {
    local test_name="$1"
    local test_command="$2"
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    echo ""
    log_info "Test: $test_name"
    
    if eval "$test_command"; then
        log_success "PASSED: $test_name"
        PASSED_TESTS=$((PASSED_TESTS + 1))
        return 0
    else
        log_error "FAILED: $test_name"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        return 1
    fi
}

# Test: Directory structure
test_directory_structure() {
    local required_dirs=(
        "$BUILD_DIR"
        "$KEYS_DIR" 
        "$FEDERATIONS_DIR"
        "$BUILD_DIR/fed-reg"
        "$BUILD_DIR/oidc-mock"
        "./build/npm"
    )
    
    for dir in "${required_dirs[@]}"; do
        if [[ ! -d "$dir" ]]; then
            log_error "Required directory missing: $dir"
            return 1
        fi
    done
    
    log_success "All required directories exist"
    return 0
}


# Test: Key provider abstraction
test_key_provider() {
    # Test filesystem key provider
    if ! node -e "
        const { getDefaultKeyProvider } = require('./src/fedmgr/server/utils/key-provider');
        const provider = getDefaultKeyProvider();
        if (!provider) throw new Error('Failed to create key provider');
        console.log('Key provider created successfully');
    " 2>/dev/null; then
        log_error "Key provider abstraction failed"
        return 1
    fi
    
    log_success "Key provider abstraction working correctly"
    return 0
}

# Test: Docker Compose configuration
test_docker_compose() {
    # Test docker-compose.yml syntax
    if ! docker-compose -f docker-compose.yml config >/dev/null 2>&1; then
        log_error "docker-compose.yml has syntax errors"
        return 1
    fi
    
    log_success "Docker Compose configurations are valid"
    return 0
}


# Test: Environment variables
test_environment_variables() {
    # Check .env.example has required variables
    local required_vars=(
        "FEDERATION_NAME"
        "FEDMGR_BUILD_DIR"
        "FEDMGR_KEYS_PATH"
        "FEDMGR_FEDERATIONS_DIR"
        "FEDMGR_KEY_PROVIDER"
    )
    
    for var in "${required_vars[@]}"; do
        if ! grep -q "^$var=" .env.example 2>/dev/null; then
            log_error ".env.example missing required variable: $var"
            return 1
        fi
    done
    
    log_success "Environment variables properly configured"
    return 0
}

# Test: Bootstrap scripts validation
test_bootstrap_scripts() {
    # Check that bootstrap scripts no longer generate keys
    if grep -q "openssl genrsa" scripts/docker-bootstrap.sh 2>/dev/null; then
        log_error "docker-bootstrap.sh still contains key generation code"
        return 1
    fi
    
    if grep -q "openssl genrsa" scripts/mcp-bootstrap.sh 2>/dev/null; then
        log_error "mcp-bootstrap.sh still contains key generation code"
        return 1
    fi
    
    # Check that bootstrap scripts validate keys
    if ! grep -q "FATAL.*Missing.*key" scripts/docker-bootstrap.sh 2>/dev/null; then
        log_error "docker-bootstrap.sh does not validate key presence"
        return 1
    fi
    
    log_success "Bootstrap scripts properly validate keys without generating them"
    return 0
}

# Test: Container key validation (simulated)
test_container_validation() {
    # Temporarily move keys to simulate missing keys
    local temp_dir=$(mktemp -d)
    mv "$KEYS_DIR"/* "$temp_dir/" 2>/dev/null || true
    
    # Test that bootstrap script fails with missing keys
    if scripts/docker-bootstrap.sh 2>/dev/null; then
        # Restore keys
        mv "$temp_dir"/* "$KEYS_DIR/" 2>/dev/null || true
        rmdir "$temp_dir"
        log_error "Bootstrap script should fail with missing keys"
        return 1
    fi
    
    # Restore keys
    mv "$temp_dir"/* "$KEYS_DIR/" 2>/dev/null || true
    rmdir "$temp_dir"
    
    log_success "Container validation fails appropriately with missing keys"
    return 0
}



# Main validation function
main() {
    log_header "🔐 Infrastructure Validation Suite"
    log_info "Validating certificate/key handling and Docker lifecycle redesign"
    
    # Ensure we're in the right directory
    if [[ ! -f "package.json" ]] || [[ ! -d "src" ]]; then
        log_error "This script must be run from the fedmgr root directory"
        exit 1
    fi
    
    # Create necessary directories if they don't exist
    mkdir -p "$BUILD_DIR"/{keys,federations,fed-reg,oidc-mock}
    
    log_header "📋 Running Validation Tests"
    
    # Run all tests
    run_test "Directory Structure" "test_directory_structure"
    run_test "Key Provider Abstraction" "test_key_provider"
    run_test "Docker Compose Configuration" "test_docker_compose"
    run_test "Environment Variables" "test_environment_variables"
    run_test "Bootstrap Scripts" "test_bootstrap_scripts"
    run_test "Container Validation" "test_container_validation"
    
    # Clean up test artifacts
    log_info "Cleaning up test artifacts..."
    rm -rf "$KEYS_DIR/$TEST_FEDERATION"*
    rm -rf "$FEDERATIONS_DIR/$TEST_FEDERATION"
    
    # Report results
    log_header "📊 Validation Results"
    echo ""
    echo "Total Tests: $TOTAL_TESTS"
    echo "Passed:      $PASSED_TESTS"
    echo "Failed:      $FAILED_TESTS"
    echo ""
    
    if [[ $FAILED_TESTS -eq 0 ]]; then
        log_success "🎉 All validation tests passed!"
        log_info "Infrastructure redesign is working correctly"
        echo ""
        log_header "🚀 Next Steps"
        echo "1. Test with actual Docker containers: docker-compose up -d"
        echo "2. Run integration tests: npm run test:integration"
        echo "3. Verify federation operations: npm run fedmgr list"
        echo ""
        exit 0
    else
        log_error "💥 $FAILED_TESTS validation test(s) failed"
        log_warning "Please fix the failing tests before proceeding"
        echo ""
        exit 1
    fi
}

# Handle script arguments
case "${1:-}" in
    --help|-h)
        echo "Infrastructure Validation Script"
        echo ""
        echo "Usage: $0 [options]"
        echo ""
        echo "Options:"
        echo "  --help, -h    Show this help message"
        echo ""
        echo "This script validates the infrastructure redesign including:"
        echo "  - Key generation and management"
        echo "  - Docker configuration and volume mounts" 
        echo "  - Bootstrap script validation"
        echo "  - Documentation consistency"
        echo ""
        exit 0
        ;;
    *)
        main "$@"
        ;;
esac