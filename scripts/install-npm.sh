#!/bin/bash

# Build the package
./scripts/build-npm.sh

# Install the package globally
npm install -g ./

echo "✅ fedmgr CLI installed globally"
echo "Lets try running: fedmgr --help"
fedmgr --help
