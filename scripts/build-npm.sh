#!/bin/bash

set -e

# Navigate to mcp-core, install, sanity check, and pack
echo "Building @letsfederate/mcp-core..."
cd src/mcp-core
npm install
npm run sanity
npm pack
echo "@letsfederate/mcp-core packaged successfully."
cd ../../ # Return to the root directory

echo "" # Add a newline for better readability

# Navigate to fedmgr, install, sanity check, and pack
echo "Building @letsfederate/fedmgr..."
cd src/fedmgr
npm install
npm run sanity
npm pack
echo "@letsfederate/fedmgr packaged successfully."
cd ../../ # Return to the root directory

echo "" # Add a newline for better readability
echo "NPM packages built successfully and are in ./src/mcp-core and ./src/fedmgr respectively"
echo "you will need to rebuild the corresponding docker images to use the new packages"