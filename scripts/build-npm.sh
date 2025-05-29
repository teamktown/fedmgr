#!/bin/bash

# Build script for creating npm packages

set -e

echo "🔨 Building fedmgr npm packages..."

# Create build directory
mkdir -p build/npm

# Build fedmgr package
echo "📦 Building @letsfederate/fedmgr..."
cd src/fedmgr

# Make sure package.json exists and has correct structure
if [ ! -f "package.json" ]; then
    echo "Creating package.json for fedmgr..."
    cat > package.json << EOF
{
  "name": "@letsfederate/fedmgr",
  "version": "0.1.0",
  "description": "Federation Manager CLI and Server",
  "main": "fedmgr.js",
  "bin": {
    "fedmgr": "./fedmgr.js"
  },
  "scripts": {
    "start": "node fedmgr.js",
    "test": "jest"
  },
  "dependencies": {
    "commander": "^9.4.1",
    "express": "^4.18.2",
    "jsonwebtoken": "^9.0.2",
    "node-fetch": "^2.6.7",
    "dotenv": "^16.3.1",
    "ws": "^8.14.2",
    "open": "^8.4.0"
  },
  "keywords": ["federation", "mcp", "cli", "openid"],
  "author": "Your Name",
  "license": "MIT"
}
EOF
fi

npm pack
mv letsfederate-fedmgr-*.tgz ../../build/npm/
cd ../..

# Build mcp-core package
echo "📦 Building @letsfederate/mcp-core..."
cd src/mcp-core

# Make sure package.json exists and has correct structure
if [ ! -f "package.json" ]; then
    echo "Creating package.json for mcp-core..."
    cat > package.json << EOF
{
  "name": "@letsfederate/mcp-core",
  "version": "0.1.0",
  "description": "MCP Core Server for Federation",
  "main": "mcp-server.js",
  "scripts": {
    "start": "node mcp-server.js",
    "test": "jest"
  },
  "dependencies": {
    "express": "^4.18.2",
    "jsonwebtoken": "^9.0.2",
    "node-fetch": "^2.6.7"
  },
  "keywords": ["mcp", "federation", "openid"],
  "author": "Your Name",
  "license": "MIT"
}
EOF
fi

npm pack
mv letsfederate-mcp-core-*.tgz ../../build/npm/
cd ../..

echo "✅ Build complete! Packages available in build/npm/"
ls -la build/npm/
