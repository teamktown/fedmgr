#!/bin/bash

# Set up oidc-server-mock configuration
OIDC_CONFIG_DIR="./oidc-config"

echo "Creating OIDC server mock configuration..."
mkdir -p "$OIDC_CONFIG_DIR"

# Create server options configuration
cat > "$OIDC_CONFIG_DIR/server-options.json" << EOF
{
  "ServerOptions": {
    "IssuerUri": "http://localhost:8080",
    "AccessTokenJwtType": "JWT"
  },
  "ApiResources": [
    {
      "Name": "federation-api",
      "Scopes": ["federation-api"],
      "UserClaims": ["sub", "name", "email", "federation"]
    }
  ],
  "ApiScopes": [
    {
      "Name": "federation-api",
      "UserClaims": ["sub", "name", "email", "federation"]
    },
    {
      "Name": "openid"
    },
    {
      "Name": "profile"
    }
  ],
  "IdentityResources": [
    {
      "Name": "openid",
      "UserClaims": ["sub"]
    },
    {
      "Name": "profile",
      "UserClaims": ["name", "email", "federation"]
    }
  ]
}
EOF

# Create clients configuration
cat > "$OIDC_CONFIG_DIR/clients-config.json" << EOF
{
  "Clients": [
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
      "ClientClaims": [
        {
          "Type": "federation",
          "Value": "fed-alpha"
        }
      ]
    }
  ]
}
EOF

# Create users configuration with default admin and operator users
cat > "$OIDC_CONFIG_DIR/users-config.json" << EOF
{
  "Users": [
    {
      "SubjectId": "1",
      "Username": "admin",
      "Password": "admin",
      "Claims": [
        {
          "Type": "name",
          "Value": "Admin User"
        },
        {
          "Type": "email",
          "Value": "admin@example.com"
        },
        {
          "Type": "federation",
          "Value": "fed-alpha"
        },
        {
          "Type": "role",
          "Value": "admin"
        }
      ]
    },
    {
      "SubjectId": "2",
      "Username": "operator",
      "Password": "operator",
      "Claims": [
        {
          "Type": "name",
          "Value": "Operator User"
        },
        {
          "Type": "email",
          "Value": "operator@example.com"
        },
        {
          "Type": "federation",
          "Value": "fed-alpha"
        },
        {
          "Type": "role",
          "Value": "operator"
        }
      ]
    }
  ]
}
EOF

echo "OIDC server mock configuration created in $OIDC_CONFIG_DIR"
echo "Run the following command to start the OIDC server:"
echo "docker-compose -f docker-compose.oidc.yml up -d"
