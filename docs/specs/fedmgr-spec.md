# `@letsfederate/fedmgr` Package Specification

This document specifies the structure, responsibilities, and CLI command interfaces for the `@letsfederate/fedmgr` NPM package. This package provides command-line tools for bootstrapping federations and managing configuration for MCP instances.

## Package Structure and Responsibilities

The `@letsfederate/fedmgr` package will contain the following main modules:

1.  **`cli.js`**:
    *   **Responsibility**: Entry point for the `fedmgr` CLI. Parses command-line arguments and dispatches to the appropriate command handler. Uses a library like `commander` or `yargs` for argument parsing.
    *   **Dependencies**: Depends on individual command handler modules (e.g., `create-command.js`, `delete-command.js`, `help-command.js`).
    *   **TDD Anchor**: Test argument parsing and command dispatching for various valid and invalid inputs.

2.  **`create-command.js`**:
    *   **Responsibility**: Handles the `fedmgr create` command. Contains sub-handlers for creating federations, operators, and MCP configurations. Interacts with configuration and bootstrapping logic modules.
    *   **Dependencies**: Depends on `config-manager.js`, `bootstrap-logic.js`.
    *   **TDD Anchor**: Test the `create` command with different sub-commands and arguments, including missing required arguments and invalid values.

3.  **`delete-command.js`**:
    *   **Responsibility**: Handles the `fedmgr delete` command. Contains sub-handlers for deleting federations. Interacts with configuration management modules.
    *   **Dependencies**: Depends on `config-manager.js`.
    *   **TDD Anchor**: Test the `delete` command with different sub-commands and arguments, including non-existent entities and confirmation prompts.

4.  **`help-command.js`**:
    *   **Responsibility**: Handles the `fedmgr help` command and displays usage information for the CLI and individual commands.
    *   **TDD Anchor**: Test that the help output is correctly formatted and includes information for all commands.

5.  **`config-manager.js`**:
    *   **Responsibility**: Manages the `fedmgr` configuration, including reading and writing federation and MCP configuration files. Handles file paths and data persistence.
    *   **Dependencies**: Node.js `fs` module, potentially a configuration file parsing library.
    *   **Configuration**: Reads configuration file paths from environment variables.
    *   **TDD Anchor**: Test reading, writing, and manipulating configuration data, including handling non-existent files and invalid data formats.

6.  **`bootstrap-logic.js`**:
    *   **Responsibility**: Contains the logic for bootstrapping new federations, generating keys, and setting up initial configurations.
    *   **Dependencies**: May depend on cryptographic libraries, `config-manager.js`.
    *   **TDD Anchor**: Test the bootstrapping process, including key generation and initial configuration setup.

## CLI Command Interfaces

All CLI commands should provide clear output to the user, indicating success, failure, or required actions. Error messages should be informative.

### `fedmgr create fed <name>`

*   **Description**: Creates a new federation configuration.
*   **Usage**: `fedmgr create fed <name> [options]`
*   **Arguments**:
    *   `<name>`: The unique name for the new federation. (Required)
*   **Options**:
    *   `--key-type <type>`: The type of cryptographic key to generate (e.g., "rsa", "ed25519"). Defaults to "ed25519".
    *   `--key-size <size>`: The size of the key (for RSA). Defaults to 2048.
    *   `--output-dir <dir>`: Directory to save the federation configuration files. Defaults to a standard location (e.g., `./federations/<name>`).
*   **Input**: Command-line arguments. May prompt for confirmation if the federation name already exists.
*   **Output**:
    *   Success: Prints a confirmation message indicating the federation was created and the location of the configuration files.
    *   Error: Prints an error message to stderr.
*   **Error Handling**:
    *   Missing required argument `<name>`.
    *   Federation with the same name already exists (may prompt for overwrite).
    *   Invalid option values (e.g., unsupported key type).
    *   File system errors during configuration file creation.
*   **Environment Variables**:
    *   `FEDMGR_FEDERATIONS_DIR`: Optional. Overrides the default directory for storing federation configurations.
*   **TDD Anchor**: Test successful creation, missing name, existing name (with and without overwrite), invalid options, and file system errors.

### `fedmgr create op <name>`

*   **Description**: Creates a new operator configuration within a specified federation.
*   **Usage**: `fedmgr create op <name> --federation <fed_name> [options]`
*   **Arguments**:
    *   `<name>`: The unique name for the new operator. (Required)
*   **Options**:
    *   `--federation <fed_name>`: The name of the federation the operator belongs to. (Required)
    *   `--key-type <type>`: The type of cryptographic key to generate (e.g., "rsa", "ed25519"). Defaults to "ed25519".
    *   `--key-size <size>`: The size of the key (for RSA). Defaults to 2048.
*   **Input**: Command-line arguments. May prompt for confirmation if the operator name already exists within the federation.
*   **Output**:
    *   Success: Prints a confirmation message indicating the operator was created and updated the federation configuration.
    *   Error: Prints an error message to stderr.
*   **Error Handling**:
    *   Missing required argument `<name>` or option `--federation`.
    *   Federation specified by `--federation` does not exist.
    *   Operator with the same name already exists within the federation (may prompt for overwrite).
    *   Invalid option values.
    *   File system errors during configuration file updates.
*   **Environment Variables**:
    *   `FEDMGR_FEDERATIONS_DIR`: Optional. Overrides the default directory for storing federation configurations.
*   **TDD Anchor**: Test successful creation, missing arguments/options, non-existent federation, existing operator, invalid options, and file system errors.

### `fedmgr create mcp <name>`

*   **Description**: Creates a new MCP configuration.
*   **Usage**: `fedmgr create mcp <name> [options]`
*   **Arguments**:
    *   `<name>`: The unique name for the new MCP configuration. (Required)
*   **Options**:
    *   `--output-dir <dir>`: Directory to save the MCP configuration file. Defaults to a standard location (e.g., `./mcp_instances/<name>`).
*   **Input**: Command-line arguments. May prompt for confirmation if the MCP name already exists.
*   **Output**:
    *   Success: Prints a confirmation message indicating the MCP configuration was created and the location of the configuration file.
    *   Error: Prints an error message to stderr.
*   **Error Handling**:
    *   Missing required argument `<name>`.
    *   MCP configuration with the same name already exists (may prompt for overwrite).
    *   File system errors during configuration file creation.
*   **Environment Variables**:
    *   `FEDMGR_MCP_INSTANCES_DIR`: Optional. Overrides the default directory for storing MCP configurations.
*   **TDD Anchor**: Test successful creation, missing name, existing name (with and without overwrite), and file system errors.

### `fedmgr delete fed <name>`

*   **Description**: Deletes an existing federation configuration.
*   **Usage**: `fedmgr delete fed <name>`
*   **Arguments**:
    *   `<name>`: The name of the federation to delete. (Required)
*   **Input**: Command-line argument. May prompt for confirmation before deleting.
*   **Output**:
    *   Success: Prints a confirmation message indicating the federation was deleted.
    *   Error: Prints an error message to stderr.
*   **Error Handling**:
    *   Missing required argument `<name>`.
    *   Federation with the specified name does not exist.
    *   File system errors during configuration file deletion.
*   **Environment Variables**:
    *   `FEDMGR_FEDERATIONS_DIR`: Optional. Overrides the default directory for storing federation configurations.
*   **TDD Anchor**: Test successful deletion, missing name, non-existent federation, and file system errors.

### `fedmgr help`

*   **Description**: Displays help information for the `fedmgr` CLI.
*   **Usage**: `fedmgr help [command]`
*   **Arguments**:
    *   `[command]`: Optional. The name of a specific command to get help for (e.g., `create`, `delete`).
*   **Input**: Command-line arguments.
*   **Output**:
    *   If no command is specified, prints general usage and a list of available commands.
    *   If a command is specified, prints detailed help for that command, including arguments, options, and examples.
    *   Error: If the specified command does not exist, prints an error message.
*   **Error Handling**:
    *   Specified command does not exist.
*   **TDD Anchor**: Test general help output, help output for specific commands, and help for a non-existent command.

## Environment Variables

The `@letsfederate/fedmgr` package will rely on environment variables for configuring default paths.

*   `FEDMGR_FEDERATIONS_DIR`: Optional. Specifies the base directory for storing federation configurations. Defaults to `./federations`.
*   `FEDMGR_MCP_INSTANCES_DIR`: Optional. Specifies the base directory for storing MCP instance configurations. Defaults to `./mcp_instances`.

No secrets or configuration values will be hard-coded within the application logic.

## TDD Anchors Summary

*   Test CLI argument parsing and command dispatching (`cli.js`).
*   Test the `create` command with its sub-commands and various inputs (`create-command.js`).
*   Test the `delete` command with its sub-commands and various inputs (`delete-command.js`).
*   Test the `help` command output (`help-command.js`).
*   Test configuration file management (reading, writing, deleting) and error handling (`config-manager.js`).
*   Test the federation bootstrapping logic, including key generation (`bootstrap-logic.js`).
*   Test handling of missing or invalid environment variables for configuration paths.