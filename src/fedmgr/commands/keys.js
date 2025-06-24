const path = require('path');
const fs = require('fs');
const { getDefaultKeyProvider } = require('../server/utils/key-provider');

function register(program, ctx) {
  const keyCmd = program
    .command('keys')
    .description('Manage federation keys and certificates');

  // Generate keys command
  keyCmd
    .command('generate <keyId>')
    .option('--provider <type>', 'Key provider type (filesystem, vault, docker-secrets)', 'filesystem')
    .option('--key-size <size>', 'RSA key size in bits', '2048')
    .option('--output-dir <dir>', 'Output directory for keys', './build/install/keys')
    .option('--force', 'Overwrite existing keys')
    .description('Generate RSA key pair for federation or MCP')
    .action(async (keyId, opts) => {
      try {
        console.log(`🔑 Generating keys for '${keyId}'...`);
        
        // Initialize key provider
        const keyProvider = getDefaultKeyProvider();
        
        // Override config if options provided
        if (opts.outputDir) {
          keyProvider.basePath = opts.outputDir;
        }
        if (opts.keySize) {
          keyProvider.keySize = parseInt(opts.keySize);
        }

        // Check if keys already exist
        const exists = await keyProvider.keyExists(keyId);
        if (exists && !opts.force) {
          console.log(`⚠️  Keys for '${keyId}' already exist. Use --force to overwrite.`);
          return;
        }

        // Generate key pair
        const { privateKey, publicKey } = await keyProvider.generateKeyPair(keyId, {
          keySize: parseInt(opts.keySize)
        });

        console.log(`✅ Keys generated successfully:`);
        console.log(`   Private key: ${keyProvider._getKeyPaths(keyId).privateKey}`);
        console.log(`   Public key:  ${keyProvider._getKeyPaths(keyId).publicKey}`);
        
      } catch (error) {
        console.error('❌ Key generation failed:', error.message);
        process.exit(1);
      }
    });

  // List keys command
  keyCmd
    .command('list')
    .option('--provider <type>', 'Key provider type', 'filesystem')
    .description('List all available keys')
    .action(async (opts) => {
      try {
        const keyProvider = getDefaultKeyProvider();
        const keys = await keyProvider.listKeys();
        
        if (keys.length === 0) {
          console.log('📭 No keys found');
          return;
        }
        
        console.log('🔑 Available keys:');
        for (const keyId of keys) {
          const exists = await keyProvider.keyExists(keyId);
          console.log(`   ${exists ? '✅' : '❌'} ${keyId}`);
        }
      } catch (error) {
        console.error('❌ Failed to list keys:', error.message);
        process.exit(1);
      }
    });

  // Check keys command
  keyCmd
    .command('check <keyId>')
    .option('--provider <type>', 'Key provider type', 'filesystem')
    .description('Check if key pair exists and is valid')
    .action(async (keyId, opts) => {
      try {
        const keyProvider = getDefaultKeyProvider();
        const exists = await keyProvider.keyExists(keyId);
        
        if (!exists) {
          console.log(`❌ Keys for '${keyId}' do not exist`);
          process.exit(1);
        }
        
        // Verify keys can be read
        const privateKey = await keyProvider.getPrivateKey(keyId);
        const publicKey = await keyProvider.getPublicKey(keyId);
        
        console.log(`✅ Keys for '${keyId}' exist and are readable`);
        console.log(`   Private key size: ${privateKey.length} chars`);
        console.log(`   Public key size:  ${publicKey.length} chars`);
        
      } catch (error) {
        console.error(`❌ Key check failed for '${keyId}':`, error.message);
        process.exit(1);
      }
    });

  // Delete keys command
  keyCmd
    .command('delete <keyId>')
    .option('--provider <type>', 'Key provider type', 'filesystem')
    .option('--confirm', 'Skip confirmation prompt')
    .description('Delete key pair')
    .action(async (keyId, opts) => {
      try {
        const keyProvider = getDefaultKeyProvider();
        const exists = await keyProvider.keyExists(keyId);
        
        if (!exists) {
          console.log(`⚠️  Keys for '${keyId}' do not exist`);
          return;
        }
        
        if (!opts.confirm) {
          console.log(`⚠️  This will permanently delete keys for '${keyId}'`);
          console.log('   Use --confirm to proceed');
          return;
        }
        
        const deleted = await keyProvider.deleteKey(keyId);
        if (deleted) {
          console.log(`✅ Keys for '${keyId}' deleted successfully`);
        } else {
          console.log(`⚠️  No keys found to delete for '${keyId}'`);
        }
        
      } catch (error) {
        console.error(`❌ Key deletion failed for '${keyId}':`, error.message);
        process.exit(1);
      }
    });

  // Setup command - generates all required keys for a federation
  keyCmd
    .command('setup <federationName>')
    .option('--provider <type>', 'Key provider type', 'filesystem')
    .option('--key-size <size>', 'RSA key size in bits', '2048')
    .option('--output-dir <dir>', 'Output directory for keys', './build/install/keys')
    .option('--force', 'Overwrite existing keys')
    .description('Generate all required keys for a federation')
    .action(async (federationName, opts) => {
      try {
        console.log(`🚀 Setting up keys for federation '${federationName}'...`);
        
        const keyProvider = getDefaultKeyProvider();
        
        // Override config if options provided
        if (opts.outputDir) {
          keyProvider.basePath = path.join(opts.outputDir, federationName);
        }
        if (opts.keySize) {
          keyProvider.keySize = parseInt(opts.keySize);
        }

        const keyIds = [
          `${federationName}-anchor`,
          `${federationName}-federation`,
          `${federationName}-mcp`
        ];

        for (const keyId of keyIds) {
          const exists = await keyProvider.keyExists(keyId);
          if (exists && !opts.force) {
            console.log(`⚠️  Keys for '${keyId}' already exist, skipping...`);
            continue;
          }

          console.log(`🔑 Generating keys for '${keyId}'...`);
          await keyProvider.generateKeyPair(keyId, {
            keySize: parseInt(opts.keySize)
          });
        }

        console.log(`✅ Federation '${federationName}' key setup complete`);
        console.log(`📁 Keys location: ${keyProvider.basePath}`);
        
      } catch (error) {
        console.error('❌ Federation key setup failed:', error.message);
        process.exit(1);
      }
    });

  // Import command - for importing existing keys
  keyCmd
    .command('import <keyId> <privateKeyPath> <publicKeyPath>')
    .option('--provider <type>', 'Key provider type', 'filesystem')
    .option('--output-dir <dir>', 'Output directory for keys', './build/install/keys')
    .description('Import existing key pair')
    .action(async (keyId, privateKeyPath, publicKeyPath, opts) => {
      try {
        console.log(`📥 Importing keys for '${keyId}'...`);
        
        // Verify source files exist
        if (!fs.existsSync(privateKeyPath)) {
          throw new Error(`Private key file not found: ${privateKeyPath}`);
        }
        if (!fs.existsSync(publicKeyPath)) {
          throw new Error(`Public key file not found: ${publicKeyPath}`);
        }

        const keyProvider = getDefaultKeyProvider();
        
        // Override config if options provided
        if (opts.outputDir) {
          keyProvider.basePath = opts.outputDir;
        }

        // Read source keys
        const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
        const publicKey = fs.readFileSync(publicKeyPath, 'utf8');

        // Get destination paths
        const destPaths = keyProvider._getKeyPaths(keyId);
        
        // Ensure destination directory exists
        fs.mkdirSync(path.dirname(destPaths.privateKey), { recursive: true });
        
        // Copy keys to destination
        fs.writeFileSync(destPaths.privateKey, privateKey);
        fs.writeFileSync(destPaths.publicKey, publicKey);

        console.log(`✅ Keys imported successfully:`);
        console.log(`   Private key: ${destPaths.privateKey}`);
        console.log(`   Public key:  ${destPaths.publicKey}`);
        
      } catch (error) {
        console.error('❌ Key import failed:', error.message);
        process.exit(1);
      }
    });
}

module.exports = register;