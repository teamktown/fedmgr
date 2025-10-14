# Developer Guide: Container User, Permissions, and Volume Mounts

This guide provides best practices and considerations for handling user permissions and mounted volumes in Docker and Kubernetes environments for the `fedmgr` project.

---

## 1. Container User and Permissions in Docker

- **Non-root User:**  
  Always run your application as a non-root user inside the container for security.  
  Example in Dockerfile:
  ```dockerfile
  RUN addgroup -S appgroup && adduser -S appuser -G appgroup
  USER appuser
  ```

- **Directory Creation and Ownership:**  
  Create necessary directories and set ownership **before** switching to the non-root user:
  ```dockerfile
  RUN mkdir -p /usr/src/app/federations /usr/src/app/data \
      && chown -R appuser:appgroup /usr/src/app/federations /usr/src/app/data
  USER appuser
  ```

- **Mounted Volumes:**  
  If you mount a host directory (e.g., with `-v /host/path:/usr/src/app/federations`), the files/directories retain their host ownership and permissions.  
  If `appuser` inside the container does **not** have permission to write to the mounted directory, you will get permission errors.

### How to Avoid Permission Problems

- **Match UID/GID:**  
  Make sure the UID/GID of `appuser` in the container matches the owner of the directory on the host.  
  Example:
  ```dockerfile
  RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -S appuser
  ```
  On the host:
  ```bash
  sudo chown -R 1001:1001 /host/path
  ```

- **Set Host Permissions:**  
  Alternatively, make the host directory world-writable (less secure, not recommended for production):
  ```bash
  chmod -R a+rwx /host/path
  ```

- **Use Docker Compose `user:` Option:**  
  Run the container as a specific UID/GID that matches the host directory owner:
  ```yaml
  services:
    federation-admin:
      user: "1001:1001"
  ```

---

## 2. Kubernetes Workloads: Abstracting Permissions

- **Use `securityContext`:**  
  In your Kubernetes manifest, set the `securityContext` for your Pod or container to match the UID/GID of `appuser`:
  ```yaml
  securityContext:
    runAsUser: 1000      # UID of appuser
    runAsGroup: 1000     # GID of appgroup
    fsGroup: 1000        # Ensures mounted volumes are owned by this group
  ```

  - `runAsUser`/`runAsGroup`: Ensures the container runs as the specified user/group.
  - `fsGroup`: Ensures all files in mounted volumes are owned by this group, so your appuser can read/write.

- **No Need to `chown` in Dockerfile for Mounted Volumes:**  
  Kubernetes will handle it via `fsGroup`.  
  Keep your Dockerfile clean and portable, focusing only on app logic.

- **Document Required UID/GID:**  
  Document the required UID/GID for your appuser (e.g., 1000) so cluster admins can set up volumes accordingly.

---

## 3. Summary Table

| Scenario                                 | Will it work? | Notes                                      |
|-------------------------------------------|:-------------:|---------------------------------------------|
| Host dir owned by root, container as appuser | ❌            | Permission denied for writes                |
| Host dir owned by same UID as appuser     | ✅            | Works fine                                  |
| Host dir world-writable                  | ✅            | Works, but less secure                      |
| Use `user:` in Compose to match host UID  | ✅            | Works if UID matches host dir owner         |
| Use `fsGroup` in Kubernetes               | ✅            | Abstracts permissions for PVCs              |

---

## 4. Best Practices

- Do privileged operations (like `mkdir` and `chown`) as root in the Dockerfile, before switching to `USER appuser`.
- Switch to `USER appuser` only after those steps.
- For Kubernetes, use `securityContext` with `runAsUser` and `fsGroup` to abstract away host-specific permissions.
- Avoid hardcoding `chown/chmod` for mount points in the Dockerfile; let Kubernetes handle it.
- Document the required UID/GID for your images.

---

**References:**  
- [Kubernetes securityContext docs](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/)
- [Dockerfile best practices](https://docs.docker.com/develop/develop-images/dockerfile_best-practices/)


# Client validation flow

```mermaid
flowchart LR
    U["User"]
    MCP["MCP Endpoint"]
    FM["FedMgr"]

    U   -->| 1_GET_wellknown | MCP
    MCP -->| 2_entity_statement_with_marks | U
    U   -->| 3_verify_marks | U
    U   -->| 4_OAuth_flow | FM
    FM  -->| 5_federation_JWT | U
    U   -->| 6_Bearer_JWT | MCP
```

# Client flow as sequence diagram - not quite right
```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant MCP
    participant FM as FedMgr
    participant GH as GitHub

    C->>MCP: GET .well-known
    MCP-->>C: entity statement
    note right of C: Eval A – verify signature and required trust-marks

    C->>GH: Authorize request
    GH-->>C: Auth code

    C->>FM: POST /callback (code)
    FM-->>C: Federation JWT
    note right of C: Eval B – cache JWT for subsequent calls

    C->>MCP: Bearer JWT
    MCP->>FM: Validate JWT
    FM-->>MCP: OK
    MCP-->>C: Protected response
```

# client sequence diagram - improved flow, Client gets the trust marks first.
```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant MCP
    participant Fed-gateway
    participant GitHub

    Client ->> MCP: GET .well-known
    MCP -->> Client: entity statement JWS
    Note right of Client: Verify signature and trust marks - Spec 5.4 and 7

    Client ->> GitHub: OAuth authorize
    GitHub -->> Client: auth code

    Client ->> Fed-gateway: POST token exchange
    Fed-gateway -->> Client: federated JWT

    Client ->> MCP: Bearer JWT
    Note right of MCP: Validate JWT with cached anchor keys - Spec 5.2.1
    MCP -->> Client: protected response

```

# client sequent diagram - user is limited to trust marks at JWT minting time

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant GitHub
    participant FedMgr
    participant CA_Sandbox
    participant CA_Prod_EU
    participant MCP

    Client ->> GitHub: OAuth authorize
    GitHub -->> Client: auth code

    Client ->> FedMgr: token exchange request
    FedMgr ->> FedMgr: evaluate user policy
    alt user gets sandbox mark
        FedMgr ->> CA_Sandbox: request sign MyOrgFed_sandbox
        CA_Sandbox -->> FedMgr: signed trust mark
    else user gets prod eu mark
        FedMgr ->> CA_Prod_EU: request sign MyOrgFed_production_eu
        CA_Prod_EU -->> FedMgr: signed trust mark
    end
    FedMgr -->> Client: JWT with allowed trust marks

    Client ->> MCP: GET wellknown
    MCP -->> Client: entity statement
    Client ->> Client: verify signature and required marks

    Client ->> MCP: Bearer JWT
    MCP -->> Client: protected response
```

# Time bound trust mark assignment
```mermaid
sequenceDiagram
    autonumber
    participant User
    participant GitHub
    participant FedMgr
    participant MCP

    User->>GitHub: OAuth login
    GitHub-->>User: auth code

    User->>FedMgr: token exchange request
    FedMgr->>FedMgr: evaluate policy (Mon-Fri 09-17)
    alt within window
        FedMgr-->>User: JWT + trust_mark + exp=next_boundary
    else outside window
        FedMgr-->>User: JWT without mark
    end

    User->>MCP: call with JWT
    MCP->>MCP: check mark and exp
```


```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant GitHub
    participant FedMgr
    participant CA_Sandbox
    participant MCP

    %% user authenticates
    Client ->> GitHub: OAuth_authorize
    GitHub -->> Client: auth_code

    %% branch: obtain upstream credential
    alt Direct_code_path
        Client ->> FedMgr: auth_code   %% FedMgr swaps for ID-Token internally
    else JAG_token_exchange_path
        Client ->> GitHub: token_endpoint   %% code to ID-Token
        Client ->> GitHub: rfc_8693_exchange %% ID-Token to JAG_JWT
        Client ->> FedMgr: JAG_JWT           %% jwt-bearer grant
    end

    %% FedMgr policy & trust-mark selection
    FedMgr ->> FedMgr: evaluate_user_policy
    alt sandbox_mark
        FedMgr ->> CA_Sandbox: sign_MyOrgFed_sandbox
        CA_Sandbox -->> FedMgr: sandbox_mark
    else prod_mark
        %% prod delegate CA not shown for brevity
    end

    FedMgr -->> Client: federation_JWT_with_marks

    %% client preflight
    Client ->> MCP: GET_wellknown
    MCP -->> Client: entity_statement
    Client ->> Client: verify_signature_and_required_marks

    %% API call
    Client ->> MCP: Bearer_JWT
    MCP -->> Client: protected_response
```



# High performance arch
```mermaid
flowchart LR
    LB[NGINX ingress] --> AS1 & AS2 & AS3
    subgraph FedMgr_AS stateless
        AS1[Auth Server] --> Redis[(token store)]
        AS2 --> Redis
        AS3 --> Redis
    end
    Dev-->VSCode -- federated JWT --> MCP_Pods
    MCP_Pods -- JWKS cache --> signed_jwks_uri_S3
    MCP_Pods -- policy --> OPA_Sidecar
    MCP_Pods -- Vault login --> VaultCluster
```

## full flow sept 11, 2025

```mermaid
sequenceDiagram
autonumber
participant UA as User Agent (Browser)
participant RP as OrgB-RPmcp (RP)
participant FRP as FedResolver-RP (fedmgr @ OrgB)
participant OP as OrgA-OP (OP)
participant FOP as FedResolver-OP (fedmgr @ OrgA)
participant TA as TAOmega (Trust Anchor)

%% ------------------------------------------------------------
%% 0) OUT-OF-BAND SETUP (publish once; refreshed by TTL)
%% ------------------------------------------------------------
note over OP,TA: Prepublished artifacts (federation layer):
note over OP: Entity Configuration (EC) at\nhttps://op.orga.example/.well-known/openid-federation\n• iss==sub==https://op.orga.example\n• jwks (federation keys), metadata (OP), authority_hints: [https://ta.fedomega.example]
note over RP: Entity Configuration (EC) at\nhttps://rp.orgb.example/.well-known/openid-federation\n• iss==sub==https://rp.orgb.example\n• jwks (federation keys), metadata (RP), authority_hints: [https://ta.fedomega.example]
note over TA: TAOmega EC at\nhttps://ta.fedomega.example/.well-known/openid-federation\n• iss==sub==https://ta.fedomega.example\n• jwks (anchor keys), federation policy

%% ------------------------------------------------------------
%% 1) USER BEGINS SIGN-IN FLOW AT RP
%% ------------------------------------------------------------
UA->>RP: Navigate to protected resource (requires sign-in)
note over RP: RP chooses OrgA-OP as login provider (preconfigured or via discovery)

%% ------------------------------------------------------------
%% 2) RP PRE-FLIGHT: RESOLVE & TRUST OP (Federation layer)
%% ------------------------------------------------------------
RP->>FRP: Resolve OP entity: "https://op.orga.example"
FRP->>OP: GET /.well-known/openid-federation (OP EC)
FRP->>TA: GET Entity Statement(s) about OP (chain links)
FRP->>FRP: Validate signatures, iss/sub, exp; build trust chain
FRP->>FRP: Enforce policy (required trust marks, profiles, constraints)
FRP-->>RP: Decision {allow|deny}, chain_hash, vetted OP metadata, TTL
note over RP,FRP: Cache decision/metadata until TTL expiry.\nIf deny → abort here with user-friendly error.

%% ------------------------------------------------------------
%% 3) IF NEEDED: FEDERATION-BASED DYNAMIC CLIENT REGISTRATION
%%    (OP validates RP’s federation posture; may auto-issue client_id)
%% ------------------------------------------------------------
alt Client not yet registered at OP
  RP->>OP: Registration request (per OIDC-Fed; includes RP entity_id)
  OP->>FOP: Resolve RP entity: "https://rp.orgb.example"
  FOP->>RP: GET RP EC
  FOP->>TA: GET Entity Statement(s) about RP (chain links)
  FOP->>FOP: Validate chain; apply metadata policy (constraints/overrides)
  FOP-->>OP: Decision {allow|deny}, vetted RP metadata
  alt Allow
    OP-->>RP: Registration response (client_id, client metadata)
    note over OP,RP: OP stores registration; RP stores client_id & endpoints.\nKeys for federation artifacts remain separate from runtime OIDC keys.
  else Deny
    OP-->>RP: Registration denied (policy reasons)
    RP-->>UA: Stop flow (cannot use this OP under current policy)
  end
else Already registered
  note over OP,RP: Skip registration; RP uses stored client_id and OP endpoints.
end

%% ------------------------------------------------------------
%% 4) RUNTIME OIDC: AUTHORIZATION CODE + PKCE SIGN-IN
%%    (Tokens are runtime artifacts; do not carry trust marks)
%% ------------------------------------------------------------
RP->>UA: Redirect to OP /authorize (client_id, redirect_uri, scope=openid, state, nonce, code_challenge, ...)
note over UA,OP: (Optional) PAR: RP first posts request to OP PAR endpoint; OP returns request_uri used at /authorize

UA->>OP: GET /authorize (Auth Code + PKCE request)
OP->>UA: Authenticate user (OrgA identity: login + MFA as required)
OP-->>UA: Redirect back to RP with code & state

UA->>RP: Return with code & state
RP->>OP: POST /token (code, code_verifier, client_auth per registration)
OP-->>RP: 200 OK { id_token, access_token, token_type, expires_in, ... }

%% ------------------------------------------------------------
%% 5) RP VALIDATES ID TOKEN (client-facing JWT)
%% ------------------------------------------------------------
RP->>FRP: (If JWKS not cached) fetch/confirm OP JWKS from vetted metadata
RP->>RP: Validate id_token: iss(https://op.orga.example), aud(client_id), azp (if multi-aud), exp/iat, nonce, sig
note over RP: Access token is opaque to client; only RS should interpret it.\nIf RP calls /userinfo, it will pass the access token to OP’s UserInfo endpoint.

%% ------------------------------------------------------------
%% 6) (OPTIONAL) CALL USERINFO OR AN API (RS)
%% ------------------------------------------------------------
alt Call OP UserInfo
  RP->>OP: GET /userinfo (Authorization: Bearer <access_token>)
  OP-->>RP: User claims (per granted scopes)
else Call other API (e.g., an MCP Server)
  note over RP,FRP: Repeat federation pre-flight for that API entity_id.\nNo required trust marks → do not connect.
end

%% ------------------------------------------------------------
%% 7) HOUSEKEEPING / GOVERNANCE
%% ------------------------------------------------------------
note over RP,FRP: Persist chain_hash, decision, and expiry for audit.\nRe-resolve on TTL expiry or key rotation.\nKeep federation keys separate from runtime OIDC signing keys.
```


## OpenID Federation in 15 sec

```mermaid
graph TD
  A[Entities OP / RP / RS] -- publish --> EC[Entity Configuration\n well-known, signed]
  EC -. authority_hints .-> I[Intermediary - optional]
  I -->|Entity Statement| TA[Trust Anchor]
  A -->|Trust Mark requests| MI[Mark Issuer]
  MI -->|Trust Marks - JWT| A

  subgraph "Verifier"
    R1[Resolve chain:\nfetch EC → follow statements → TA]
    R2[Validate:\nsignatures • iss/sub • exp]
    R3[Verify marks:\nissuer under TA • sub=entity_id • id/attrs • TTL]
    R4[Policy-as-code:\nrequired marks • min TTL • attrs]
    R5{Decision}
  end

  A -. consumed by .-> R1
  MI -. marks to verify .-> R3
  TA -. anchor keys/policy .-> R2

  R1 --> R2 --> R3 --> R4 --> R5
  R5 -- DENY --> X[[Stop: do not connect]]
  R5 -- ALLOW --> RUN[Proceed with OAuth2/OIDC runtime: Auth Code + PKCE • strict aud]

  style RUN fill:#E8F7FF,stroke:#3A87C6,stroke-width:1px
  style R5 fill:#FFFBE6,stroke:#D6B656,stroke-width:1px
  style TA fill:#F3F0FF,stroke:#7C6FF6,stroke-width:1px
  style MI fill:#F0FFF4,stroke:#2F8F4E,stroke-width:1px
```

## 15 sec OpenID Fed but WSD

```mermaid
sequenceDiagram
autonumber
participant Entity as Entity OP or RP or RS
participant MI as Mark Issuer
participant TA as Trust Anchor
participant GW as Verifier or Gateway fedmgr
participant RP as Client or RP
participant OP as OpenID Provider
participant RS as Resource Server

Note over Entity,TA: PUBLISH phase then rotate by TTL
Entity->>TA: Publish Entity Configuration at /.well-known/openid-federation
Entity->>MI: Request trust marks such as conformance signed image licensing
MI-->>Entity: Trust mark JWT for entity_id
TA-->>Entity: Optional entity statements and policy constraints

Note over GW: PRE FLIGHT who to trust
RP->>GW: Prepare to connect to target entity_id
GW->>Entity: Fetch Entity Configuration
GW->>TA: Fetch chain statements up to Trust Anchor
GW->>GW: Validate signatures and issuer and subject and expiry
GW->>GW: Verify trust marks issuer under anchor and subject equals entity_id and mark id and attributes and TTL
GW->>GW: Apply policy as code required marks and min TTL and attributes
GW-->>RP: Decision ALLOW or DENY

RP->>RP: If DENY then stop fail closed and do not connect
RP->>RP: If ALLOW then proceed to runtime OAuth and OIDC

Note over RP,OP: RUNTIME what you can do
RP->>OP: Authorization Code plus PKCE
OP-->>RP: Return code
RP->>OP: Token request with code and verifier
OP-->>RP: ID Token with aud equals client id and Access Token for RS

Note over RP,RS: Access Token is for RS and client treats it as opaque
RP->>RS: Call API with Access Token
RS-->>RP: Response per scopes and policy

Note over RP: Key principles
Note over RP: Federation is pre flight allow or deny via trust marks
Note over RP: Tokens stay per recipient with strict aud
Note over RP: No valid mark means no connect

```


## Reviewed Sept18: The end state flow of MCP with OpenID Fed flow

```mermaid
sequenceDiagram
autonumber
participant BR as Browser
participant GW as Fedmgr Gateway client
participant AS as MCP Authorization Server
participant RS as MCP Resource Server
participant TA as Trust Anchor
participant MI as Mark Issuer

Note over GW,RS: PRE FLIGHT federation trust resolution
GW->>RS: Fetch Entity Configuration at well known openid federation
GW->>AS: Fetch Entity Configuration at well known openid federation
GW->>TA: Fetch chain statements up to anchor
GW->>MI: Fetch mark issuer keys and referenced marks if needed
GW->>GW: Validate signatures and issuer and subject and expiry
GW->>GW: Verify trust marks issuer under anchor and subject equals entity id and mark id and attributes and TTL
GW->>GW: Apply policy as code required marks and min TTL and attributes
GW-->>BR: Decision ALLOW or DENY
BR->>BR: If DENY then stop fail closed and do not connect

Note over BR,GW: If ALLOW continue with standard OAuth and OIDC login
GW->>RS: MCP request
RS-->>GW: HTTP 401 Unauthorized
GW-->>BR: Redirect to Authorization Server
BR->>AS: Start sign in
Note over BR,AS: User logs in and authorizes
AS-->>BR: Redirect with authorization code
BR-->>GW: Authorization code delivered to gateway
GW->>AS: Token request with authorization code
AS-->>GW: ID Token and Access Token

Note over GW,RS: Client treats Access Token as opaque and RS validates it
GW->>RS: MCP request with Access Token and optional trust evidence reference
RS-->>GW: Access granted

Note over GW,RS: Begin standard MCP message exchange

Note over GW: Federation decides who to trust via trust marks,  Tokens stay per recipient with strict aud, No valid mark means no connect
```

### Reasoning

In OpenID Federation, only entities that actually participate in federation are expected to publish /.well-known/openid-federation with a self-signed Entity Configuration where iss equals sub equals the entity_id.

Your Authorization Server only belongs in the federation pre flight if it is itself a federated OP or OAuth AS entity. If it is a plain OAuth AS, you do not fetch /.well-known/openid-federation from it; you use normal OIDC discovery later.

The Resource Server can be a federated entity such as an oauth resource. If it is not, you can still evaluate trust marks about that RS entity id that are issued under the anchor, but you would not expect to fetch an EC from it.

Correct validation order in pre flight is resolve chain via authority hints, verify EC signatures and exp, verify mark signatures under the anchor, confirm mark subject equals the entity id you intend to connect to, then apply policy. Only if ALLOW do you proceed to standard OAuth and OIDC.

### Conclusion/Recommendations

Treat AS federation discovery as optional and only when the AS participates as a federated OP or OAuth AS.

Keep RS discovery optional too; you may evaluate marks about RS even if the RS does not host an EC.

Make the ALLOW or DENY decision before the first RS request where possible. If you keep the initial 401 trigger, still perform pre flight first to avoid contacting an untrusted endpoint.


```mermaid
sequenceDiagram
autonumber
participant BR as Browser
participant GW as Fedmgr Gateway client
participant RS as MCP Resource Server
participant AS as MCP Authorization Server
participant TA as Trust Anchor
participant MI as Mark Issuer

Note over GW,RS: PRE FLIGHT federation trust decision

opt RS participates in federation
  GW->>RS: GET slash .well known slash openid federation
  GW->>TA: Fetch superior entity statements via authority hints
  GW->>GW: Validate EC signatures and issuer equals subject and expiry
end

GW->>MI: Fetch mark issuer keys and any referenced trust marks
GW->>GW: Verify trust marks issuer under anchor and subject equals RS entity id and mark id and attributes and TTL
GW->>GW: Apply policy as code required marks and min TTL and attributes
GW-->>BR: Decision ALLOW or DENY
BR->>BR: If DENY then stop fail closed and do not connect

opt AS participates in federation
  Note over GW,AS: Optional federation check for Authorization Server such as an OpenID Provider
  GW->>AS: GET slash .well known slash openid federation
  GW->>TA: Resolve chain and validate as above
  GW->>GW: Enforce any required marks on AS entity id
end

Note over BR,GW: If ALLOW continue with standard OAuth and OIDC login

GW->>RS: MCP request to target endpoint
RS-->>GW: HTTP 401 Unauthorized

GW-->>BR: Redirect to Authorization Server
BR->>AS: User starts sign in
Note over BR,AS: User logs in and authorizes
AS-->>BR: Redirect with authorization code
BR-->>GW: Authorization code delivered to gateway

GW->>AS: Token request with authorization code
AS-->>GW: ID Token and Access Token

Note over GW,RS: Client treats Access Token as opaque and RS validates it

GW->>RS: MCP request with Access Token and optional trust evidence reference
RS-->>GW: Access granted

Note over GW,RS: Begin standard MCP message exchange

Note over GW: Key principles
Note over GW: Federation decides who to trust using trust marks anchored at TA
Note over GW: Runtime tokens remain per recipient with strict aud
Note over GW: No valid mark means no connect
```

## Regular OpenID Federation path  

```mermaid
sequenceDiagram
autonumber
participant BR as Browser
participant GW as Fedmgr Gateway client
participant RS as MCP Resource Server
participant AS as MCP Authorization Server
participant TA as Trust Anchor
participant MI as Mark Issuer

Note over GW,RS: PRE FLIGHT federation trust decision


GW->>MI: Fetch mark issuer keys and any referenced trust marks
GW->>GW: Verify trust marks issuer under anchor and subject equals RS entity id and mark id and attributes and TTL
GW->>GW: Apply policy as code required marks and min TTL and attributes
GW-->>BR: Decision ALLOW or DENY
BR->>BR: If DENY then stop fail closed and do not connect


Note over BR,GW: If ALLOW continue with standard OAuth and OIDC login

GW->>RS: MCP request to target endpoint
RS-->>GW: HTTP 401 Unauthorized

GW-->>BR: Redirect to Authorization Server
BR->>AS: User starts sign in
Note over BR,AS: User logs in and authorizes
AS-->>BR: Redirect with authorization code
BR-->>GW: Authorization code delivered to gateway

GW->>AS: Token request with authorization code
AS-->>GW: ID Token and Access Token

Note over GW,RS: Client treats Access Token as opaque and RS validates it

GW->>RS: MCP request with Access Token and optional trust evidence reference
RS-->>GW: Access granted

Note over GW,RS: Begin standard MCP message exchange

```

### Key principles: 
Fed decides who to trust using trust marks anchored at TA, 
Runtime tokens remain per recipient with strict aud, 
No valid mark means no connect
