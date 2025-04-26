const jose = require('node-jose');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Generates cryptographic keys and an entity configuration file for an MCP instance.
 *
 * Creates necessary directories, generates a 2048-bit RSA key pair, converts the public key to JWK format, and writes an entity configuration JSON file containing metadata and key information for the specified instance.
 *
 * @param {string} instanceName - The name of the MCP instance for which to generate configuration.
 * @param {string} federationTrustAnchor - The federation trust anchor URL to include in the entity configuration.
 */
async function generateMcpConfig(instanceName, federationTrustAnchor) {
    const instanceDir = path.join(__dirname, '..', 'mcp_instances', instanceName);
    const keysDir = path.join(instanceDir, 'keys');
    const configDir = path.join(instanceDir, 'config');
    const privateKeyPath = path.join(keysDir, `${instanceName}-private.pem`);
    const publicKeyPath = path.join(keysDir, `${instanceName}-public.pem`);

    // Create directories if they don't exist
    fs.mkdirSync(keysDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });

    // Generate RSA key pair using openssl
    execSync(`openssl genpkey -algorithm RSA -out ${privateKeyPath} -pkeyopt rsa_keygen_bits:2048`);
    execSync(`openssl rsa -pubout -in ${privateKeyPath} -out ${publicKeyPath}`);

    // Read public key
    const publicKeyPem = fs.readFileSync(publicKeyPath, 'utf8');

    // Convert public key to JWK format using node-jose
    const key = await jose.JWK.asKey(publicKeyPem, 'pem');
    const publicKeyJwk = key.toJSON();

    // Create entity configuration
    const now = Math.floor(Date.now() / 1000);
    const entityConfiguration = {
        sub: `http://localhost:PORT_PLACEHOLDER`, // Placeholder for port
        metadata: {
            federation_entity: {
                organization_name: `${instanceName} Test Instance`,
                homepage_uri: `http://localhost:PORT_PLACEHOLDER`,
                policy_uri: `http://localhost:PORT_PLACEHOLDER/policy`,
                tos_uri: `http://localhost:PORT_PLACEHOLDER/tos`
            }
        },
        authority_hints: [federationTrustAnchor],
        jwks: {
            keys: [publicKeyJwk]
        },
        iat: now,
        exp: now + (365 * 24 * 60 * 60) // 1 year expiration
    };

    // Save entity configuration
    fs.writeFileSync(path.join(configDir, 'entity-configuration.json'), JSON.stringify(entityConfiguration, null, 2));

    console.log(`Generated configuration for ${instanceName}`);
}

const instances = [
    { name: 'test-federation', trustAnchor: 'http://localhost:3001' }, // test-federation is its own trust anchor
    { name: 'test-mcp1', trustAnchor: 'http://localhost:3001' },
    { name: 'test-mcp2', trustAnchor: 'http://localhost:3001' }
];

/**
 * Generates configuration files for all defined MCP instances using a common federation trust anchor.
 *
 * Iterates over each MCP instance and invokes configuration generation with the specified trust anchor URL.
 */
async function main() {
    const federationTrustAnchor = 'http://localhost:3001'; // Assuming test-federation runs on port 3001

    for (const instance of instances) {
        await generateMcpConfig(instance.name, federationTrustAnchor);
    }
}

main().catch(console.error);