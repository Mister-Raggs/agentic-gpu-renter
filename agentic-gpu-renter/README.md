# Agentic GPU Renter

Agentic payments demo for GPU rental using Fireworks, MongoDB, and x402-compatible mock vendors.

## Architecture

```mermaid
flowchart LR
  A[Client] --> B[/api/agent-start]
  A --> C[/api/agent-tick]
  A --> D[/api/agent-status]

  B --> DB[(MongoDB)]
  C --> DB
  D --> DB

  C --> P[Planner (Fireworks)]
  C --> V[Vendor API Client]
  V --> M[Mock GPU Vendor]

  subgraph State
    DB --> R[runs]
    DB --> J[jobs]
    DB --> PAY[payments]
    DB --> OBS[observations]
    DB --> VEN[vendors]
  end
```

## Env vars
Create `agentic-gpu-renter/.env` with:

```
MONGODB_URI=
MONGODB_DB_NAME=
FIREWORKS_API_KEY=
FIREWORKS_MODEL=accounts/fireworks/models/llama-v3-8b-instruct
X402_WALLET_ID=
X402_PRIVATE_KEY=
GPU_VENDOR_SECRET=
CDP_API_KEY_ID=
CDP_API_KEY_SECRET=
CDP_WALLET_SECRET=
PLANNER_MODE=stub
```

## Seed vendors
Insert vendors into the `vendors` collection. Example:

```

Or run the helper:

```
npm run seed:vendor
```
{
  "vendorId": "gpu_vendor_1",
  "name": "FastGPU",
  "endpoint": "http://localhost:4001",
  "basePricePerHour": 1.4,
  "reliabilityScore": 0.9,
  "supportedGpuTypes": ["A10", "A100"],
  "createdAt": new Date(),
  "updatedAt": new Date()
}
```

## Start the mock vendor
From repo root:

```
cd gpu-vendor-mock
npm install
npm run dev
```

The mock vendor listens on `http://localhost:4001` and expects `GPU_VENDOR_SECRET`.
You can force failures with `FAIL_VENDOR_ID=gpu_vendor_1` and adjust failure rate via `FAIL_RATE=0.1`.
The seed script inserts `gpu_vendor_1` and `gpu_vendor_2` for the recovery demo.

## Call the agent APIs
Deploy `/src/api/*.ts` as Vercel serverless functions or call them locally via the dev server.

Run locally:

```
npm run dev
```

- `POST /api/agent-start` with `{ "userId": "u1", "goal": "Fine-tune", "budgetTotal": 5 }`
- `POST /api/agent-tick` with `{ "runId": "..." }`
- `GET /api/agent-status?runId=...`

## Notes
- Each agent tick is stateless and reads/writes all state in MongoDB.
- The vendor API client uses x402-aware fetch; if the vendor doesn't issue a 402 challenge, we fall back to a local tx id.
- Set `PLANNER_MODE=stub` for a deterministic demo flow (always starts a job when idle).
- This demo uses x402-compatible mock GPU vendors so we can safely exercise payments, failures, and recovery; swapping to real vendors only requires updating the vendor registry.

## Example run trace (simulated)

This is a representative trace to show expected outputs. Your actual IDs and timestamps will differ.

```
POST /api/agent-start
=> {
  "_id": "66a1f2c9d53a3f9ef1f0c123",
  "status": "running",
  "budgetTotal": 5,
  "budgetRemaining": 5
}

POST /api/agent-tick
=> { "message": "Job started" }

GET /api/agent-status?runId=66a1f2c9d53a3f9ef1f0c123
=> {
  "run": { "status": "running", "budgetRemaining": 3.6 },
  "jobs": [
    {
      "vendorId": "gpu_vendor_1",
      "status": "running",
      "vendorJobId": "vgpu_ab12cd34"
    }
  ],
  "payments": [
    {
      "amount": 1.4,
      "currency": "USD",
      "status": "completed",
      "x402TxId": "mock_tx_1736543210"
    }
  ],
  "observations": [
    { "type": "agent_reasoning", "content": "Budget remaining: 5\\nQuote: 1.4 USD\\nProceeding with payment via x402 to vendor gpu_vendor_1" },
    { "type": "job_log", "content": "Epoch 1/3 loss=1.50" }
  ]
}

POST /api/agent-tick
=> { "message": "Job completed" }
```
