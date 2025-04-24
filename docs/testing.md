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

### 4.4 Command-Line Options

The `run_tests.sh` script supports various command-line options:

```bash
./scripts/run_tests.sh [options]

Options:
  --no-unit             Skip unit tests
  --no-integration      Skip integration tests
  --no-e2e              Skip end-to-end tests
  --no-security         Skip security tests
  --with-performance    Include performance tests
  --only-unit           Run only unit tests
  --only-integration    Run only integration tests
  --only-e2e            Run only end-to-end tests
  --only-security       Run only security tests
  --help                Show this help message
```

## 5. Test Reporting

Test results are stored in the `test-results` directory, including:

- JSON reports for each test category
- JUnit XML reports for CI/CD integration
- Coverage reports (when running with `--with-coverage`)

## 6. Writing Tests

### 6.1 Unit Tests

Unit tests should follow these guidelines:

- Each test file should focus on a single component
- Use descriptive test names that explain what is being tested
- Use the `TestLogger` utility for structured logging
- Mock external dependencies using Jest mocks or Sinon
- Test both success and failure cases

Example:

```javascript
describe('MCP Server', () => {
  describe('Server Initialization', () => {
    test('should initialize correctly with valid configuration', () => {
      // Test code here
    });
  });
});
```

### 6.2 Integration Tests

Integration tests should follow these guidelines:

- Focus on interactions between components
- Set up test fixtures that represent realistic data
- Clean up after tests to maintain isolation
- Test error handling across component boundaries

### 6.3 End-to-End Tests

End-to-end tests should follow these guidelines:

- Test complete user workflows from start to finish
- Use real instances of components when possible
- Handle asynchronous operations properly
- Include proper cleanup to avoid affecting other tests

### 6.4 Security Tests

Security tests should follow these guidelines:

- Test for specific security vulnerabilities
- Include both positive and negative test cases
- Test boundary conditions and edge cases
- Verify proper handling of malformed inputs

## 7. Continuous Integration

The test suite is designed to be run in a CI/CD environment. The test runner provides proper exit codes (0 for success, 1 for failure) and generates reports that can be consumed by CI/CD systems.

## 8. Troubleshooting

### 8.1 Common Issues

- **Tests failing due to port conflicts**: Some tests start servers on specific ports. If these ports are already in use, the tests will fail. Ensure no other processes are using the required ports.
- **Tests timing out**: End-to-end tests may time out if the system is under heavy load. Try increasing the timeout value in the Jest configuration.
- **Tests failing due to missing dependencies**: Ensure all dependencies are installed by running `npm install`.

### 8.2 Debugging Tests

To debug tests:

1. Add `console.log` statements to the test code
2. Run the specific test with increased verbosity:
   ```bash
   TEST_VERBOSE=true npm run test:unit -- --testNamePattern="specific test name"
   ```
3. Check the test logs in the `test-results` directory

## 9. Future Improvements

Planned improvements to the testing infrastructure include:

- Adding performance tests
- Implementing visual regression testing for the web interface
- Adding more comprehensive security tests
- Implementing property-based testing for complex components