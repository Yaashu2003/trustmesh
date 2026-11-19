# TrustMesh

TrustMesh is a working local prototype for pre-settlement UPI fraud screening. It combines a synthetic four-bank payment network, three risk agents, an orchestration policy, an interactive entity knowledge graph, analyst review, a fraud registry, and a hash-linked local audit/block journal.

For click-by-click instructions, three illustrated scenarios and how to explore the knowledge graph, see the [TrustMesh user guide](docs/USER_GUIDE.md). For the component map, graph model, decision flow, local run instructions and sample request walkthrough, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Run

Requires Node.js 20 or newer. The prototype uses only Node's built-in modules.

```powershell
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). By default the server generates 300,000 synthetic transactions at startup. Set `TRUSTMESH_TRANSACTIONS` to a value from 1,000 through 500,000 to change the size, and `PORT` to change the local port.

## Workbench

- Screen a payment from a synthetic account to another account or merchant.
- Add new-device, SIM-change, impossible-travel, and scripted-interaction signals.
- Explore the knowledge graph: directed payment edges, shared-device/SIM identity links, account/merchant/device/SIM nodes, and entity inspection.
- Review held payments. Analyst approval commits them; rejection adds the payee to the fraud registry.
- Inspect recent decisions, review queue, registry, and the tamper-evident audit trail.

## Try these sample payments

Enter the IDs and amount in the workbench. Optional signal checkboxes are off unless noted. These examples use seeded synthetic entities; expected outcomes below were checked against the local agent pipeline.

| Scenario | Sender | Payee | Amount | Signals | Expected result |
|---|---|---|---:|---|---|
| Familiar purchase | `acc_000001` | `mer_001` | ₹750 | None | **APPROVE** (low risk) |
| New device and SIM | `acc_000001` | `mer_001` | ₹1,500 | Enable **New or unrecognised device** and **SIM changed recently** | **HOLD** for analyst review |
| Mule ring transfer | `mule_01_a` | `mule_01_b` | ₹9,850 | Enable all four signals | **BLOCK** before settlement |

For the HOLD example, open **Review queue** to approve or reject the payment. For the mule-ring case, the graph starts on `mule_01_a`; click **Network overview** to return there after navigating elsewhere.

The same screening API accepts these JSON bodies at `POST /api/transactions/analyze`:

```json
{"from":"acc_000001","to":"mer_001","amount":750}
```

```json
{"from":"acc_000001","to":"mer_001","amount":1500,"newDevice":true,"newSim":true}
```

```json
{"from":"mule_01_a","to":"mule_01_b","amount":9850,"newDevice":true,"newSim":true,"impossibleTravel":true,"scriptedInput":true}
```

## Backend

- `server.js` — HTTP API, synthetic network initialization, transaction screening, decision persistence, review operations, and static UI host.
- `server/data-store.cjs` — deterministic seeded 300k-transaction network and indexed graph/search data.
- `server/agents/transaction-pattern.cjs` — amount, velocity, and time-of-day scoring.
- `server/agents/behavioral-biometric.cjs` — device, SIM, location-velocity, and device-sharing scoring.
- `server/agents/graph-network.cjs` — cross-bank cycle/fan-in analysis and two-hop message passing.
- `server/agents/orchestrator.cjs` — deterministic 0.85 veto and 0.60 hold policy.
- `server/storage/` — KeyDB-like profile cache and Yugabyte-style graph development adapters.
- `api/agent.proto` — gRPC inference boundary contract.
- `chaincode/trustmesh/` — Go chaincode contracts for transaction gate, fraud registry, and audit trail.

## API

- `GET /api/health`, `/api/overview`, `/api/graph`, `/api/search?q=...`
- `GET /api/entities/:id`, `/api/transactions`, `/api/reviews`, `/api/registry`, `/api/audit`, `/api/blocks`
- `POST /api/transactions/analyze` — run the three agents and orchestrator, then record approve/block/hold outcome.
- `POST /api/reviews/:id` — approve a held item and commit it.
- `POST /api/reviews/reject` — reject a held item and register its payee.

Decision records, registry changes, and approved local block records append to ignored files under `data/`.

## Integration boundary

This is a local prototype. The network, payments, and account identities are synthetic. The DRUNIX sandbox status labels the intended integration environment; this app does not claim to connect to live bank rails, a live DRUNIX peer network, KeyDB, YugabyteDB, gRPC, ONNX, or Kubernetes. The adapters and Go contracts are integration starting points; deployment credentials and network configuration are still required for live use.

### Run the on-chain DRUNIX smoke workflow

The [Yaashu2003/drunix fork](https://github.com/Yaashu2003/drunix) includes a manual GitHub Actions workflow: [TrustMesh on DRUNIX test network](https://github.com/Yaashu2003/drunix/actions/workflows/trustmesh-testnet-smoke.yml). Open the **Actions** tab, select that workflow, and choose **Run workflow**. It uses a standard public Ubuntu runner, builds the DRUNIX tools, starts the two-organization test network, deploys this repository's TrustMesh chaincode, screens three synthetic payments through the Node API, submits the actual decisions to the test peer, and queries the payment and audit records back from ledger state.

The runner is temporary and tears down the network after the run. These are real ledger writes in an isolated DRUNIX test network, not real UPI transfers. Standard GitHub-hosted runners are free for public repositories; the workflow doesn't use Docker Desktop subscriptions or paid services. See [GitHub Actions billing](https://docs.github.com/en/actions/concepts/billing-and-usage).

The workflow passed on 2026-11-19: familiar purchase `APPROVE`, new-device/SIM `HOLD`, and mule-ring `BLOCK` were each confirmed from both payment state and `AuditTrail`. See the [successful run](https://github.com/Yaashu2003/drunix/actions/runs/44453878225) and the [architecture guide](ARCHITECTURE.md) for transaction IDs.
