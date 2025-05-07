#!/bin/bash

# Initialize the federation
echo "Bootstrapping federation 'alpha'..."

# Ensure the data directory exists
mkdir -p data

#ensure fedmgr is installed
if ! command -v fedmgr &> /dev/null
then
    echo "fedmgr could not be found, please install it first with "
    exit
fi

# Create an empty registry file if it doesn't exist
if [ ! -f data/registry.json ]; then
  echo '{
    "federations": [],
    "mcps": {},
    "mcpProtocolServers": {}
  }' > data/registry.json
  echo "Created empty registry file"
fi

# Create the federation using the fedmgr CLI
fedmgr create fed alpha

echo "Federation 'alpha' bootstrapped successfully"
echo "Now you can run the OIDC server mock with:"
echo "docker-compose -f docker-compose.oidc.yml up -d"
