#!/bin/bash


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

set -e


#verify fedmgr command is available
if [ ! command -v fedmgr &> /dev/null ]; then
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
if [ -z "$FEDMGR_DEF_FED" ]; then
  echo "Error: FEDMGR_DEF_FED environment variable is not set."
  echo "Please set it to the default federation name in the .env file."
  exit 1
fi


# Initialize the federation
echo "Bootstrapping federation ..."

# Ensure the data directory exists
mkdir -p ${FEDMGR_FED_REG}


# Create an empty registry file if it doesn't exist
if [ ! -f ${FEDMGR_FED_REG}/registry.json ]; then
  echo '{
    "federations": [],
    "mcps": {},
    "mcpProtocolServers": {}
  }' > ${FEDMGR_FED_REG}/registry.json
  echo "Created empty registry file"
fi

# Create the federation using the fedmgr CLI
fedmgr create fed ${FEDMGR_DEF_FED} 
#--registry ${FEDMGR_FED_REG}/registry.json --entity-id ${FEDMGR_DEF_FED} --federation-entity-id ${FEDMGR_DEF_FED} --federation-name ${FEDMGR_DEF_FED} --federation-description "Federation for $FEDMGR_DEF_FED" --federation-contacts "admin@${FEDMGR_DEF_FED}.local" --federation-organization-name "fedmgr Federation $FEDMGR_DEF_FED" --federation-fetch-endpoint "${FEDMGR_DEF_FED}/federation" --trust-marks "[]"
# --federation-entity-id ${FEDMGR_DEF_FED} --federation-name ${FEDMGR_DEF_FED} --federation-description "Federation for $FEDMGR_DEF_FED" --federation-contacts "admin@${FEDMGR_DEF_FED}.local" --federation-organization-name "fedmgr Federation $FEDMGR_DEF_FED" --federation-fetch-endpoint "${FEDMGR_DEF_FED}/federation" --trust-marks "[]"

echo "Federation '${FEDMGR_DEF_FED}' bootstrapped successfully"
echo "Now you can run the reference docker compose testbed or hand manage the endpoints:"
# echo "docker-compose -f docker-compose.oidc.yml up -d"
