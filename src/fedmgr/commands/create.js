const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { getDefaultKeyProvider } = require('../server/utils/key-provider');

function register(program, ctx) {
  program
    .command('create <type> <name>')
    .option('--federation <fed>', 'Federation name')
    .description('Create resources: fed, op, mcp, mcp-protocol')
    .action(async (type, name, opts) => {
      const { FEDMGR_FED_DIR, ensureDirectoryExists, loadRegistry, saveRegistry, mcpInterface } = ctx;
      switch (type) {
        case 'fed': {
          const fedPath = path.join(FEDMGR_FED_DIR, name);
          const keysPath = path.join(fedPath, 'keys');
          const configPath = path.join(fedPath, 'config');
          const entityConfigFile = path.join(configPath, 'entity-configuration.json');
          const privateKeyFile = path.join(keysPath, 'anchor-private.pem');
          const publicKeyFile = path.join(keysPath, 'anchor-public.pem');

          if (fs.existsSync(entityConfigFile)) {
            console.log(`⚠️ Federation '${name}' exists`);
            return;
          }

          try {
            console.log(`📁 Creating federation directories for '${name}'...`);
            ensureDirectoryExists(keysPath);
            ensureDirectoryExists(configPath);

            console.log(`🔑 Generating keys for federation '${name}'...`);
            
            // Use the key provider for consistent key generation
            const keyProvider = getDefaultKeyProvider();
            // Set the base path to the federation's keys directory
            keyProvider.basePath = keysPath;
            
            await keyProvider.generateKeyPair('anchor', {
              keySize: 2048
            });
            
            console.log(`✅ Keys generated successfully`);
          } catch (e) {
            console.error('❌ Key generation failed:', e.message);
            process.exit(1);
          }

          const now = Math.floor(Date.now() / 1000);
          const entityId = `http://localhost:3001`;
          const cfg = {
            sub: entityId,
            iss: entityId, // Self-issued for trust anchor
            iat: now,
            exp: now + (365 * 24 * 60 * 60), // 1 year expiration for trust anchor
            metadata: {
              federation_entity: {
                organization_name: `Federation ${name}`,
                federation_fetch_endpoint: `${entityId}/federation_fetch`,
                federation_list_endpoint: `${entityId}/federation_list`,
                federation_resolve_endpoint: `${entityId}/resolve`,
                federation_trust_mark_status_endpoint: `${entityId}/trust-mark-status`,
                trust_marks: []
              }
            },
            jwks: { keys: [] },
            authority_hints: [] // Empty for trust anchor
          };

          console.log(`📝 Writing entity configuration: ${entityConfigFile}`);
          fs.writeFileSync(entityConfigFile, JSON.stringify(cfg, null, 2));

          const reg = loadRegistry();
          reg.federations = reg.federations || [];
          if (!reg.federations.includes(name)) {
            reg.federations.push(name);
            saveRegistry(reg);
          }
          console.log(`✅ Federation '${name}' initialized at ${fedPath}`);
          break;
        }
        case 'mcp-protocol': {
          const res = mcpInterface.createMcpProtocolServer(name);
          if (res.success) {
            console.log(`✅ MCP Protocol Server '${name}' on port ${res.port}`);
            mcpInterface.startMcpProtocolServer(name);
          } else console.error(`❌ ${res.message}`);
          break;
        }
        case 'mcp': {
          if (!opts.federation) {
            console.error(`❌ --federation required for mcp`);
            process.exit(1);
          }
          const res = mcpInterface.createMcp(name);
          if (res.success) mcpInterface.startMcp(name);
          else console.error(`❌ ${res.message}`);
          break;
        }
        case 'op': {
          if (!opts.federation) {
            console.error(`❌ --federation required for op`);
            process.exit(1);
          }

          const opPath = path.join(FEDMGR_FED_DIR, name);
          const keysPath = path.join(opPath, 'keys');
          const configPath = path.join(opPath, 'config');
          const entityConfigFile = path.join(configPath, 'entity-configuration.json');
          const privateKeyFile = path.join(keysPath, `${name}-private.pem`);
          const publicKeyFile = path.join(keysPath, `${name}-public.pem`);

          if (fs.existsSync(entityConfigFile)) {
            console.log(`⚠️ OpenID Provider '${name}' already exists`);
            return;
          }

          try {
            console.log(`📁 Creating OP directories for '${name}'...`);
            ensureDirectoryExists(keysPath);
            ensureDirectoryExists(configPath);

            console.log(`🔑 Generating OP private key: ${privateKeyFile}`);
            execSync(`openssl genrsa -out "${privateKeyFile}" 2048`, { stdio: 'inherit' });
            console.log(`🔑 Generating OP public key: ${publicKeyFile}`);
            execSync(`openssl rsa -in "${privateKeyFile}" -pubout -out "${publicKeyFile}"`, { stdio: 'inherit' });
            console.log(`✅ OP keys generated successfully`);
          } catch (e) {
            console.error('❌ OP key generation failed:', e.message);
            console.error('Command output:', e.stdout?.toString());
            console.error('Command error:', e.stderr?.toString());
            process.exit(1);
          }

          // Get available port for OP server
          const basePort = 4000;
          const portOffset = Math.floor(Math.random() * 1000);
          const opPort = basePort + portOffset;

          const now = Math.floor(Date.now() / 1000);
          const entityId = `http://localhost:${opPort}`;
          
          // Create OP entity configuration per OpenID Federation spec
          const opConfig = {
            sub: entityId,
            iss: entityId, // Self-issued for intermediate entities
            iat: now,
            exp: now + (30 * 24 * 60 * 60), // 30 days expiration for intermediate entities
            metadata: {
              federation_entity: {
                organization_name: `OpenID Provider ${name}`,
                federation_fetch_endpoint: `${entityId}/federation_fetch`,
                federation_list_endpoint: `${entityId}/federation_list`,
                federation_resolve_endpoint: `${entityId}/resolve`,
                federation_trust_mark_status_endpoint: `${entityId}/trust-mark-status`,
                trust_marks: []
              },
              openid_provider: {
                issuer: entityId,
                authorization_endpoint: `${entityId}/authorize`,
                token_endpoint: `${entityId}/token`,
                userinfo_endpoint: `${entityId}/userinfo`,
                jwks_uri: `${entityId}/jwks`,
                response_types_supported: ["code", "id_token", "code id_token"],
                subject_types_supported: ["public"],
                id_token_signing_alg_values_supported: ["RS256"],
                scopes_supported: ["openid", "profile", "email"],
                claims_supported: ["sub", "name", "email", "preferred_username"],
                grant_types_supported: ["authorization_code", "implicit"],
                federation_registration_endpoint: `${entityId}/federation_registration`
              }
            },
            jwks: { keys: [] }, // Will be populated with generated key
            authority_hints: [`http://localhost:3001`] // Points to trust anchor
          };

          console.log(`📝 Writing OP entity configuration: ${entityConfigFile}`);
          fs.writeFileSync(entityConfigFile, JSON.stringify(opConfig, null, 2));

          // Add to registry
          const reg = loadRegistry();
          reg.openid_providers = reg.openid_providers || [];
          if (!reg.openid_providers.some(op => op.name === name)) {
            reg.openid_providers.push({
              name: name,
              entityId: entityId,
              port: opPort,
              federation: opts.federation,
              status: 'created',
              created_at: new Date().toISOString()
            });
            saveRegistry(reg);
          }

          console.log(`✅ OpenID Provider '${name}' created successfully`);
          console.log(`🔗 Entity ID: ${entityId}`);
          console.log(`📋 Federation: ${opts.federation}`);
          console.log(`🚀 To start the OP server, run: fedmgr start op ${name}`);
          break;
        }
        default:
          console.error(`❌ Unknown resource type '${type}'`);
          process.exit(1);
      }
    });
}

module.exports = register;
