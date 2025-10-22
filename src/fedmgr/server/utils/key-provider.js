/**
 * Key Provider Abstraction
 * 
 * Provides an abstraction layer for certificate and key management that supports:
 * - Local filesystem storage (current implementation)
 * - Future integration with external secret stores (HashiCorp Vault, AWS Secrets Manager, etc.)
 * - Docker secrets integration
 * - Kubernetes secrets integration
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

/**
 * Abstract base class for key providers
 */
class KeyProvider {
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * Generate a new RSA key pair
   * @param {string} keyId - Unique identifier for the key pair
   * @param {Object} options - Key generation options
   * @returns {Promise<{privateKey: string, publicKey: string}>}
   */
  async generateKeyPair(keyId, options = {}) {
    throw new Error('generateKeyPair must be implemented by subclass');
  }

  /**
   * Retrieve a private key
   * @param {string} keyId - Key identifier
   * @returns {Promise<string>} - PEM formatted private key
   */
  async getPrivateKey(keyId) {
    throw new Error('getPrivateKey must be implemented by subclass');
  }

  /**
   * Retrieve a public key
   * @param {string} keyId - Key identifier
   * @returns {Promise<string>} - PEM formatted public key
   */
  async getPublicKey(keyId) {
    throw new Error('getPublicKey must be implemented by subclass');
  }

  /**
   * Check if a key pair exists
   * @param {string} keyId - Key identifier
   * @returns {Promise<boolean>}
   */
  async keyExists(keyId) {
    throw new Error('keyExists must be implemented by subclass');
  }

  /**
   * Delete a key pair
   * @param {string} keyId - Key identifier
   * @returns {Promise<boolean>}
   */
  async deleteKey(keyId) {
    throw new Error('deleteKey must be implemented by subclass');
  }

  /**
   * List all available keys
   * @returns {Promise<string[]>}
   */
  async listKeys() {
    throw new Error('listKeys must be implemented by subclass');
  }
}

/**
 * Filesystem-based key provider (current implementation)
 */
class FilesystemKeyProvider extends KeyProvider {
  constructor(config = {}) {
    super(config);
    this.basePath = config.basePath || './build/install/keys';
    this.keySize = config.keySize || 2048;
    
    // Ensure base directory exists
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  /**
   * Get paths for a key pair
   * @private
   */
  _getKeyPaths(keyId) {
    return {
      privateKey: path.join(this.basePath, `${keyId}-private.pem`),
      publicKey: path.join(this.basePath, `${keyId}-public.pem`)
    };
  }

  async generateKeyPair(keyId, options = {}) {
    const keySize = options.keySize || this.keySize;
    const paths = this._getKeyPaths(keyId);

    try {
      // Generate private key
      console.log(`🔑 Generating ${keySize}-bit RSA key pair for '${keyId}'...`);
      execSync(`openssl genrsa -out "${paths.privateKey}" ${keySize}`, { stdio: 'inherit' });
      
      // Generate public key from private key
      execSync(`openssl rsa -in "${paths.privateKey}" -pubout -out "${paths.publicKey}"`, { stdio: 'inherit' });
      
      // Read and return the keys
      const privateKey = fs.readFileSync(paths.privateKey, 'utf8');
      const publicKey = fs.readFileSync(paths.publicKey, 'utf8');
      
      console.log(`✅ Key pair generated successfully for '${keyId}'`);
      return { privateKey, publicKey };
    } catch (error) {
      console.error(`❌ Failed to generate key pair for '${keyId}':`, error.message);
      throw new Error(`Key generation failed: ${error.message}`);
    }
  }

  async getPrivateKey(keyId) {
    const paths = this._getKeyPaths(keyId);
    
    if (!fs.existsSync(paths.privateKey)) {
      throw new Error(`Private key not found for '${keyId}' at ${paths.privateKey}`);
    }
    
    return fs.readFileSync(paths.privateKey, 'utf8');
  }

  async getPublicKey(keyId) {
    const paths = this._getKeyPaths(keyId);
    
    if (!fs.existsSync(paths.publicKey)) {
      throw new Error(`Public key not found for '${keyId}' at ${paths.publicKey}`);
    }
    
    return fs.readFileSync(paths.publicKey, 'utf8');
  }

  async keyExists(keyId) {
    const paths = this._getKeyPaths(keyId);
    return fs.existsSync(paths.privateKey) && fs.existsSync(paths.publicKey);
  }

  async deleteKey(keyId) {
    const paths = this._getKeyPaths(keyId);
    let deleted = false;
    
    if (fs.existsSync(paths.privateKey)) {
      fs.unlinkSync(paths.privateKey);
      deleted = true;
    }
    
    if (fs.existsSync(paths.publicKey)) {
      fs.unlinkSync(paths.publicKey);
      deleted = true;
    }
    
    return deleted;
  }

  async listKeys() {
    if (!fs.existsSync(this.basePath)) {
      return [];
    }
    
    const files = fs.readdirSync(this.basePath);
    const keyIds = new Set();
    
    files.forEach(file => {
      const match = file.match(/^(.+)-(private|public)\.pem$/);
      if (match) {
        keyIds.add(match[1]);
      }
    });
    
    return Array.from(keyIds);
  }
}

/**
 * Vault-based key provider (placeholder for future implementation)
 */
class VaultKeyProvider extends KeyProvider {
  constructor(config = {}) {
    super(config);
    this.vaultUrl = config.vaultUrl;
    this.vaultToken = config.vaultToken;
    this.mountPath = config.mountPath || 'fedmgr-keys';
  }

  async generateKeyPair(keyId, options = {}) {
    // TODO: Implement Vault integration
    throw new Error('Vault key provider not yet implemented');
  }

  async getPrivateKey(keyId) {
    // TODO: Implement Vault integration
    throw new Error('Vault key provider not yet implemented');
  }

  async getPublicKey(keyId) {
    // TODO: Implement Vault integration
    throw new Error('Vault key provider not yet implemented');
  }

  async keyExists(keyId) {
    // TODO: Implement Vault integration
    throw new Error('Vault key provider not yet implemented');
  }

  async deleteKey(keyId) {
    // TODO: Implement Vault integration
    throw new Error('Vault key provider not yet implemented');
  }

  async listKeys() {
    // TODO: Implement Vault integration
    throw new Error('Vault key provider not yet implemented');
  }
}

/**
 * Docker Secrets key provider (placeholder for future implementation)
 */
class DockerSecretsKeyProvider extends KeyProvider {
  constructor(config = {}) {
    super(config);
    this.secretsPath = config.secretsPath || '/run/secrets';
  }

  async generateKeyPair(keyId, options = {}) {
    // Docker secrets are typically read-only, so generation would need external orchestration
    throw new Error('Docker secrets provider does not support key generation');
  }

  async getPrivateKey(keyId) {
    // TODO: Implement Docker secrets integration
    throw new Error('Docker secrets key provider not yet implemented');
  }

  async getPublicKey(keyId) {
    // TODO: Implement Docker secrets integration
    throw new Error('Docker secrets key provider not yet implemented');
  }

  async keyExists(keyId) {
    // TODO: Implement Docker secrets integration
    throw new Error('Docker secrets key provider not yet implemented');
  }

  async deleteKey(keyId) {
    // Docker secrets are typically immutable
    throw new Error('Docker secrets provider does not support key deletion');
  }

  async listKeys() {
    // TODO: Implement Docker secrets integration
    throw new Error('Docker secrets key provider not yet implemented');
  }
}

/**
 * Factory function to create key providers
 */
function createKeyProvider(type = 'filesystem', config = {}) {
  switch (type.toLowerCase()) {
    case 'filesystem':
    case 'fs':
      return new FilesystemKeyProvider(config);
    
    case 'vault':
    case 'hashicorp-vault':
      return new VaultKeyProvider(config);
    
    case 'docker-secrets':
    case 'docker':
      return new DockerSecretsKeyProvider(config);
    
    default:
      throw new Error(`Unknown key provider type: ${type}`);
  }
}

/**
 * Get default key provider based on environment
 */
function getDefaultKeyProvider() {
  const providerType = process.env.FEDMGR_KEY_PROVIDER || 'filesystem';
  const config = {
    basePath: process.env.FEDMGR_KEYS_PATH || './build/install/keys',
    keySize: parseInt(process.env.FEDMGR_KEY_SIZE || '2048'),
    vaultUrl: process.env.VAULT_URL,
    vaultToken: process.env.VAULT_TOKEN,
    mountPath: process.env.VAULT_MOUNT_PATH || 'fedmgr-keys'
  };
  
  return createKeyProvider(providerType, config);
}

module.exports = {
  KeyProvider,
  FilesystemKeyProvider,
  VaultKeyProvider,
  DockerSecretsKeyProvider,
  createKeyProvider,
  getDefaultKeyProvider
};