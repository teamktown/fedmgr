/**
 * OpenBao/Vault Transit signing provider for OpenID Federation.
 *
 * Ontology:
 * - OpenID Federation entity statements and trust marks are signed JWT/JWS values.
 * - KMS providers implement the local signing authority for Trust Anchors (TA),
 *   Trust Mark Issuers (TMI), and MCP federation entities.
 * - Production deployments should prefer Transit signing so callers never receive
 *   private key material. KV-v2 storage is suitable only for local migration and
 *   dev fixtures.
 *
 * Spec mapping:
 * - OpenID Federation 1.0 entity statements require `jwks` and signed JWTs.
 * - This provider supplies JWKS and RS256 signing without exporting private keys.
 */
import { createPublicKey, generateKeyPairSync, createSign, type KeyObject } from "node:crypto";
import { type JWK, type JWTPayload } from "jose";
import { type KeyProvider } from "../index.js";

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function fromVaultSignature(signature: string): Buffer {
  const parts = signature.split(":");
  const encoded = parts.length === 3 && parts[0] === "vault" ? parts[2] : signature;
  return Buffer.from(encoded, "base64");
}

export interface OpenBaoTransitClient {
  ensureKey(keyName: string): Promise<void>;
  publicJwk(keyName: string): Promise<JWK>;
  sign(keyName: string, signingInput: string): Promise<Buffer>;
}

export type OpenBaoTransitConfig = {
  /** OpenBao/Vault base URL, for example http://openbao:8200. */
  url?: string;
  /** Token used for Transit API calls. */
  token?: string;
  /** Transit mount path; defaults to `transit`. */
  mount?: string;
  /** Transit key name; defaults to `fedmgr-oidf-signing`. */
  keyName?: string;
  /** Issuer entity ID using this key. */
  issuer: string;
  /** Optional injected client for unit tests or non-HTTP deployments. */
  client?: OpenBaoTransitClient;
};

export class HttpOpenBaoTransitClient implements OpenBaoTransitClient {
  private readonly url: string;
  private readonly token?: string;
  private readonly mount: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: { url: string; token?: string; mount?: string; fetchFn?: typeof fetch }) {
    this.url = opts.url.replace(/\/+$/, "");
    this.token = opts.token;
    this.mount = (opts.mount ?? "transit").replace(/^\/+|\/+$/g, "");
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(this.token ? { "x-vault-token": this.token } : {}),
    };
  }

  private endpoint(path: string): string {
    return `${this.url}/v1/${this.mount}/${path.replace(/^\/+/, "")}`;
  }

  async ensureKey(keyName: string): Promise<void> {
    const read = await this.fetchFn(this.endpoint(`keys/${encodeURIComponent(keyName)}`), {
      headers: this.headers(),
    });
    if (read.ok) return;
    if (read.status !== 404) {
      throw new Error(`OpenBao transit key read failed: HTTP ${read.status} ${await read.text()}`);
    }
    const create = await this.fetchFn(this.endpoint(`keys/${encodeURIComponent(keyName)}`), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ type: "rsa-2048", exportable: false, allow_plaintext_backup: false }),
    });
    if (!create.ok) {
      throw new Error(`OpenBao transit key create failed: HTTP ${create.status} ${await create.text()}`);
    }
  }

  async publicJwk(keyName: string): Promise<JWK> {
    const response = await this.fetchFn(this.endpoint(`keys/${encodeURIComponent(keyName)}`), {
      headers: this.headers(),
    });
    if (!response.ok) {
      throw new Error(`OpenBao transit public key read failed: HTTP ${response.status} ${await response.text()}`);
    }
    const body = await response.json() as { data?: { keys?: Record<string, { public_key?: string }> } };
    const versions = body.data?.keys ?? {};
    const latest = Object.keys(versions).sort((a, b) => Number(b) - Number(a))[0];
    const pem = latest ? versions[latest]?.public_key : undefined;
    if (!pem) {
      throw new Error(`OpenBao transit key ${keyName} did not expose a public_key`);
    }
    const jwk = createPublicKey(pem).export({ format: "jwk" }) as JWK;
    return { ...jwk, kid: keyName, use: "sig", alg: "RS256" };
  }

  async sign(keyName: string, signingInput: string): Promise<Buffer> {
    const response = await this.fetchFn(this.endpoint(`sign/${encodeURIComponent(keyName)}`), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        input: Buffer.from(signingInput).toString("base64"),
        hash_algorithm: "sha2-256",
        signature_algorithm: "pkcs1v15",
      }),
    });
    if (!response.ok) {
      throw new Error(`OpenBao transit sign failed: HTTP ${response.status} ${await response.text()}`);
    }
    const body = await response.json() as { data?: { signature?: string } };
    if (!body.data?.signature) {
      throw new Error("OpenBao transit sign response did not include data.signature");
    }
    return fromVaultSignature(body.data.signature);
  }
}

export class MemoryOpenBaoTransitClient implements OpenBaoTransitClient {
  private readonly keys = new Map<string, { privateKey: KeyObject; publicKey: KeyObject }>();

  async ensureKey(keyName: string): Promise<void> {
    if (this.keys.has(keyName)) return;
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    this.keys.set(keyName, pair);
  }

  async publicJwk(keyName: string): Promise<JWK> {
    await this.ensureKey(keyName);
    const pair = this.keys.get(keyName)!;
    const jwk = pair.publicKey.export({ format: "jwk" }) as JWK;
    return { ...jwk, kid: keyName, use: "sig", alg: "RS256" };
  }

  async sign(keyName: string, signingInput: string): Promise<Buffer> {
    await this.ensureKey(keyName);
    const pair = this.keys.get(keyName)!;
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    return signer.sign(pair.privateKey);
  }
}

export class OpenBaoTransitProvider implements KeyProvider {
  private readonly cfg: OpenBaoTransitConfig;
  private readonly keyName: string;
  private readonly client: OpenBaoTransitClient;

  constructor(cfg: OpenBaoTransitConfig) {
    this.cfg = cfg;
    this.keyName = cfg.keyName ?? "fedmgr-oidf-signing";
    if (cfg.client) {
      this.client = cfg.client;
    } else {
      if (!cfg.url) throw new Error("OpenBaoTransitProvider requires url or client");
      this.client = new HttpOpenBaoTransitClient({ url: cfg.url, token: cfg.token, mount: cfg.mount });
    }
  }

  async kid(): Promise<string> {
    await this.client.ensureKey(this.keyName);
    return this.keyName;
  }

  async jwks(): Promise<{ keys: JWK[] }> {
    await this.client.ensureKey(this.keyName);
    return { keys: [await this.client.publicJwk(this.keyName)] };
  }

  async signJwt(payload: JWTPayload, additionalHeader: Record<string, unknown> = {}): Promise<string> {
    await this.client.ensureKey(this.keyName);
    const header = { alg: "RS256", typ: "JWT", kid: await this.kid(), ...additionalHeader };
    const claims = { iss: this.cfg.issuer, ...payload };
    const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
    const signature = await this.client.sign(this.keyName, signingInput);
    return `${signingInput}.${signature.toString("base64url")}`;
  }
}
