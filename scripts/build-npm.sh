#!/bin/bash
source .env
# This script builds the NPM packages for @letsfederate/mcp-core and @letsfederate/fedmgr
# and moves them to the ../build/npm directory.

set -e

# Navigate to mcp-core, install, sanity check, and pack
echo "Building @letsfederate/mcp-core..."
cd src/mcp-core
npm install
npm run sanity
npm pack
# make the ../build/npm directory if it does not exist
mkdir -p ../${FEDMGR_BUILD_DIR}/npm

# move the package to ../build/npm
mv *.tgz ../${FEDMGR_BUILD_DIR}/npm

echo "@letsfederate/mcp-core packaged successfully into ../build/npm."
cd ../../ # Return to the root directory

echo "" # Add a newline for better readability

# Navigate to fedmgr, install, sanity check, and pack
echo "Building @letsfederate/fedmgr..."
cd src/fedmgr
npm install
npm run sanity
npm pack
# move the package to ../build/npm

mv *.tgz ../${FEDMGR_BUILD_DIR}/npm

echo "@letsfederate/fedmgr packaged successfully."
cd ../../ # Return to the root directory

echo "" # Add a newline for better readability
echo "NPM packages built successfully and are in ../build/npm"
echo "you will need to rebuild the corresponding docker images to use the new packages"
echo "to install:"
echo "npm install ./build/npm/letsfederate-mcp-core-1.2.3.tgz"
echo "npm install ./build/npm/letsfederate-mcp-fedmgr-1.2.3.tgz"

