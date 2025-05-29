#!/bin/bash

# Build script for creating npm packages

set -e

echo "🔨 Building fedmgr npm packages..."

# Create build directory
mkdir -p build/npm

# Build fedmgr package
echo "📦 Building @letsfederate/fedmgr..."
cd src/fedmgr
npm pack
mv letsfederate-fedmgr-*.tgz ../../build/npm/
cd ../..

# Build mcp-core package
echo "📦 Building @letsfederate/mcp-core..."
cd src/mcp-core
npm pack
mv letsfederate-mcp-core-*.tgz ../../build/npm/
cd ../..

echo "✅ Build complete! Packages available in build/npm/"
ls -la build/npm/
