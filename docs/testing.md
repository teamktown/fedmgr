# Testing Documentation for fedmgr

This document describes the testing infrastructure and approach for the fedmgr project.

## 1. Testing Philosophy and Approach

The fedmgr project follows a test-driven development (TDD) approach with the following core principles:

- **Test-First Development**: Tests are written before implementing functionality to ensure requirements are clearly understood and testable.
- **Defensive Coding**: Inputs are assumed to be potentially malicious or malformed; boundary conditions and error handling are tested extensively.
- **Comprehensive Coverage**: High test coverage is maintained across all components, with special focus on security-critical paths.
- **Isolation**: Tests are independent and do not rely on state from previous tests.
- **Determinism**: Tests produce the same results when run repeatedly under the same conditions.
- **Continuous Testing**: Tests are integrated into the CI/CD pipeline and run automatically on code changes.

## 2. Test Categories

### 2.1 Unit Tests

Unit tests focus on testing individual components in isolation, with dependencies mocked or stubbed.

**Key Characteristics:**
- Fast execution (milliseconds)
- No external dependencies (database, network, etc.)
- Test one function or method at a time
- Use mocks and stubs for dependencies

**Tools:**
- Jest for test framework
- Sinon for mocks and stubs
- Chai for assertions

### 2.2 Integration Tests

Integration tests verify that different components work together correctly.

**Key Characteristics:**
- Test interactions between multiple components
- May involve some external dependencies (in-memory databases, etc.)
- Focus on API contracts and data flow between components
- Verify correct handling of edge cases across component boundaries

**Tools:**
- Supertest for HTTP API testing
- Mock WebSocket clients

### 2.3 End-to-End Tests

End-to-end tests verify the entire system works correctly from a user's perspective.

**Key Characteristics:**
- Test complete user workflows
- Use real external dependencies (actual database, network, etc.)
- Slower execution (seconds to minutes)
- Focus on system behavior as a whole

**Tools:**
- Child process spawning for testing CLI commands
- Real HTTP requests to test API endpoints

### 2.4 Security Tests

Security tests focus on identifying vulnerabilities and ensuring secure operation.

**Key Characteristics:**
- Test for common vulnerabilities (injection, XSS, CSRF, etc.)
- Verify proper authentication and authorization
- Check for secure handling of sensitive data
- Test token validation and trust chain verification

**Tools:**
- Crypto libraries for testing JWT validation
- Custom security test suites

## 3. Test Directory Structure

```
scripts/
├── run_tests.sh                  # Main test runner script
└── tests/
    ├── unit/                     # Unit tests
    │   ├── server/               # Server component tests
    │   │   └── mcp-server.test.js
    │   └── cli/                  # CLI component tests
    ├── integration/              # Integration tests
    │   └── mcp-federation.test.js
    ├── e2e/                      # End-to-end tests
    │   └── federation-workflow.test.js
    ├── security/                 # Security tests
    │   └── token-validation.test.js
    └── fixtures/                 # Test fixtures and utilities
        ├── setup.js              # Jest setup file
        └── test-logger.js        # Test logging utility
```

## 4. Running Tests

### 4.1 Prerequisites

Before running tests, ensure you have the required dependencies installed:

```bash
npm install
```

### 4.2 Running All Tests

To run all tests:

```bash
npm test
```

This will execute the `scripts/run_tests.sh` script, which runs all test categories.

### 4.3 Running Specific Test Categories

To run specific test categories:

```bash
# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration

# Run only end-to-end tests
npm run test:e2e

# Run only security tests
npm run test:security

# Run tests with coverage report
npm run test:coverage
```
June 24, to be refined