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
    participant FedMgr
    participant GitHub

    Client ->> MCP: GET .well-known
    MCP -->> Client: entity statement JWS
    Note right of Client: Verify signature and trust marks\nSpec 5.4 and 7

    Client ->> GitHub: OAuth authorize
    GitHub -->> Client: auth code

    Client ->> FedMgr: POST token exchange
    FedMgr -->> Client: federated JWT

    Client ->> MCP: Bearer JWT
    Note right of MCP: Validate JWT with cached anchor keys\nSpec 5.2.1
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
