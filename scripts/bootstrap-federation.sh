#!/bin/bash
source .env
set -e

#verify fedmgr command is available
if ! command -v fedmgr &> /dev/null
then
    echo "fedmgr could not be found, please install it first with npm install ../build/npm/letsfederate-mcp-fedmgr-*.tgz "
    echo "or run the install-npm.sh script"
    exit
fi
# Check if the FEDMGR_FED_REG environment variable is set
if [ -z "$FEDMGR_FED_REG" ]; then
  echo "Error: FEDMGR_FED_REG environment variable is not set."
  echo "Please set it to the path where you want to store the federation registry."
  exit 1
fi


# Initialize the federation
echo "Bootstrapping federation 'alpha'..."

# Ensure the data directory exists
mkdir -p ${FEDMGR_FED_REG}


#ensure fedmgr is installed
if ! command -v fedmgr &> /dev/null
then
    echo "fedmgr could not be found, please install it first with "
    exit
fi

# Create an empty registry file if it doesn't exist
if [ ! -f ${FEDMGR_FED_REG/registry.json ]; then
  echo '{
    "federations": [],
    "mcps": {},
    "mcpProtocolServers": {}
  }' > ${FEDMGR_FED_REG}/registry.json
  echo "Created empty registry file"
fi

# Create the federation using the fedmgr CLI
fedmgr create fed alpha

echo "Federation 'alpha' bootstrapped successfully"
echo "Now you can run the reference docker compose testbed or hand manage the endpoints:"
# echo "docker-compose -f docker-compose.oidc.yml up -d"
