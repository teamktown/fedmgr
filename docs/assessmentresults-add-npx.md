# Specification for NPX Compatibility in `@letsfederate/fedmgr`

## Introduction

This document outlines the necessary steps and modifications to enable the `@letsfederate/fedmgr` package to be executed using `npx`. The primary goal is to allow users to run the `fedmgr` command-line interface without requiring a global installation, simplifying usage and avoiding potential version conflicts.

## 1. Package Modifications (`@letsfederate/fedmgr`)

The core of enabling NPX compatibility lies in correctly configuring the package that provides the CLI.

*   **CLI Entry Point:** The main script for the `fedmgr` CLI is located at `src/fedmgr.js`.
*   **Shebang:** Ensure that `src/fedmgr.js` includes the appropriate shebang line at the very beginning to indicate that it should be executed using Node.js:
    ```javascript
    #!/usr/bin/env node
    ```
*   **Executable Permissions:** The file `src/fedmgr.js` (or its compiled output) must have executable permissions. This is typically handled automatically by npm/npx when the `bin` field is configured, but it's a necessary underlying requirement.

## 2. `package.json` Modifications

The `package.json` file for the `@letsfederate/fedmgr` package needs to declare the executable command.

*   **Target File:** The `package.json` to modify is likely located at `src/fedmgr/package.json`.
*   **`bin` Field:** Add or modify the `bin` field to map the desired command name (`fedmgr`) to the executable file. Assuming the build process outputs the CLI script to `./dist/src/fedmgr.js` relative to the package root, the `bin` field should look like this:

    ```json
    {
      "name": "@letsfederate/fedmgr",
      "version": "...",
      "bin": {
        "fedmgr": "./dist/cli/fedmgr.js"
      }
    }
    ```
    *Note: Verify the exact output path of the compiled CLI script after the build process (`scripts/build-npm.sh`) and adjust `./dist/cli/fedmgr.js` if necessary.*

## 3. CLI Adjustments

The existing `fedmgr` CLI (`src/cli/fedmgr.js`) is built using Commander.js, which is well-suited for command-line execution.

*   **Standalone Execution:** The CLI should be designed to run standalone, without relying on a specific current working directory relative to the package source. It should use paths relative to where it is executed or absolute paths where necessary (e.g., when interacting with user-specified directories for federations or MCP instances). Commander.js handles argument parsing, so no significant changes are expected here unless the CLI currently makes assumptions about its execution environment that would be broken by `npx`.
*   **Configuration Loading:** If the CLI loads configuration files, ensure it uses robust methods to locate them (e.g., based on command-line arguments, environment variables, or searching standard locations) rather than relying on relative paths from the package source directory.

## 4. Documentation Updates

Documentation should be updated to guide users on using `npx` and clarify its role.

*   **Target Files:** Update relevant documentation files, including:
    *   `README.md`
    *   `docs/fedmgr-quickstart.md`
    *   Potentially other guides or examples.
*   **Add NPX Examples:** Introduce examples demonstrating how to use `npx @letsfederate/fedmgr` for common tasks:
    ```bash
    npx @letsfederate/fedmgr create fed my-federation
    npx @letsfederate/fedmgr create mcp my-mcp --federation my-federation
    npx @letsfederate/fedmgr list federations
    ```
*   **Explain Benefits:** Clearly explain the advantage of using `npx` (no global installation required).
*   **Clarify Roles:** Reiterate the distinction between using `npx` for executing the `fedmgr` CLI (management and bootstrapping) and using shell scripts (like `scripts/setup.sh`) or Docker Compose for environment orchestration and running the MCP servers.

## 5. Test Cases

Existing tests should be reviewed, and new tests should be added to verify NPX functionality.

*   **Review Existing Tests:** Examine existing end-to-end tests (e.g., in `scripts/tests/e2e/`) that might currently execute the CLI using `npm run cli` or a direct path to the built binary. Consider modifying these tests to use `npx @letsfederate/fedmgr` to ensure the NPX execution path is covered.
*   **Add New NPX-Specific Tests:** Create new test cases specifically designed to be run via `npx`. These tests should:
    *   **Scenario 1: Basic Execution:** Verify that `npx @letsfederate/fedmgr --help` runs successfully and outputs the expected help text.
        *   *TDD Anchor:* Test should assert the exit code is 0 and the output contains key help text elements.
    *   **Scenario 2: Command Execution:** Test specific `fedmgr` commands executed via `npx`, such as creating a federation or an MCP instance.
        *   *TDD Anchor:* Test should execute `npx @letsfederate/fedmgr create fed test-npx-fed` and verify that the corresponding directory and configuration files are created in the expected location (`federations/test-npx-fed/`).
        *   *TDD Anchor:* Test should execute `npx @letsfederate/fedmgr create mcp test-npx-mcp --federation test-npx-fed` and verify the creation of the MCP instance files (`mcp_instances/test-npx-mcp/`).
    *   **Scenario 3: Error Handling:** Test how the CLI behaves when executed via `npx` with invalid arguments or in scenarios where it should fail gracefully.
        *   *TDD Anchor:* Test should execute `npx @letsfederate/fedmgr non-existent-command` and assert a non-zero exit code and the presence of an error message in the output.

These tests should be integrated into the existing test suite and run as part of the CI/CD process to ensure ongoing NPX compatibility.