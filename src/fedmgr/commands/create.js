const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

function register(program, ctx) {
  program
    .command('create <type> <name>')
    .option('--federation <fed>', 'Federation name')
    .description('Create resources: fed, op, mcp, mcp-protocol')
    .action((type, name, opts) => {
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

            console.log(`🔑 Generating private key: ${privateKeyFile}`);
            execSync(`openssl genrsa -out "${privateKeyFile}" 2048`, { stdio: 'inherit' });
            console.log(`🔑 Generating public key: ${publicKeyFile}`);
            execSync(`openssl rsa -in "${privateKeyFile}" -pubout -out "${publicKeyFile}"`, { stdio: 'inherit' });
            console.log(`✅ Keys generated successfully`);
          } catch (e) {
            console.error('❌ Key generation failed:', e.message);
            console.error('Command output:', e.stdout?.toString());
            console.error('Command error:', e.stderr?.toString());
            process.exit(1);
          }

          const now = Math.floor(Date.now() / 1000);
          const entityId = `http://localhost:3001`;
          const cfg = {
            sub: entityId,
            metadata: {
              federation_entity: {
                organization_name: `Federation ${name}`,
                federation_fetch_endpoint: `${entityId}/.well-known/openid-federation`,
                federation_resolve_endpoint: `${entityId}/resolve`,
                federation_trust_mark_status_endpoint: `${entityId}/trust-mark-status`
              }
            },
            jwks: { keys: [] },
            iat: now
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
          console.error('❌ Operator creation not yet implemented');
          break;
        }
        default:
          console.error(`❌ Unknown resource type '${type}'`);
          process.exit(1);
      }
    });
}

module.exports = register;
