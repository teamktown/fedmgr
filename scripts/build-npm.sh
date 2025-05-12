#!/bin/bash
# This script builds the NPM packages for @letsfederate/mcp-core and @letsfederate/fedmgr
# and moves them to the specified build directory.
# It assumes that the environment variables FEDMGR_HOME and FEDMGR_BUILD_DIR are set in the .env file.
# It also assumes that the .env file is in the same directory as this script.
# The script will fail if any command fails (set -e) and will print each command before executing it (set -x).

# Check if the .env file exists
if [ ! -f .env ]; then
  echo "Error: .env file not found."
  exit 1
fi
set -a # Automatically export all variables to the environment
# Load environment variables from .env file
source .env
set +a # Stop automatically exporting variables

set -e

# check if FEDMGR_HOME is set
if [ -z "$FEDMGR_HOME" ]; then
  echo "Error: FEDMGR_HOME environment variable is not set."
  echo "Please set it to the path where the fedmgr code tree is either via an .env setting or environment variable."
  exit 1
fi
# check if FEDMGR_BUILD_DIR is set
if [ -z "$FEDMGR_BUILD_DIR" ]; then
  echo "Error: FEDMGR_BUILD_DIR environment variable is not set."
  echo "Please set it to the path where you want to store the build artifacts."
  exit 1
  else
    echo "## Using build directory: $FEDMGR_BUILD_DIR"
fi


# Navigate to mcp-core, install, sanity check, and pack
echo "Building @letsfederate/mcp-core..."
    cd ${FEDMGR_HOME}/src/mcp-core
npm install
npm run sanity
npm pack

# make the ./build/npm directory if it does not exist
mkdir -p ${FEDMGR_BUILD_DIR}/npm
# move the package to ./build/npm
mv *.tgz ${FEDMGR_BUILD_DIR}/npm

echo "@letsfederate/mcp-core packaged successfully into ${FEDMGR_BUILD_DIR}/npm."
cd ${FEDMGR_HOME} # Return to the root directory

echo "in `pwd`" # Add a newline for better readability

# Navigate to fedmgr, install, sanity check, and pack
echo "Building @letsfederate/fedmgr..."
cd ${FEDMGR_HOME}/src/fedmgr
npm install
npm run sanity
npm pack
# move the package to ../build/npm

mv *.tgz ${FEDMGR_BUILD_DIR}/npm

echo "@letsfederate/fedmgr packaged successfully."
cd ${FEDMGR_HOME} # Return to the root directory

echo "" # Add a newline for better readability
echo "NPM packages built successfully and are in ${FEDMGR_BUILD_DIR}/npm"
echo "you will need to rebuild the corresponding docker images to use the new packages"
echo "to force only a rebuild, use the --build-only flag"


# install the new packages globally and if a passed in arguement of --build-only is present using getopts to check, skip this step

if [ "$1" == "--build-only" ]; then
  echo "Skipping global install as --build-only was passed in"
  exit 0
fi

npm install -g ${FEDMGR_BUILD_DIR}/npm/letsfederate-mcp-core-*.tgz
npm install -g ${FEDMGR_BUILD_DIR}/npm/letsfederate-fedmgr-*.tgz
# check if fedmgr is in the path
if ! command -v fedmgr &> /dev/null; then
  echo "Error: fedmgr is not in the path."
  exit 1
fi

echo "✅ fedmgr CLI installed globally"
echo "Lets try running: fedmgr -V --help"
fedmgr -V --help


