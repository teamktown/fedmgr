# `@letsfederate/mcp-core` Package Specification

This document specifies the structure, responsibilities, and API contracts for the `@letsfederate/mcp-core` NPM package. This package is responsible for the core functionality of the MCP (Message Control Point) server, handling fundamental federation protocol interactions and providing status/information endpoints.

## Package Structure and Responsibilities

The `@letsfederate/mcp-core` package will contain the following main modules:

1.  **`mcp-server.js`**:
    *   **Responsibility**: Initializes and manages the HTTP server for the MCP. Handles incoming requests and routes them to the appropriate handlers. Manages server lifecycle (start, stop).
    *   **Dependencies**: Depends on `api-handlers.js` for request processing.
    *   **Configuration**: Reads server configuration (port, host, etc.) from environment variables or a configuration module (no hard-coded values).
    *   **TDD Anchor**: Test server initialization and request routing.

2.  **`api-handlers.js`**:
    *   **Responsibility**: Contains the request handler functions for the specified API endpoints (`/whoami`, `/showtrust`, `/stats`, `/status`). These handlers will interact with core logic modules to fulfill requests.
    *   **Dependencies**: Depends on `core-logic.js` and potentially other modules for data retrieval and processing.
    *   **TDD Anchor**: Test each API handler function with various inputs and expected outputs, including error cases.

3.  **`core-logic.js`**:
    *   **Responsibility**: Implements the core business logic for the MCP, such as retrieving identity information, managing trust relationships, gathering statistics, and determining server status.
    *   **Dependencies**: May depend on data storage modules, certificate utilities, etc.
    *   **TDD Anchor**: Test individual logic functions for correctness and edge cases.

4.  **`config.js`**:
    *   **Responsibility**: Handles loading and validating configuration from environment variables. Provides a centralized access point for configuration values.
    *   **TDD Anchor**: Test configuration loading and validation with different environment variable settings.

## API Contracts

All API endpoints are expected to return JSON responses. Error responses should follow a consistent format, including an error code and a descriptive message.

### GET `/whoami`

*   **Description**: Returns information about the MCP instance's identity.
*   **Request**:
    *   **Method**: GET
    *   **Path**: `/whoami`
    *   **Headers**: (Optional) `Accept: application/json`
    *   **Body**: None
*   **Response**:
    *   **Success (200 OK)**:
        ```json
        {
          "id": "string", // Unique identifier for the MCP instance
          "publicKey": "string", // Public key or certificate identifier
          "endpoints": { // URLs for other relevant endpoints
            "showtrust": "string",
            "stats": "string",
            "status": "string"
            // ... other relevant endpoints
          }
        }
        ```
    *   **Error (4xx/5xx)**:
        ```json
        {
          "errorCode": "string", // Machine-readable error code
          "errorMessage": "string" // Human-readable error description
        }
        ```
*   **Error Handling**:
    *   `500 Internal Server Error`: Generic error if identity information cannot be retrieved.
*   **Environment Variables**:
    *   `MCP_ID`: Required. Unique identifier for the MCP instance.
    *   `MCP_PUBLIC_KEY`: Required. Public key or certificate identifier.
    *   `MCP_BASE_URL`: Required. Base URL for constructing endpoint URLs.
*   **TDD Anchor**: Test successful response, missing environment variables, and internal errors.

### GET `/showtrust`

*   **Description**: Returns the list of trusted federations or MCPs.
*   **Request**:
    *   **Method**: GET
    *   **Path**: `/showtrust`
    *   **Headers**: (Optional) `Accept: application/json`
    *   **Body**: None
*   **Response**:
    *   **Success (200 OK)**:
        ```json
        {
          "trusted": [
            {
              "id": "string", // Identifier of the trusted entity (fed or mcp)
              "type": "string", // Type of entity ("federation" or "mcp")
              "publicKey": "string", // Public key or certificate identifier
              "addedAt": "string" // Timestamp when trust was established (ISO 8601)
            }
            // ... more trusted entities
          ]
        }
        ```
    *   **Error (4xx/5xx)**:
        ```json
        {
          "errorCode": "string",
          "errorMessage": "string"
        }
        ```
*   **Error Handling**:
    *   `500 Internal Server Error`: Generic error if trust information cannot be retrieved.
*   **Environment Variables**:
    *   (None directly required by this endpoint, but underlying logic may depend on configuration for data storage paths, etc.)
*   **TDD Anchor**: Test successful response with empty and non-empty trust lists, and internal errors.

### GET `/stats`

*   **Description**: Returns operational statistics for the MCP instance.
*   **Request**:
    *   **Method**: GET
    *   **Path**: `/stats`
    *   **Headers**: (Optional) `Accept: application/json`
    *   **Body**: None
*   **Response**:
    *   **Success (200 OK)**:
        ```json
        {
          "messageCount": { // Statistics on message processing
            "received": 0,
            "sent": 0,
            "processed": 0,
            "errors": 0
          },
          "federationCount": 0, // Number of active federations
          "trustedMcpCount": 0, // Number of trusted MCPs
          "uptimeSeconds": 0 // Server uptime in seconds
          // ... other relevant statistics
        }
        ```
    *   **Error (4xx/5xx)**:
        ```json
        {
          "errorCode": "string",
          "errorMessage": "string"
        }
        ```
*   **Error Handling**:
    *   `500 Internal Server Error`: Generic error if statistics cannot be retrieved.
*   **Environment Variables**:
    *   (None directly required by this endpoint, but underlying logic may depend on configuration for data storage paths, etc.)
*   **TDD Anchor**: Test successful response with various statistics values, and internal errors.

### GET `/status`

*   **Description**: Returns the current operational status of the MCP instance.
*   **Request**:
    *   **Method**: GET
    *   **Path**: `/status`
    *   **Headers**: (Optional) `Accept: application/json`
    *   **Body**: None
*   **Response**:
    *   **Success (200 OK)**:
        ```json
        {
          "status": "string", // Overall status ("ok", "degraded", "down")
          "details": { // Optional details about the status
            "database": "ok", // Status of database connection
            "federationConnections": "degraded", // Status of federation connections
            "messageQueue": "ok" // Status of message queue
            // ... other relevant system components
          },
          "lastChecked": "string" // Timestamp of the last status check (ISO 8601)
        }
        ```
    *   **Error (4xx/5xx)**:
        ```json
        {
          "errorCode": "string",
          "errorMessage": "string"
        }
        ```
*   **Error Handling**:
    *   `500 Internal Server Error`: Generic error if status cannot be determined.
*   **Environment Variables**:
    *   (None directly required by this endpoint, but underlying logic may depend on configuration for checking external dependencies.)
*   **TDD Anchor**: Test successful response for different status states ("ok", "degraded", "down"), and internal errors.

## Environment Variables

The `@letsfederate/mcp-core` package will rely on environment variables for configuration. A dedicated configuration module (`config.js`) will be responsible for reading and validating these variables.

*   `MCP_PORT`: The port the MCP server should listen on. (Required)
*   `MCP_HOST`: The host the MCP server should bind to. (Optional, defaults to `0.0.0.0`)
*   `MCP_ID`: The unique identifier for this MCP instance. (Required)
*   `MCP_PUBLIC_KEY`: The public key or certificate identifier for this MCP instance. (Required)
*   `MCP_BASE_URL`: The base URL for this MCP instance, used for constructing endpoint URLs in the `/whoami` response. (Required)
*   `TRUST_STORE_PATH`: Path to the file or directory storing trusted entities. (Required by core logic)
*   `STATS_STORAGE_PATH`: Path to the file or directory storing statistics data. (Required by core logic)
*   (Other environment variables may be required for database connections, logging configuration, etc., depending on implementation details.)

No secrets or configuration values will be hard-coded within the application logic.

## TDD Anchors Summary

*   Test server initialization and request routing (`mcp-server.js`).
*   Test each API handler function (`api-handlers.js`).
*   Test core logic functions (`core-logic.js`).
*   Test configuration loading and validation (`config.js`).
*   Test API responses for success and various error conditions.
*   Test handling of missing or invalid environment variables.