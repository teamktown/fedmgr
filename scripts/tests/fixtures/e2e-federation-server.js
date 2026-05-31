#!/usr/bin/env node
const express = require('express');
const fs = require('fs');
const path = require('path');

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

const name = argValue('--name', process.env.NAME || 'test-entity');
const port = Number(argValue('--port', process.env.PORT || 9000));
const registryFile = process.env.E2E_REGISTRY_FILE || path.join(process.cwd(), 'test-data', 'e2e-federation-registry.json');
const entityId = `http://localhost:${port}`;
const app = express();

app.use(express.json());

function readRegistry() {
  if (!fs.existsSync(registryFile)) return { entities: {}, distributed: false };
  return JSON.parse(fs.readFileSync(registryFile, 'utf8'));
}

function writeRegistry(registry) {
  fs.mkdirSync(path.dirname(registryFile), { recursive: true });
  fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2));
}

function entityConfiguration() {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: entityId,
    sub: entityId,
    iat: now,
    exp: now + 3600,
    metadata: {
      federation_entity: {
        organization_name: name,
        federation_fetch_endpoint: `${entityId}/.well-known/openid-federation`,
        trust_marks: ['https://letsfederate.dev/trust-mark/mcp-server/v1'],
      },
      mcp_server: {
        endpoint: entityId,
      },
    },
    authority_hints: [],
    jwks: { keys: [] },
  };
}

app.get('/.well-known/openid-federation', (_req, res) => {
  res.json(entityConfiguration());
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', name, entity_id: entityId });
});

app.post('/register', (req, res) => {
  const entity = req.body || {};
  const id = entity.entity_id || entity.sub;
  if (!id) return res.status(400).json({ success: false, error: 'entity_id required' });
  const registry = readRegistry();
  registry.entities[id] = { entity_id: id, metadata: entity.metadata || {}, registered_at: new Date().toISOString() };
  writeRegistry(registry);
  res.json({ success: true, entity_id: id });
});

app.post('/distribute-statements', (_req, res) => {
  const registry = readRegistry();
  registry.distributed = true;
  writeRegistry(registry);
  res.json({ success: true, distributed: Object.keys(registry.entities).length });
});

app.post('/verify-trust', (req, res) => {
  const registry = readRegistry();
  const id = req.body && req.body.entity_id;
  const known = !!(id && registry.entities[id]);
  res.json({
    valid: known && registry.distributed !== false,
    chain: known ? [entityId, id] : [],
    entity_id: id,
  });
});

const server = app.listen(port, () => {
  console.log(`[e2e-federation-server] ${name} listening on ${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
