/**
 * Authentication Commands for the fedmgr CLI
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');
const fetch = require('node-fetch');
const open = require('open');
require('dotenv').config();

// Use built-in fetch (Node.js 18+) or fallback to node-fetch
//const fetch = globalThis.fetch || require('node-fetch');

// OIDC and Federation defaults
const OIDC_PROVIDER_URL = process.env.OIDC_PROVIDER_URL || 'http://localhost:8080';
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID || 'fedmgr-cli';
const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || 'fedmgr-cli-secret';
const TOKEN_STORE_PATH = path.join(os.homedir(), '.fedmgr-tokens.json');

function getStoredTokens() {
  if (!fs.existsSync(TOKEN_STORE_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(TOKEN_STORE_PATH, 'utf-8')); }
  catch { console.error('Error reading token store'); return {}; }
}

function saveToken(provider, token) {
  const tokens = getStoredTokens(); tokens[provider] = token;
  fs.writeFileSync(TOKEN_STORE_PATH, JSON.stringify(tokens, null,2));
}

function getToken(provider) {
  const tokens = getStoredTokens(); return tokens[provider];
}

function deleteToken(provider) {
  const tokens = getStoredTokens(); delete tokens[provider];
  fs.writeFileSync(TOKEN_STORE_PATH, JSON.stringify(tokens, null,2));
}

async function localOidcLogin({username,password,opUrl=OIDC_PROVIDER_URL,clientId=OIDC_CLIENT_ID,clientSecret=OIDC_CLIENT_SECRET,federation='fed-alpha'}) {
  const discovery = await fetch(`${opUrl}/.well-known/openid-configuration`);
  if (!discovery.ok) throw new Error(`Failed to discover OIDC configuration: ${discovery.statusText}`);
  const cfg = await discovery.json();
  if (!cfg.token_endpoint) throw new Error('Missing token_endpoint');
  const tokenRes = await fetch(cfg.token_endpoint, { method:'POST', headers:{
    'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'
  }, body:new URLSearchParams({grant_type:'password',username,password,scope:'openid profile'}).toString() });
  if (!tokenRes.ok) {
    const errData = await tokenRes.json();
    throw new Error(`Authentication failed: ${errData.error_description || errData.error}`);
  }
  const token = await tokenRes.json(); token.federation=federation; token.provider='local-oidc-op'; token.timestamp=Date.now();
  return token;
}

async function clientCredentialsLogin({opUrl=OIDC_PROVIDER_URL,clientId=OIDC_CLIENT_ID,clientSecret=OIDC_CLIENT_SECRET,scope='openid profile',federation='fed-alpha'}) {
  const discovery = await fetch(`${opUrl}/.well-known/openid-configuration`);
  if (!discovery.ok) throw new Error('Failed OIDC discovery');
  const cfg = await discovery.json(); if (!cfg.token_endpoint) throw new Error('Missing token_endpoint');
  const tokenRes = await fetch(cfg.token_endpoint, { method:'POST', headers:{
    'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json',
    'Authorization':`Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
  }, body:new URLSearchParams({grant_type:'client_credentials',scope}).toString() });
  if (!tokenRes.ok) {
    const err = await tokenRes.text(); throw new Error(`Auth failed: ${err}`);
  }
  const token = await tokenRes.json(); token.federation=federation; token.provider='local-oidc-op'; token.timestamp=Date.now();
  return token;
}

/**
 * Register authentication commands with the CLI
 */
function registerAuthCommands(program) {
  program
    .command('login <provider>')
    .description('Authenticate with a provider (local-oidc-op, client-credentials, github)')
    .option('--username <user>','Username for local-oidc-op')
    .option('--password <pass>','Password for local-oidc-op')
    .option('--federation <fed>','Federation name','fed-alpha')
    .option('--op-url <url>','OIDC Provider URL',OIDC_PROVIDER_URL)
    .option('--client-id <id>','OAuth Client ID',OIDC_CLIENT_ID)
    .option('--client-secret <sec>','OAuth Client Secret',OIDC_CLIENT_SECRET)
    .action(async (provider, opts) => {
      try {
        let token;
        if (provider==='local-oidc-op') {
          if (!opts.username||!opts.password) {
            console.error('❌ Provide --username and --password'); process.exit(1);
          }
          console.log('🔐 Authenticating via local OIDC...');
          token = await localOidcLogin(opts);
        } else if (provider==='client-credentials') {
          console.log('🔐 Authenticating via client credentials...');
          token = await clientCredentialsLogin(opts);
        } else if (provider==='github') {
          const loginUrl = `http://localhost:3001/login`;
          console.log(`🔗 Opening browser for GitHub OAuth at ${loginUrl}`);
          await open(loginUrl);
          console.log('ℹ️ Complete login in browser and copy the token from the UI (#token=...)');
          console.log('Then run: fedmgr token github --show-value');
          process.exit(0);
        } else {
          console.error(`❌ Unsupported provider: ${provider}`);
          process.exit(1);
        }
        saveToken(provider, token);
        console.log('✅ Authentication successful');
        console.log(`📝 Token saved for ${provider}`);
      } catch(e) {
        console.error(`❌ Authentication error: ${e.message}`);
        process.exit(1);
      }
    });

  program
    .command('logout [provider]')
    .description('Remove stored tokens')
    .action(provider => {
      if (provider) {
        deleteToken(provider);
        console.log(`✅ Logged out from ${provider}`);
      } else {
        const toks=getStoredTokens(); Object.keys(toks).forEach(p=>deleteToken(p));
        console.log('✅ Logged out from all providers');
      }
    });

  program
    .command('token [provider]')
    .description('Show stored token info')
    .option('--show-value','Show the actual token')
    .action((provider, opts) => {
      const toks = getStoredTokens();
      if (provider) {
        const t = toks[provider];
        if (!t) return console.log(`No token for ${provider}`);
        console.log(`Provider: ${provider}\nFederation: ${t.federation}\nObtained: ${new Date(t.timestamp).toLocaleString()}`);
        if (opts.showValue) console.log(`Value: ${t.access_token||t.id_token}`);
      } else {
        Object.keys(toks).length
          ? Object.entries(toks).forEach(([p,t])=>console.log(`- ${p} (fed=${t.federation})`))
          : console.log('No tokens stored');
      }
    });
}

module.exports = {
  registerAuthCommands,
  getToken,
  saveToken,
  deleteToken,
  getStoredTokens,
  localOidcLogin
};
