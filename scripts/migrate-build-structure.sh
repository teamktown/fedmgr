#!/bin/bash

# Build Structure Migration Script
# Migrates from legacy build structure to standardized ./build/install/ structure

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
DRY_RUN=false
BACKUP=true
FORCE=false

# Usage function
usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Migrate from legacy build structure to standardized ./build/install/ structure.

Options:
    --dry-run     Show what would be migrated without making changes
    --no-backup   Skip creating backup of existing files
    --force       Overwrite existing files in target locations
    -h, --help    Show this help message

Legacy directories that will be migrated:
    ./build/runtime/     -> ./build/install/
    ./mcp_instances/     -> ./build/install/mcp-instances/
    ./federations/       -> ./build/install/federations/
    ./data/              -> ./build/install/fed-reg/

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --no-backup)
            BACKUP=false
            shift
            ;;
        --force)
            FORCE=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

log_header "🔄 Build Structure Migration"

if [[ "$DRY_RUN" == "true" ]]; then
    log_info "DRY RUN MODE - No changes will be made"
fi

# Check if we're in the right directory
if [[ ! -f "package.json" ]] || [[ ! -d "src" ]]; then
    log_error "This script must be run from the fedmgr root directory"
    exit 1
fi

# Function to migrate directory
migrate_directory() {
    local source="$1"
    local target="$2"
    local description="$3"
    
    if [[ ! -d "$source" ]]; then
        log_info "$description: Source directory '$source' not found, skipping"
        return 0
    fi
    
    log_info "$description: Migrating '$source' -> '$target'"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "  Would create: $target"
        if [[ -d "$source" ]]; then
            find "$source" -type f | while read -r file; do
                relative_path="${file#$source/}"
                target_file="$target/$relative_path"
                log_info "    Would copy: $file -> $target_file"
            done
        fi
        return 0
    fi
    
    # Create target directory
    mkdir -p "$target"
    
    # Copy files preserving structure
    if find "$source" -mindepth 1 -maxdepth 1 | read; then
        cp -r "$source"/* "$target/"
        log_success "  Copied contents from $source to $target"
    else
        log_info "  Source directory is empty"
    fi
    
    # Set appropriate permissions
    find "$target" -name "*.pem" -type f -exec chmod 600 {} \;
    find "$target" -name "*.json" -type f -exec chmod 644 {} \;
    
    return 0
}

# Function to create backup
create_backup() {
    local source="$1"
    local backup_name="$2"
    
    if [[ ! -d "$source" ]]; then
        return 0
    fi
    
    local backup_dir="./build/backup-$(date +%Y%m%d-%H%M%S)"
    local backup_target="$backup_dir/$backup_name"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Would create backup: $source -> $backup_target"
        return 0
    fi
    
    mkdir -p "$backup_dir"
    cp -r "$source" "$backup_target"
    log_success "Created backup: $backup_target"
}

# Create standard build structure
log_info "Creating standardized build directory structure..."

if [[ "$DRY_RUN" == "false" ]]; then
    mkdir -p ./build/install/{keys,federations,fed-reg,oidc-mock/oidc-config,mcp-instances}
    log_success "Created ./build/install/ directory structure"
fi

# Migrate legacy directories
if [[ "$BACKUP" == "true" ]]; then
    log_header "📦 Creating Backups"
    create_backup "./build/runtime" "runtime"
    create_backup "./mcp_instances" "mcp_instances"
    create_backup "./federations" "federations"
    create_backup "./data" "data"
fi

log_header "📁 Migrating Directories"

# Migrate ./build/runtime/ -> ./build/install/
migrate_directory "./build/runtime/federations" "./build/install/federations" "Runtime federations"
migrate_directory "./build/runtime/data" "./build/install/fed-reg" "Runtime data"

# Migrate ./mcp_instances/ -> ./build/install/mcp-instances/
migrate_directory "./mcp_instances" "./build/install/mcp-instances" "MCP instances"

# Migrate ./federations/ -> ./build/install/federations/
if [[ -d "./federations" ]]; then
    log_info "Federation directory: Merging './federations' into './build/install/federations'"
    if [[ "$DRY_RUN" == "false" ]]; then
        # Merge federations, don't overwrite existing
        cp -rn "./federations"/* "./build/install/federations/" 2>/dev/null || true
        log_success "  Merged federations directory"
    fi
fi

# Migrate ./data/ -> ./build/install/fed-reg/
if [[ -d "./data" ]]; then
    log_info "Data directory: Migrating './data' to './build/install/fed-reg'"
    if [[ "$DRY_RUN" == "false" ]]; then
        # Copy data files, focusing on registry and related files
        mkdir -p "./build/install/fed-reg"
        find "./data" -name "*.json" -exec cp {} "./build/install/fed-reg/" \;
        log_success "  Migrated data files to fed-reg"
    fi
fi

# Update .env file if it exists
ENV_FILE=".env"
if [[ -f "$ENV_FILE" ]]; then
    log_header "⚙️  Updating Environment Variables"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Would update $ENV_FILE with new paths"
    else
        # Create backup of .env
        cp "$ENV_FILE" "$ENV_FILE.backup.$(date +%Y%m%d-%H%M%S)"
        
        # Update paths in .env file
        sed -i.tmp \
            -e 's|FEDMGR_FEDERATIONS_DIR=.*|FEDMGR_FEDERATIONS_DIR=./build/install/federations|' \
            -e 's|FEDMGR_FED_REG_DIR=.*|FEDMGR_FED_REG_DIR=./build/install/fed-reg|' \
            -e 's|FEDMGR_FED_REG_FILE=.*|FEDMGR_FED_REG_FILE=./build/install/fed-reg/registry.json|' \
            "$ENV_FILE"
            
        rm -f "$ENV_FILE.tmp"
        log_success "Updated $ENV_FILE with new paths"
    fi
fi

# Validate migration
log_header "🔍 Validation"

if [[ "$DRY_RUN" == "false" ]]; then
    # Check if essential files exist
    essential_dirs=(
        "./build/install/federations"
        "./build/install/fed-reg"
        "./build/install/keys"
    )
    
    all_good=true
    for dir in "${essential_dirs[@]}"; do
        if [[ -d "$dir" ]]; then
            log_success "Essential directory exists: $dir"
        else
            log_warning "Essential directory missing: $dir"
            all_good=false
        fi
    done
    
    if [[ "$all_good" == "true" ]]; then
        log_success "Migration validation passed"
    else
        log_warning "Some essential directories are missing - review migration results"
    fi
    
    # Show structure
    log_info "New build structure:"
    if command -v tree >/dev/null 2>&1; then
        tree ./build/install/ || true
    else
        find ./build/install/ -type d | sort | sed 's|^./build/install|  |'
    fi
fi

# Generate summary
log_header "📋 Migration Summary"

if [[ "$DRY_RUN" == "true" ]]; then
    log_info "This was a dry run - no changes were made"
    log_info "Run without --dry-run to perform the actual migration"
else
    log_success "Migration completed successfully!"
    
    if [[ "$BACKUP" == "true" ]]; then
        log_info "Backups created in ./build/backup-* directories"
    fi
    
    log_info "Next steps:"
    echo "  1. Verify the migration: ls -la ./build/install/"
    echo "  2. Test key generation: ./scripts/setup-keys.sh alpha"
    echo "  3. Update Docker Compose files to use new paths"
    echo "  4. Test Docker startup: docker-compose up -d"
    
    if [[ -d "./build/runtime" ]] || [[ -d "./mcp_instances" ]] || [[ -d "./federations" ]] || [[ -d "./data" ]]; then
        log_warning "Legacy directories still exist - you may want to remove them after testing:"
        echo "  rm -rf ./build/runtime ./mcp_instances ./federations ./data"
    fi
fi