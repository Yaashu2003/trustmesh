# TrustMesh prototype: what runs and how the pieces connect

TrustMesh is a synthetic UPI pre-settlement fraud-screening prototype. It is not connected to live bank rails. The app runs as a Node.js process; its DRUNIX chaincode was also deployed and exercised against a local two-organization Docker test network and the public GitHub Actions test network.

## Components

| Layer | What is present | What it does |
|---|---|---|
| Frontend | `public/index.html`, `public/app.js`, `public/app.css` | Analyst workbench for payment screening, knowledge-graph exploration, review queue, recent decisions, fraud registry and audit history. It calls the local JSON API. |
| HTTP/API backend | `server.js` | Serves the UI and API, validates/analyzes incoming payment requests, coordinates agents, stores decision/review state, and exposes graph/search/audit endpoints. |
| Synthetic data | `server/data-store.cjs` | Creates deterministic accounts, merchants, devices, SIM identities, banks and payment edges. Default is 300,000 synthetic transactions; configurable up to 500,000. |
| Transaction-pattern agent (TVP) | `server/agents/transaction-pattern.cjs` | Scores amount vs account average, recent outgoing velocity and unusual payment hour. |
| Behavioral agent | `server/agents/behavioral-biometric.cjs` | Scores new device/SIM, impossible travel, scripted interaction and device sharing. |
| Graph/network agent | `server/agents/graph-network.cjs` | Evaluates payment cycles, fan-in, pass-through behavior, shared-device links and two-hop risk propagation over the entity graph. |
| Decision orchestrator | `server/agents/orchestrator.cjs` | Blends the three scores. Any maximum score above 0.85 vetoes to `BLOCK`; otherwise blended risk above 0.60 becomes `HOLD`; remaining payments are `APPROVE`. |
| Local storage adapters | `server/storage/` and `data/` | In-memory KeyDB-like profile and graph adapters support the prototype. Local decisions, reviews and audit/registry records persist under `data/` (ignored by Git). These are not deployed KeyDB/YugabyteDB services. |
| Ledger contracts | `chaincode/trustmesh/*.go` | Go chaincode defines `TransactionGate`, `FraudRegistry`, and `AuditTrail`. `Evaluate` checks score ranges and deterministic policy, checks the registry, prevents duplicate transaction IDs, and writes the decision and audit record to ledger state. |
| DRUNIX network integration | `drunix-platform/` fork + GitHub Actions workflow | Builds DRUNIX, starts its two-organization test network, deploys TrustMesh chaincode, submits synthetic screening results, and queries ledger state back. Workflow runs are temporary and do not move money. |

## Knowledge graph

The graph is an entity relationship view, not a standard chart. Nodes represent synthetic accounts, merchants, devices and SIM identities. Directed edges represent payments; identity links represent shared device/SIM evidence. Selecting an entity focuses the graph and its details. Risk analysis uses recent payment structure, including cycles, high fan-in and near-balanced pass-through flows, plus shared-device links. The UI graph is served by `GET /api/graph`; entity detail/search use `GET /api/entities/:id` and `GET /api/search?q=...`.

## Payment decision flow

1. The frontend posts a payment and optional risk signals to `POST /api/transactions/analyze`.
2. The backend constructs a synthetic transaction and runs TVP, behavioral and graph agents.
3. The orchestrator returns `APPROVE`, `HOLD` or `BLOCK` with scores and explanations.
4. The workbench displays the result. `HOLD` goes to analyst review; approval commits the prototype decision, while rejection blocks and adds the payee to the local registry.
5. In the separate DRUNIX workflow, the same Node API screens three scenarios. The workflow submits a privacy-preserving attestation with account hashes and scores to `TransactionGate:Evaluate`, then queries both `TransactionGate:ReadDecision` and `AuditTrail:Read` from a peer.

## Run locally

Requirements: Node.js 20 or newer. No Docker is required for the local UI and synthetic screening prototype. Docker and Go 1.26.1 are required for the optional DRUNIX ledger network.

```powershell
npm start
```

Open `http://127.0.0.1:4173`. To choose a smaller dataset, set `TRUSTMESH_TRANSACTIONS` before starting (for example `5000`); `PORT` changes the port and `HOST` controls the bind address (defaults to `127.0.0.1`). The in-memory graph is rebuilt at startup. Decision/audit files under `data/` persist between starts.

## Example inputs

Screen these in the frontend payment form. Signal checkboxes are false unless enabled. These seeded examples are also in the README.

| Scenario | Sender → recipient | Amount | Signals | Expected |
|---|---|---:|---|---|
| Familiar purchase | `acc_000001` → `mer_001` | ₹750 | None | `APPROVE` |
| New device and SIM | `acc_000001` → `mer_001` | ₹1,500 | `newDevice`, `newSim` | `HOLD` |
| Mule-ring transfer | `mule_01_a` → `mule_01_b` | ₹9,850 | `newDevice`, `newSim`, `impossibleTravel`, `scriptedInput` | `BLOCK` |

The API equivalents are:

```json
{"from":"acc_000001","to":"mer_001","amount":750}
```

```json
{"from":"acc_000001","to":"mer_001","amount":1500,"newDevice":true,"newSim":true}
```

```json
{"from":"mule_01_a","to":"mule_01_b","amount":9850,"newDevice":true,"newSim":true,"impossibleTravel":true,"scriptedInput":true}
```

For a reviewable network-ledger example, start the manual workflow [here](https://github.com/Yaashu2003/drunix/actions/workflows/trustmesh-testnet-smoke.yml). It submits the same three cases and prints transaction IDs and ledger verification in the run summary. The public runner is temporary; its test ledger is removed when the workflow tears down the network.

The local DRUNIX network uses the fork in `drunix-platform/`, Docker Compose services for two organizations (peers/orderer, YugabyteDB and KeyDB), and the Go contracts in `chaincode/trustmesh/`. It was started locally through Docker Desktop and Ubuntu 24.04 WSL. Because Docker Desktop exposes its WSL engine through a proxy socket on this machine, the local Compose setup uses Docker Desktop's `/run/desktop/mnt/host` mount paths. That is a machine-specific setup; the public workflow provides the portable, reproducible network setup.

### Verified DRUNIX run

On 2026-11-19, workflow run [44453878225](https://github.com/Yaashu2003/drunix/actions/runs/44453878225) completed successfully. Each transaction was submitted to the two-organization DRUNIX test network and then read back from both `TransactionGate` and `AuditTrail`:

| Example | Ledger transaction ID | Decision | Result |
|---|---|---|---|
| Familiar purchase | `screen_faf345b4-027` | `APPROVE` | Verified in payment state and audit history |
| New device and SIM | `screen_97211460-d0e` | `HOLD` | Verified in payment state and audit history |
| Mule-ring transfer | `screen_20fa4dd6-6cc` | `BLOCK` | Verified in payment state and audit history |

These IDs are from that ephemeral run; later workflow runs generate new IDs and a fresh ledger.

### Verified local Docker run

On 2026-11-19, the local Docker network started, deployed TrustMesh, and accepted the same three API-screened scenarios. Each result was queried back from `TransactionGate` and `AuditTrail`:

| Example | Local ledger transaction ID | Decision | Result |
|---|---|---|---|
| Familiar purchase | `screen_6442e5d0-eba` | `APPROVE` | Verified in payment state and audit history |
| New device and SIM | `screen_0eace015-3df` | `HOLD` | Verified in payment state and audit history |
| Mule-ring transfer | `screen_9b4732e6-57f` | `BLOCK` | Verified in payment state and audit history |

The local network is a developer sandbox. These writes do not touch real payment rails; restarting it with cleared volumes creates a fresh ledger.

## API map

- `GET /api/health`, `/api/overview`
- `GET /api/graph?focus=...&hops=...`, `/api/entities/:id`, `/api/search?q=...`
- `GET /api/transactions`, `/api/reviews`, `/api/registry`, `/api/audit`, `/api/blocks`
- `POST /api/transactions/analyze`
- `POST /api/reviews/:id` to approve a held payment; `POST /api/reviews/reject` to reject it and register the payee

## Scope and deployment boundary

The local workbench and synthetic scoring API are runnable now. The public workflow is the real DRUNIX test-ledger integration path. The prototype does not claim live UPI access, production identity verification, deployed KeyDB/YugabyteDB, hosted gRPC inference, ONNX model serving, Kubernetes orchestration, or a persistent production DRUNIX network. Those require real services, credentials, infrastructure and security review.
