#!/bin/bash

# run_tests.sh - Test runner for fedmgr
# 
# This script runs all tests for the fedmgr project, including:
# - Unit tests
# - Integration tests
# - End-to-end tests
# - Security tests
#
# Features:
# - Color-coded output for better readability
# - Clear error reporting
# - Proper exit codes for CI/CD integration
# - Configurable test categories

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Test categories
UNIT_TESTS=true
INTEGRATION_TESTS=true
E2E_TESTS=true
SECURITY_TESTS=true
PERFORMANCE_TESTS=false # Disabled by default as they can take longer

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --no-unit)
      UNIT_TESTS=false
      shift
      ;;
    --no-integration)
      INTEGRATION_TESTS=false
      shift
      ;;
    --no-e2e)
      E2E_TESTS=false
      shift
      ;;
    --no-security)
      SECURITY_TESTS=false
      shift
      ;;
    --with-performance)
      PERFORMANCE_TESTS=true
      shift
      ;;
    --only-unit)
      INTEGRATION_TESTS=false
      E2E_TESTS=false
      SECURITY_TESTS=false
      PERFORMANCE_TESTS=false
      shift
      ;;
    --only-integration)
      UNIT_TESTS=false
      E2E_TESTS=false
      SECURITY_TESTS=false
      PERFORMANCE_TESTS=false
      shift
      ;;
    --only-e2e)
      UNIT_TESTS=false
      INTEGRATION_TESTS=false
      SECURITY_TESTS=false
      PERFORMANCE_TESTS=false
      shift
      ;;
    --only-security)
      UNIT_TESTS=false
      INTEGRATION_TESTS=false
      E2E_TESTS=false
      PERFORMANCE_TESTS=false
      shift
      ;;
    --help)
      echo "Usage: $0 [options]"
      echo "Options:"
      echo "  --no-unit             Skip unit tests"
      echo "  --no-integration      Skip integration tests"
      echo "  --no-e2e              Skip end-to-end tests"
      echo "  --no-security         Skip security tests"
      echo "  --with-performance    Include performance tests"
      echo "  --only-unit           Run only unit tests"
      echo "  --only-integration    Run only integration tests"
      echo "  --only-e2e            Run only end-to-end tests"
      echo "  --only-security       Run only security tests"
      echo "  --help                Show this help message"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Initialize variables
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
SKIPPED_TESTS=0
EXIT_CODE=0

# Function to print section header
print_header() {
  echo -e "\n${BLUE}======================================${NC}"
  echo -e "${BLUE}= $1${NC}"
  echo -e "${BLUE}======================================${NC}\n"
}

# Function to run a test and track results
run_test() {
  local test_command=$1
  local test_name=$2
  local test_category=$3
  
  echo -e "${CYAN}Running $test_name...${NC}"
  
  # Run the test command and capture output and exit code
  OUTPUT=$(eval $test_command 2>&1)
  local TEST_EXIT_CODE=$?
  
  # Increment total tests
  TOTAL_TESTS=$((TOTAL_TESTS + 1))
  
  # Check if test passed or failed
  if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✓ $test_name passed${NC}"
    PASSED_TESTS=$((PASSED_TESTS + 1))
  else
    echo -e "${RED}✗ $test_name failed${NC}"
    echo -e "${RED}Error output:${NC}"
    echo "$OUTPUT" | sed 's/^/  /'
    FAILED_TESTS=$((FAILED_TESTS + 1))
    EXIT_CODE=1
  fi
  
  # Return the test exit code
  return $TEST_EXIT_CODE
}

# Function to check if required tools are installed
check_dependencies() {
  local missing_deps=false
  
  # Check for Node.js
  if ! command -v node &> /dev/null; then
    echo -e "${RED}Node.js is not installed${NC}"
    missing_deps=true
  fi
  
  # Check for npm
  if ! command -v npm &> /dev/null; then
    echo -e "${RED}npm is not installed${NC}"
    missing_deps=true
  fi
  
  # Exit if any dependencies are missing
  if [ "$missing_deps" = true ]; then
    echo -e "${RED}Please install missing dependencies and try again${NC}"
    exit 1
  fi
}

# Check if we're in the project root directory
if [ ! -f "package.json" ]; then
  echo -e "${RED}Error: This script must be run from the project root directory${NC}"
  echo -e "${YELLOW}Try: cd /path/to/fedmgr && ./scripts/run_tests.sh${NC}"
  exit 1
fi

# Check dependencies
check_dependencies

# Print test run information
echo -e "${MAGENTA}Starting test run at $(date)${NC}"
echo -e "${MAGENTA}Node version: $(node -v)${NC}"
echo -e "${MAGENTA}npm version: $(npm -v)${NC}"

# Create test results directory
RESULTS_DIR="./test-results"
mkdir -p $RESULTS_DIR

# Run unit tests
if [ "$UNIT_TESTS" = true ]; then
  print_header "UNIT TESTS"
  
  if [ -f "node_modules/.bin/jest" ]; then
    run_test "npx jest --config=jest.config.js --testMatch='**/scripts/tests/unit/**/*.test.js' --json --outputFile=$RESULTS_DIR/unit-results.json" "Unit Tests" "unit"
    UNIT_EXIT_CODE=$?
  else
    echo -e "${YELLOW}Jest not found. Installing test dependencies...${NC}"
    npm install --no-save jest chai sinon
    run_test "npx jest --config=jest.config.js --testMatch='**/scripts/tests/unit/**/*.test.js' --json --outputFile=$RESULTS_DIR/unit-results.json" "Unit Tests" "unit"
    UNIT_EXIT_CODE=$?
  fi
else
  echo -e "${YELLOW}Skipping unit tests${NC}"
  SKIPPED_TESTS=$((SKIPPED_TESTS + 1))
fi

# Run integration tests
if [ "$INTEGRATION_TESTS" = true ]; then
  print_header "INTEGRATION TESTS"
  
  if [ -f "node_modules/.bin/jest" ]; then
    run_test "npx jest --config=jest.config.js --testMatch='**/scripts/tests/integration/**/*.test.js' --json --outputFile=$RESULTS_DIR/integration-results.json" "Integration Tests" "integration"
    INTEGRATION_EXIT_CODE=$?
  else
    echo -e "${YELLOW}Jest not found. Installing test dependencies...${NC}"
    npm install --no-save jest chai sinon
    run_test "npx jest --config=jest.config.js --testMatch='**/scripts/tests/integration/**/*.test.js' --json --outputFile=$RESULTS_DIR/integration-results.json" "Integration Tests" "integration"
    INTEGRATION_EXIT_CODE=$?
  fi
else
  echo -e "${YELLOW}Skipping integration tests${NC}"
  SKIPPED_TESTS=$((SKIPPED_TESTS + 1))
fi

# Run end-to-end tests
if [ "$E2E_TESTS" = true ]; then
  print_header "END-TO-END TESTS"
  
  if [ -f "node_modules/.bin/jest" ]; then
    run_test "npx jest --config=jest.config.js --testMatch='**/scripts/tests/e2e/**/*.test.js' --json --outputFile=$RESULTS_DIR/e2e-results.json" "End-to-End Tests" "e2e"
    E2E_EXIT_CODE=$?
  else
    echo -e "${YELLOW}Jest not found. Installing test dependencies...${NC}"
    npm install --no-save jest chai sinon
    run_test "npx jest --config=jest.config.js --testMatch='**/scripts/tests/e2e/**/*.test.js' --json --outputFile=$RESULTS_DIR/e2e-results.json" "End-to-End Tests" "e2e"
    E2E_EXIT_CODE=$?
  fi
else
  echo -e "${YELLOW}Skipping end-to-end tests${NC}"
  SKIPPED_TESTS=$((SKIPPED_TESTS + 1))
fi

# Run security tests
if [ "$SECURITY_TESTS" = true ]; then
  print_header "SECURITY TESTS"
  
  if [ -f "node_modules/.bin/jest" ]; then
    run_test "npx jest --config=jest.config.js --testMatch='**/scripts/tests/security/**/*.test.js' --json --outputFile=$RESULTS_DIR/security-results.json" "Security Tests" "security"
    SECURITY_EXIT_CODE=$?
  else
    echo -e "${YELLOW}Jest not found. Installing test dependencies...${NC}"
    npm install --no-save jest chai sinon
    run_test "npx jest --config=jest.config.js --testMatch='**/scripts/tests/security/**/*.test.js' --json --outputFile=$RESULTS_DIR/security-results.json" "Security Tests" "security"
    SECURITY_EXIT_CODE=$?
  fi
else
  echo -e "${YELLOW}Skipping security tests${NC}"
  SKIPPED_TESTS=$((SKIPPED_TESTS + 1))
fi

# Run performance tests
if [ "$PERFORMANCE_TESTS" = true ]; then
  print_header "PERFORMANCE TESTS"
  
  if [ -f "node_modules/.bin/jest" ]; then
    run_test "npx jest --config=jest.config.js --testMatch='**/scripts/tests/performance/**/*.test.js' --json --outputFile=$RESULTS_DIR/performance-results.json" "Performance Tests" "performance"
    PERFORMANCE_EXIT_CODE=$?
  else
    echo -e "${YELLOW}Jest not found. Installing test dependencies...${NC}"
    npm install --no-save jest chai sinon
    run_test "npx jest --config=jest.config.js --testMatch='**/scripts/tests/performance/**/*.test.js' --json --outputFile=$RESULTS_DIR/performance-results.json" "Performance Tests" "performance"
    PERFORMANCE_EXIT_CODE=$?
  fi
else
  echo -e "${YELLOW}Skipping performance tests${NC}"
  SKIPPED_TESTS=$((SKIPPED_TESTS + 1))
fi

# Print summary
print_header "TEST SUMMARY"
echo -e "${MAGENTA}Total tests:   ${TOTAL_TESTS}${NC}"
echo -e "${GREEN}Passed tests:  ${PASSED_TESTS}${NC}"
echo -e "${RED}Failed tests:  ${FAILED_TESTS}${NC}"
echo -e "${YELLOW}Skipped tests: ${SKIPPED_TESTS}${NC}"

# Print final status
if [ $EXIT_CODE -eq 0 ]; then
  echo -e "\n${GREEN}✓ All tests passed!${NC}"
else
  echo -e "\n${RED}✗ Some tests failed!${NC}"
fi

# Exit with appropriate code
exit $EXIT_CODE