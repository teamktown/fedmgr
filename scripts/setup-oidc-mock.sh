#!/bin/bash
# Set up oidc-server-mock configuration




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

if [ -z "$OIDC_MOCK_CONFIG_DIR" ]; then
  echo "Error: OIDC_MOCK_CONFIG_DIR environment variable is not set."
  echo "Please set it to the OIDC mock configuration directory in the .env file."
  exit 1
fi


# Create the OIDC server mock configuration directory

OIDC_CONFIG_DIR="$OIDC_MOCK_CONFIG_DIR"

echo "Creating OIDC server mock configuration..."
mkdir -p "$OIDC_CONFIG_DIR"

# Create server options configuration
cat > "$OIDC_CONFIG_DIR/server-options.json" << EOF
{
  "IssuerUri": "http://localhost:8080",
  "AccessTokenJwtType": "JWT"
}
EOF

# Create clients configuration
cat > "$OIDC_CONFIG_DIR/clients-config.json" << EOF
[
  {
    "ClientId": "fedmgr-cli",
    "ClientSecrets": ["fedmgr-cli-secret"],
    "Description": "Federation Manager CLI client",
    "AllowedGrantTypes": ["password", "client_credentials"],
    "AllowedScopes": ["openid", "profile", "federation-api"],
    "ClientClaimsPrefix": "",
    "AlwaysSendClientClaims": true,
    "AlwaysIncludeUserClaimsInIdToken": true,
    "AccessTokenLifetime": 3600,
    "IdentityTokenLifetime": 3600,
    "Claims": [
      {
        "Type": "federation",
        "Value": "fed-alpha"
      }
    ]
  }
]
EOF

# Create users configuration with default admin and operator users
cat > "$OIDC_CONFIG_DIR/users-config.json" << EOF
[
  {
    "SubjectId": "1",
    "Username": "admin",
    "Password": "admin",
    "Claims": [
      { "Type": "name", "Value": "Admin User" },
      { "Type": "email", "Value": "admin@example.com" },
      { "Type": "federation", "Value": "fed-alpha" },
      { "Type": "role", "Value": "admin" }
    ]
  },
  {
    "SubjectId": "2",
    "Username": "operator",
    "Password": "operator",
    "Claims": [
      { "Type": "name", "Value": "Operator User" },
      { "Type": "email", "Value": "operator@example.com" },
      { "Type": "federation", "Value": "fed-alpha" },
      { "Type": "role", "Value": "operator" }
    ]
  }
]
EOF

echo "OIDC server mock configuration created in $OIDC_CONFIG_DIR"
echo "Run the following command to start the OIDC server:"
echo "docker-compose -f docker-compose.oidc.yml up -d"
