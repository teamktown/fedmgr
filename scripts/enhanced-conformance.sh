#!/bin/bash

# enhanced-conformance.sh - Enhanced OpenID Federation conformance testing
# 
# Features:
# - Comprehensive conformance test execution
# - Detailed reporting and artifact storage
# - Regression analysis and trend tracking
# - CI/CD integration with version gates
# - Multi-profile testing (Basic, Advanced, Security)
# - Performance benchmarking
# - Test isolation and cleanup

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION=$(node -p "require('$PROJECT_ROOT/package.json').version" 2>/dev/null || echo "dev-$(date +%Y%m%d-%H%M%S)")
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
BUILD_ID=${BUILD_ID:-"local-$(date +%s)"}

# Directories
RESULTS_BASE_DIR="$PROJECT_ROOT/build/conformance"
RESULTS_DIR="$RESULTS_BASE_DIR/$VERSION"
ARTIFACTS_DIR="$RESULTS_DIR/artifacts"
REPORTS_DIR="$RESULTS_DIR/reports"
LOGS_DIR="$RESULTS_DIR/logs"

# Configuration files
CONFIG_DIR="$PROJECT_ROOT/config/conformance"
PROFILES_DIR="$CONFIG_DIR/profiles"

# Test configuration
CONFORMANCE_IMAGE=${CONFORMANCE_IMAGE:-"ghcr.io/openid/conformance-suite:release-v5.1.22"}
FEDMGR_HOST=${FEDMGR_HOST:-"host.docker.internal"}
FEDMGR_PORT=${FEDMGR_PORT:-"3001"}
TIMEOUT=${CONFORMANCE_TIMEOUT:-"1800"} # 30 minutes default
PARALLEL_TESTS=${PARALLEL_TESTS:-"false"}
PROFILES=${CONFORMANCE_PROFILES:-"basic,advanced"}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Logging functions
log_info() { echo -e "${BLUE}[INFO]${NC} $*" | tee -a "$LOGS_DIR/conformance.log"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*" | tee -a "$LOGS_DIR/conformance.log"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" | tee -a "$LOGS_DIR/conformance.log"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $*" | tee -a "$LOGS_DIR/conformance.log"; }
log_debug() { 
    if [[ "${DEBUG:-false}" == "true" ]]; then
        echo -e "${PURPLE}[DEBUG]${NC} $*" | tee -a "$LOGS_DIR/conformance.log";
    fi
}

# Print banner
print_banner() {
    cat << 'EOF'
╔══════════════════════════════════════════════════════════════╗
║                Enhanced Conformance Testing                  ║
║              OpenID Federation Compliance                    ║
╚══════════════════════════════════════════════════════════════╝
EOF
}

# Setup directories
setup_directories() {
    log_info "Setting up directory structure..."
    
    mkdir -p "$RESULTS_DIR" "$ARTIFACTS_DIR" "$REPORTS_DIR" "$LOGS_DIR"
    mkdir -p "$CONFIG_DIR" "$PROFILES_DIR"
    
    # Create configuration files if they don't exist
    create_default_configs
    
    log_success "Directory structure created"
}

# Create default configuration files
create_default_configs() {
    # Basic profile configuration
    if [[ ! -f "$PROFILES_DIR/basic.json" ]]; then
        cat > "$PROFILES_DIR/basic.json" << 'EOF'
{
  "profile": "basic",
  "description": "Basic OpenID Federation compliance tests",
  "tests": [
    "oidf-server-discovery",
    "oidf-entity-statement-verification",
    "oidf-trust-chain-validation",
    "oidf-metadata-validation"
  ],
  "timeout": 600,
  "retry_count": 1
}
EOF
    fi
    
    # Advanced profile configuration
    if [[ ! -f "$PROFILES_DIR/advanced.json" ]]; then
        cat > "$PROFILES_DIR/advanced.json" << 'EOF'
{
  "profile": "advanced",
  "description": "Advanced OpenID Federation compliance tests",
  "tests": [
    "oidf-server-discovery",
    "oidf-entity-statement-verification", 
    "oidf-trust-chain-validation",
    "oidf-metadata-validation",
    "oidf-trust-mark-validation",
    "oidf-metadata-policy-application",
    "oidf-subordinate-statement-validation",
    "oidf-federation-list-endpoint",
    "oidf-federation-fetch-endpoint",
    "oidf-federation-resolve-endpoint"
  ],
  "timeout": 1200,
  "retry_count": 2
}
EOF
    fi
    
    # Security profile configuration
    if [[ ! -f "$PROFILES_DIR/security.json" ]]; then
        cat > "$PROFILES_DIR/security.json" << 'EOF'
{
  "profile": "security",
  "description": "Security-focused OpenID Federation tests",
  "tests": [
    "oidf-jwt-signature-validation",
    "oidf-certificate-validation",
    "oidf-key-rotation-handling",
    "oidf-expired-statement-rejection",
    "oidf-malformed-statement-rejection",
    "oidf-trust-anchor-validation"
  ],
  "timeout": 900,
  "retry_count": 1
}
EOF
    fi
    
    # Main conformance configuration
    if [[ ! -f "$CONFIG_DIR/conformance.json" ]]; then
        cat > "$CONFIG_DIR/conformance.json" << EOF
{
  "federation_endpoint": "http://$FEDMGR_HOST:$FEDMGR_PORT",
  "entity_id": "http://$FEDMGR_HOST:$FEDMGR_PORT",
  "discovery_endpoint": "http://$FEDMGR_HOST:$FEDMGR_PORT/.well-known/openid-federation",
  "timeout": $TIMEOUT,
  "retry_policy": {
    "max_retries": 3,
    "backoff_factor": 2,
    "initial_delay": 1
  },
  "validation": {
    "strict_mode": true,
    "allow_http": true,
    "check_certificate_chain": true,
    "validate_trust_marks": true
  }
}
EOF
    fi
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is required but not installed"
        return 1
    fi
    
    # Check jq
    if ! command -v jq &> /dev/null; then
        log_error "jq is required but not installed"
        return 1
    fi
    
    # Check fedmgr server is running
    if ! curl -s "http://$FEDMGR_HOST:$FEDMGR_PORT/health" &> /dev/null; then
        log_warn "fedmgr server may not be running at http://$FEDMGR_HOST:$FEDMGR_PORT"
        log_info "Starting fedmgr server..."
        start_fedmgr_server
    fi
    
    # Pull conformance suite image
    log_info "Pulling conformance suite image: $CONFORMANCE_IMAGE"
    docker pull "$CONFORMANCE_IMAGE" || {
        log_error "Failed to pull conformance suite image"
        return 1
    }
    
    log_success "Prerequisites check completed"
}

# Start fedmgr server for testing
start_fedmgr_server() {
    log_info "Starting fedmgr server for conformance testing..."
    
    cd "$PROJECT_ROOT"
    
    # Create test federation if it doesn't exist
    if [[ ! -d "federations/conformance-test" ]]; then
        log_info "Creating conformance test federation..."
        npm run cli create fed conformance-test || {
            log_error "Failed to create test federation"
            return 1
        }
    fi
    
    # Start the federation server in background
    log_info "Starting federation server on port $FEDMGR_PORT..."
    FEDMGR_PORT="$FEDMGR_PORT" npm start &
    SERVER_PID=$!
    
    # Wait for server to start
    local retries=30
    while [[ $retries -gt 0 ]]; do
        if curl -s "http://$FEDMGR_HOST:$FEDMGR_PORT/health" &> /dev/null; then
            log_success "fedmgr server started successfully"
            echo "$SERVER_PID" > "$LOGS_DIR/server.pid"
            return 0
        fi
        sleep 2
        ((retries--))
    done
    
    log_error "Failed to start fedmgr server"
    kill $SERVER_PID 2>/dev/null || true
    return 1
}

# Stop fedmgr server
stop_fedmgr_server() {
    if [[ -f "$LOGS_DIR/server.pid" ]]; then
        local pid=$(cat "$LOGS_DIR/server.pid")
        log_info "Stopping fedmgr server (PID: $pid)..."
        kill "$pid" 2>/dev/null || true
        rm -f "$LOGS_DIR/server.pid"
    fi
}

# Run conformance tests for a specific profile
run_profile_tests() {
    local profile="$1"
    local profile_config="$PROFILES_DIR/$profile.json"
    
    if [[ ! -f "$profile_config" ]]; then
        log_error "Profile configuration not found: $profile_config"
        return 1
    fi
    
    log_info "Running conformance tests for profile: $profile"
    
    local profile_results_dir="$RESULTS_DIR/profiles/$profile"
    mkdir -p "$profile_results_dir"
    
    # Read profile configuration
    local timeout=$(jq -r '.timeout // 600' "$profile_config")
    local retry_count=$(jq -r '.retry_count // 1' "$profile_config")
    local tests=($(jq -r '.tests[]' "$profile_config"))
    
    local success_count=0
    local total_count=${#tests[@]}
    
    log_info "Profile $profile: Running $total_count tests (timeout: ${timeout}s, retries: $retry_count)"
    
    # Create profile report structure
    local profile_report="$profile_results_dir/report.json"
    cat > "$profile_report" << EOF
{
  "profile": "$profile",
  "version": "$VERSION",
  "timestamp": "$TIMESTAMP",
  "build_id": "$BUILD_ID",
  "total_tests": $total_count,
  "passed_tests": 0,
  "failed_tests": 0,
  "skipped_tests": 0,
  "execution_time": 0,
  "tests": []
}
EOF
    
    local start_time=$(date +%s)
    
    # Run each test
    for test in "${tests[@]}"; do
        log_info "Running test: $test"
        
        local test_start=$(date +%s)
        local test_status="failed"
        local test_output=""
        local test_error=""
        
        # Run test with retries
        local attempt=1
        while [[ $attempt -le $((retry_count + 1)) ]]; do
            if run_single_test "$test" "$profile_results_dir" "$timeout"; then
                test_status="passed"
                ((success_count++))
                break
            fi
            
            if [[ $attempt -le $retry_count ]]; then
                log_warn "Test $test failed (attempt $attempt/$((retry_count + 1))), retrying..."
                sleep $((attempt * 2)) # Exponential backoff
            fi
            ((attempt++))
        done
        
        local test_end=$(date +%s)
        local test_duration=$((test_end - test_start))
        
        # Update profile report
        update_profile_report "$profile_report" "$test" "$test_status" "$test_duration"
        
        if [[ "$test_status" == "passed" ]]; then
            log_success "Test $test: PASSED (${test_duration}s)"
        else
            log_error "Test $test: FAILED (${test_duration}s)"
        fi
    done
    
    local end_time=$(date +%s)
    local total_duration=$((end_time - start_time))
    
    # Finalize profile report
    finalize_profile_report "$profile_report" "$success_count" "$((total_count - success_count))" "$total_duration"
    
    log_info "Profile $profile completed: $success_count/$total_count tests passed (${total_duration}s)"
    
    if [[ $success_count -eq $total_count ]]; then
        return 0
    else
        return 1
    fi
}

# Run a single conformance test
run_single_test() {
    local test="$1"
    local results_dir="$2"
    local timeout="$3"
    
    local test_results_dir="$results_dir/tests/$test"
    mkdir -p "$test_results_dir"
    
    # Create test-specific configuration
    local test_config="$test_results_dir/config.json"
    jq --arg test "$test" --arg endpoint "http://$FEDMGR_HOST:$FEDMGR_PORT" \
       '.test = $test | .federation_endpoint = $endpoint' \
       "$CONFIG_DIR/conformance.json" > "$test_config"
    
    # Run the test
    local test_log="$test_results_dir/output.log"
    local test_result="$test_results_dir/result.json"
    
    # Docker run command for the specific test
    timeout "$timeout" docker run --rm \
        --network host \
        -v "$test_config:/config/test-config.json:ro" \
        -v "$test_results_dir:/results" \
        "$CONFORMANCE_IMAGE" \
        --config /config/test-config.json \
        --test "$test" \
        --output /results \
        > "$test_log" 2>&1
    
    local exit_code=$?
    
    # Check if test passed
    if [[ $exit_code -eq 0 ]] && [[ -f "$test_result" ]]; then
        local result_status=$(jq -r '.result // "unknown"' "$test_result" 2>/dev/null || echo "unknown")
        if [[ "$result_status" == "PASSED" || "$result_status" == "passed" ]]; then
            return 0
        fi
    fi
    
    return 1
}

# Update profile report with test result
update_profile_report() {
    local report_file="$1"
    local test="$2"
    local status="$3"
    local duration="$4"
    
    local temp_file=$(mktemp)
    jq --arg test "$test" --arg status "$status" --argjson duration "$duration" '
        .tests += [{
            "name": $test,
            "status": $status,
            "duration": $duration,
            "timestamp": now | strftime("%Y-%m-%dT%H:%M:%SZ")
        }]
    ' "$report_file" > "$temp_file" && mv "$temp_file" "$report_file"
}

# Finalize profile report
finalize_profile_report() {
    local report_file="$1"
    local passed="$2"
    local failed="$3"
    local duration="$4"
    
    local temp_file=$(mktemp)
    jq --argjson passed "$passed" --argjson failed "$failed" --argjson duration "$duration" '
        .passed_tests = $passed |
        .failed_tests = $failed |
        .execution_time = $duration |
        .success_rate = (($passed / .total_tests) * 100 | floor)
    ' "$report_file" > "$temp_file" && mv "$temp_file" "$report_file"
}

# Generate comprehensive report
generate_comprehensive_report() {
    log_info "Generating comprehensive conformance report..."
    
    local summary_report="$REPORTS_DIR/summary.json"
    local html_report="$REPORTS_DIR/report.html"
    local trends_report="$REPORTS_DIR/trends.json"
    
    # Create summary report
    cat > "$summary_report" << EOF
{
  "version": "$VERSION",
  "timestamp": "$TIMESTAMP",
  "build_id": "$BUILD_ID",
  "conformance_suite_version": "$CONFORMANCE_IMAGE",
  "federation_endpoint": "http://$FEDMGR_HOST:$FEDMGR_PORT",
  "profiles": []
}
EOF
    
    # Aggregate profile results
    local total_tests=0
    local total_passed=0
    local total_failed=0
    local overall_success=true
    
    for profile in $(echo "$PROFILES" | tr ',' ' '); do
        local profile_report="$RESULTS_DIR/profiles/$profile/report.json"
        if [[ -f "$profile_report" ]]; then
            local profile_data=$(cat "$profile_report")
            local profile_passed=$(echo "$profile_data" | jq -r '.passed_tests')
            local profile_failed=$(echo "$profile_data" | jq -r '.failed_tests')
            local profile_total=$(echo "$profile_data" | jq -r '.total_tests')
            
            total_tests=$((total_tests + profile_total))
            total_passed=$((total_passed + profile_passed))
            total_failed=$((total_failed + profile_failed))
            
            if [[ $profile_failed -gt 0 ]]; then
                overall_success=false
            fi
            
            # Add to summary
            local temp_file=$(mktemp)
            jq --argjson profile_data "$profile_data" '.profiles += [$profile_data]' \
               "$summary_report" > "$temp_file" && mv "$temp_file" "$summary_report"
        fi
    done
    
    # Update summary totals
    local temp_file=$(mktemp)
    jq --argjson total "$total_tests" --argjson passed "$total_passed" --argjson failed "$total_failed" --argjson success "$overall_success" '
        .summary = {
            "total_tests": $total,
            "passed_tests": $passed,
            "failed_tests": $failed,
            "success_rate": (($passed / $total) * 100 | floor),
            "overall_success": $success
        }
    ' "$summary_report" > "$temp_file" && mv "$temp_file" "$summary_report"
    
    # Generate HTML report
    generate_html_report "$summary_report" "$html_report"
    
    # Update trends
    update_trends_report "$trends_report" "$summary_report"
    
    log_success "Comprehensive report generated"
    
    if [[ "$overall_success" == "true" ]]; then
        return 0
    else
        return 1
    fi
}

# Generate HTML report
generate_html_report() {
    local summary_file="$1"
    local html_file="$2"
    
    local summary_data=$(cat "$summary_file")
    
    cat > "$html_file" << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OpenID Federation Conformance Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 8px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { border-bottom: 2px solid #e1e5e9; padding-bottom: 20px; margin-bottom: 30px; }
        .title { color: #2d3748; font-size: 2em; margin: 0; }
        .subtitle { color: #718096; margin: 5px 0 0 0; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .metric { background: #f7fafc; border-radius: 8px; padding: 20px; text-align: center; }
        .metric-value { font-size: 2em; font-weight: bold; margin-bottom: 5px; }
        .metric-label { color: #718096; font-size: 0.9em; }
        .passed { color: #38a169; }
        .failed { color: #e53e3e; }
        .profiles { margin-top: 30px; }
        .profile { border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 20px; overflow: hidden; }
        .profile-header { background: #edf2f7; padding: 15px; font-weight: bold; }
        .profile-content { padding: 15px; }
        .test { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #f7fafc; }
        .test:last-child { border-bottom: none; }
        .test-name { font-family: monospace; }
        .test-status { padding: 4px 8px; border-radius: 4px; font-size: 0.8em; font-weight: bold; }
        .status-passed { background: #c6f6d5; color: #2f855a; }
        .status-failed { background: #fed7d7; color: #c53030; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #718096; font-size: 0.9em; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 class="title">OpenID Federation Conformance Report</h1>
            <p class="subtitle">Generated on <span id="timestamp"></span> • Version <span id="version"></span></p>
        </div>
        
        <div class="summary">
            <div class="metric">
                <div class="metric-value" id="total-tests">-</div>
                <div class="metric-label">Total Tests</div>
            </div>
            <div class="metric">
                <div class="metric-value passed" id="passed-tests">-</div>
                <div class="metric-label">Passed</div>
            </div>
            <div class="metric">
                <div class="metric-value failed" id="failed-tests">-</div>
                <div class="metric-label">Failed</div>
            </div>
            <div class="metric">
                <div class="metric-value" id="success-rate">-</div>
                <div class="metric-label">Success Rate</div>
            </div>
        </div>
        
        <div class="profiles" id="profiles">
            <!-- Profiles will be populated by JavaScript -->
        </div>
        
        <div class="footer">
            <p>Report generated by Enhanced Conformance Testing Suite • fedmgr v<span id="footer-version"></span></p>
        </div>
    </div>
    
    <script>
        const data = SUMMARY_DATA_PLACEHOLDER;
        
        // Populate summary
        document.getElementById('timestamp').textContent = new Date(data.timestamp).toLocaleString();
        document.getElementById('version').textContent = data.version;
        document.getElementById('footer-version').textContent = data.version;
        document.getElementById('total-tests').textContent = data.summary.total_tests;
        document.getElementById('passed-tests').textContent = data.summary.passed_tests;
        document.getElementById('failed-tests').textContent = data.summary.failed_tests;
        document.getElementById('success-rate').textContent = data.summary.success_rate + '%';
        
        // Populate profiles
        const profilesContainer = document.getElementById('profiles');
        data.profiles.forEach(profile => {
            const profileDiv = document.createElement('div');
            profileDiv.className = 'profile';
            
            const headerDiv = document.createElement('div');
            headerDiv.className = 'profile-header';
            headerDiv.textContent = `${profile.profile.toUpperCase()} Profile (${profile.passed_tests}/${profile.total_tests} passed)`;
            profileDiv.appendChild(headerDiv);
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'profile-content';
            
            profile.tests.forEach(test => {
                const testDiv = document.createElement('div');
                testDiv.className = 'test';
                
                const nameSpan = document.createElement('span');
                nameSpan.className = 'test-name';
                nameSpan.textContent = test.name;
                testDiv.appendChild(nameSpan);
                
                const statusSpan = document.createElement('span');
                statusSpan.className = `test-status status-${test.status}`;
                statusSpan.textContent = test.status.toUpperCase();
                testDiv.appendChild(statusSpan);
                
                contentDiv.appendChild(testDiv);
            });
            
            profileDiv.appendChild(contentDiv);
            profilesContainer.appendChild(profileDiv);
        });
    </script>
</body>
</html>
EOF

    # Replace placeholder with actual data
    sed -i "s/SUMMARY_DATA_PLACEHOLDER/$(echo "$summary_data" | jq -c .)/" "$html_file"
}

# Update trends report
update_trends_report() {
    local trends_file="$1"
    local summary_file="$2"
    
    if [[ ! -f "$trends_file" ]]; then
        echo '{"trends": []}' > "$trends_file"
    fi
    
    local summary_data=$(cat "$summary_file")
    local trend_entry=$(echo "$summary_data" | jq '{
        version: .version,
        timestamp: .timestamp,
        build_id: .build_id,
        total_tests: .summary.total_tests,
        passed_tests: .summary.passed_tests,
        failed_tests: .summary.failed_tests,
        success_rate: .summary.success_rate
    }')
    
    local temp_file=$(mktemp)
    jq --argjson entry "$trend_entry" '.trends += [$entry] | .trends = (.trends | sort_by(.timestamp))' \
       "$trends_file" > "$temp_file" && mv "$temp_file" "$trends_file"
}

# Perform regression analysis
analyze_regression() {
    log_info "Performing regression analysis..."
    
    local current_report="$REPORTS_DIR/summary.json"
    if [[ ! -f "$current_report" ]]; then
        log_error "Current report not found"
        return 1
    fi
    
    # Find previous version
    local prev_version=$(ls "$RESULTS_BASE_DIR" | grep -v "$VERSION" | sort -V | tail -n 1 || true)
    if [[ -z "$prev_version" ]]; then
        log_info "No previous version found for regression analysis"
        return 0
    fi
    
    local prev_report="$RESULTS_BASE_DIR/$prev_version/reports/summary.json"
    if [[ ! -f "$prev_report" ]]; then
        log_warn "Previous report not found: $prev_report"
        return 0
    fi
    
    log_info "Comparing with previous version: $prev_version"
    
    local current_failed=$(jq -r '.summary.failed_tests' "$current_report")
    local prev_failed=$(jq -r '.summary.failed_tests' "$prev_report")
    local current_rate=$(jq -r '.summary.success_rate' "$current_report")
    local prev_rate=$(jq -r '.summary.success_rate' "$prev_report")
    
    # Create regression report
    local regression_report="$REPORTS_DIR/regression.json"
    cat > "$regression_report" << EOF
{
    "current_version": "$VERSION",
    "previous_version": "$prev_version",
    "comparison": {
        "failed_tests": {
            "current": $current_failed,
            "previous": $prev_failed,
            "change": $((current_failed - prev_failed))
        },
        "success_rate": {
            "current": $current_rate,
            "previous": $prev_rate,
            "change": $((current_rate - prev_rate))
        }
    },
    "regression_detected": false,
    "analysis": "No regression detected"
}
EOF
    
    # Check for regression
    if [[ $current_failed -gt $prev_failed ]]; then
        local temp_file=$(mktemp)
        jq '.regression_detected = true | .analysis = "Regression detected: more test failures than previous version"' \
           "$regression_report" > "$temp_file" && mv "$temp_file" "$regression_report"
        
        log_error "Regression detected: $current_failed failures (was $prev_failed)"
        return 1
    elif [[ $current_rate -lt $((prev_rate - 5)) ]]; then
        local temp_file=$(mktemp)
        jq '.regression_detected = true | .analysis = "Regression detected: significant success rate decrease"' \
           "$regression_report" > "$temp_file" && mv "$temp_file" "$regression_report"
        
        log_error "Regression detected: success rate dropped from ${prev_rate}% to ${current_rate}%"
        return 1
    else
        log_success "No regression detected"
        return 0
    fi
}

# Create CI artifacts
create_ci_artifacts() {
    log_info "Creating CI artifacts..."
    
    # Create latest symlink
    ln -sfn "$VERSION" "$RESULTS_BASE_DIR/latest"
    
    # Create badge data for README
    local summary_file="$REPORTS_DIR/summary.json"
    if [[ -f "$summary_file" ]]; then
        local success_rate=$(jq -r '.summary.success_rate' "$summary_file")
        local badge_color="red"
        
        if [[ $success_rate -ge 95 ]]; then
            badge_color="brightgreen"
        elif [[ $success_rate -ge 80 ]]; then
            badge_color="yellow"
        elif [[ $success_rate -ge 60 ]]; then
            badge_color="orange"
        fi
        
        cat > "$ARTIFACTS_DIR/badge.json" << EOF
{
    "schemaVersion": 1,
    "label": "conformance",
    "message": "${success_rate}%",
    "color": "$badge_color"
}
EOF
    fi
    
    # Create JUnit XML for CI systems
    create_junit_xml
    
    log_success "CI artifacts created"
}

# Create JUnit XML report
create_junit_xml() {
    local junit_file="$ARTIFACTS_DIR/junit.xml"
    local summary_file="$REPORTS_DIR/summary.json"
    
    if [[ ! -f "$summary_file" ]]; then
        return 1
    fi
    
    cat > "$junit_file" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
EOF
    
    # Process each profile
    local profiles=$(jq -r '.profiles[].profile' "$summary_file")
    while IFS= read -r profile; do
        local profile_data=$(jq --arg profile "$profile" '.profiles[] | select(.profile == $profile)' "$summary_file")
        local total=$(echo "$profile_data" | jq -r '.total_tests')
        local failures=$(echo "$profile_data" | jq -r '.failed_tests')
        local time=$(echo "$profile_data" | jq -r '.execution_time')
        
        cat >> "$junit_file" << EOF
  <testsuite name="$profile" tests="$total" failures="$failures" time="$time">
EOF
        
        # Process each test
        echo "$profile_data" | jq -r '.tests[] | "\(.name)|\(.status)|\(.duration)"' | while IFS='|' read -r name status duration; do
            if [[ "$status" == "passed" ]]; then
                cat >> "$junit_file" << EOF
    <testcase name="$name" time="$duration"/>
EOF
            else
                cat >> "$junit_file" << EOF
    <testcase name="$name" time="$duration">
      <failure message="Test failed">Conformance test $name failed</failure>
    </testcase>
EOF
            fi
        done
        
        echo "  </testsuite>" >> "$junit_file"
    done
    
    echo "</testsuites>" >> "$junit_file"
}

# Cleanup function
cleanup() {
    log_info "Cleaning up..."
    stop_fedmgr_server
    
    # Remove temporary files
    find /tmp -name "conformance-*" -type f -mmin +60 -delete 2>/dev/null || true
    
    log_success "Cleanup completed"
}

# Main execution function
main() {
    print_banner
    
    log_info "Starting enhanced conformance testing"
    log_info "Version: $VERSION"
    log_info "Timestamp: $TIMESTAMP"
    log_info "Build ID: $BUILD_ID"
    log_info "Profiles: $PROFILES"
    
    # Setup trap for cleanup
    trap cleanup EXIT
    
    # Setup
    setup_directories || { log_error "Failed to setup directories"; exit 1; }
    check_prerequisites || { log_error "Prerequisites check failed"; exit 1; }
    
    local overall_success=true
    
    # Run tests for each profile
    for profile in $(echo "$PROFILES" | tr ',' ' '); do
        if ! run_profile_tests "$profile"; then
            overall_success=false
        fi
    done
    
    # Generate reports
    if ! generate_comprehensive_report; then
        overall_success=false
    fi
    
    # Regression analysis
    analyze_regression || overall_success=false
    
    # Create CI artifacts
    create_ci_artifacts
    
    # Final summary
    if [[ "$overall_success" == "true" ]]; then
        log_success "All conformance tests passed!"
        log_info "Results available at: $RESULTS_DIR"
        log_info "HTML report: $REPORTS_DIR/report.html"
        exit 0
    else
        log_error "Some conformance tests failed!"
        log_info "Results available at: $RESULTS_DIR"
        log_info "HTML report: $REPORTS_DIR/report.html"
        exit 1
    fi
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --profiles)
            PROFILES="$2"
            shift 2
            ;;
        --timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        --parallel)
            PARALLEL_TESTS="true"
            shift
            ;;
        --debug)
            DEBUG="true"
            shift
            ;;
        --help)
            cat << 'EOF'
Enhanced Conformance Testing Script

Usage: enhanced-conformance.sh [options]

Options:
  --profiles PROFILES    Comma-separated list of profiles to run (default: basic,advanced)
  --timeout TIMEOUT      Test timeout in seconds (default: 1800)
  --parallel             Run tests in parallel (default: false)
  --debug                Enable debug logging
  --help                 Show this help message

Examples:
  enhanced-conformance.sh --profiles basic,security --timeout 3600
  enhanced-conformance.sh --parallel --debug
EOF
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Run main function
main