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
    │   │   ├── mcp-server.test.js
    │   │   ├── token-exchange-service.test.js
    │   │   └── trust-chain-verification.test.js
    │   └── cli/                  # CLI component tests
    │       ├── auth-commands.test.js
    │       └── npx-execution.test.js
    ├── integration/              # Integration tests
    │   ├── mcp-federation.test.js
    │   ├── federation-endpoints.test.js
    │   └── federation-chain.test.js
    ├── e2e/                      # End-to-end tests
    │   ├── cli-federation-workflow.test.js   # CLI-driven E2E (workspace-isolated)
    │   └── federation-workflow.test.js       # Server-based E2E (requires live servers)
    ├── security/                 # Security tests
    │   └── token-validation.test.js
    └── fixtures/                 # Test fixtures and utilities
        ├── setup.js              # Jest setup file (sets FEDMGR_* env vars)
        ├── setup-test-data.js    # Federation test data helpers
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

## 5. Test Suite Status (as of 2026-03-16)

**Overall: 130 passing, 1 failing (pre-existing), 4 skipped, 3 todo — across 14 test suites**

| Suite | Tests | Status | Notes |
|---|---|---|---|
| `unit/trust-chain-verification` | 10 | ✅ Pass | Three-level chain, invalid sig/expiry/issuer |
| `unit/server/token-exchange-service` | 10 | ✅ Pass | JWT exchange, JWKS, error handling |
| `unit/cli/auth-commands` | 8+1 skip | ✅ Pass | OIDC login, token store; `githubOAuthLogin` skipped |
| `unit/cli/npx-execution` | 8 | ✅ Pass | CLI create/list/error handling |
| `unit/server/mcp-server` | 2+3 skip+3 todo | ✅ Pass | validateToken utility; init tests skipped |
| `integration/mcp-federation` | 6 | ✅ Pass | Entity statement fetch/validate/distribute |
| `integration/federation-endpoints` | 19 | ✅ Pass | HTTP endpoint conformance |
| `integration/federation-chain` | (all) | ✅ Pass | Trust chain integration |
| `e2e/cli-federation-workflow` | 12 | ✅ Pass | Full CLI workflow with workspace isolation |
| `e2e/federation-workflow` | 1 | ❌ Fail | Requires live servers on ports 9001-9003 |

### Known Failures

**`e2e/federation-workflow.test.js`** — pre-existing, requires actual HTTP servers to be running.
The test spawns `src/fedmgr/mcp-server.js` processes and waits for them to be ready on configured ports.
This test is intended for a fully deployed environment, not CI without server infrastructure.

## 6. Key Testing Conventions

### Mock Ordering (Jest without Babel)
`jest.mock()` calls MUST appear before any `require()` statements. Without Babel's hoisting transform,
modules load with real dependencies if `jest.mock` runs after `require`.

### E2E Workspace Isolation
CLI E2E tests use workspace-scoped env vars to avoid interfering with the real workspace:
```js
process.env.FEDMGR_HOME = '/path/to/test-workspace';
process.env.FEDMGR_FEDERATIONS_DIR = '/path/to/test-workspace/federations';
process.env.FEDMGR_FED_REG = '/path/to/test-workspace/data/fed-reg';
process.env.FEDMGR_FED_REG_FILE = '/path/to/test-workspace/data/fed-reg/registry.json';
```

### Trust Chain Key Convention
In OpenID Federation entity statements, each statement's `jwks` contains the **signer's** public key
for verifying the **previous link** in the chain. The verifier uses the JWKS from one statement to
verify the signature on the statement below it.