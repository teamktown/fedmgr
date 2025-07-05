#!/bin/bash

set -e

echo "Setting up complete federation environment with OIDC server mock"

# Step 1: Make the scripts executable
chmod +x scripts/setup-oidc-mock.sh
chmod +x scripts/bootstrap-federation.sh

# Step 2: Bootstrap the federation
./scripts/bootstrap-federation.sh

# Step 3: Set up OIDC mock configuration
./scripts/setup-oidc-mock.sh



echo "Setup complete!"
echo "To start the environment, run:"
echo "docker-compose -f docker-compose.oidc.yml up -d"
echo ""
echo "To authenticate with the CLI, run:"
echo "fedmgr login local-oidc-op --username admin --password admin --op-url http://localhost:8080"
