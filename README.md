# Architecture Overview

## System Design

This project implements an **autonomous AI agent** that manages GPU rental procurement and payment orchestration using Web3 payment protocols (x402), LLM-based planning, and MongoDB for persistent state management.

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Layer                             │
│  (REST API Calls: start run, tick execution, check status)      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Vercel Serverless Functions                 │
│  ┌────────────┐  ┌────────────┐  ┌────────────────┐           │
│  │ agent-start│  │ agent-tick │  │ agent-status   │           │
│  └────────────┘  └────────────┘  └────────────────┘           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Agent Core Logic                            │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Planning Engine (LLM-based Decision Making)             │  │
│  │  • Fireworks AI (Llama 3 8B)                             │  │
│  │  • Analyzes budget, vendor reliability, past failures    │  │
│  │  • Returns structured action: start_job, wait, abort     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Execution Layer                                          │  │
│  │  • Vendor quote fetching                                 │  │
│  │  • Job submission with x402 payment handling             │  │
│  │  • Status polling and observation logging                │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌──────────────────────────┐    ┌──────────────────────────┐
│   MongoDB Atlas          │    │  GPU Vendor APIs         │
│   (State Management)     │    │  (x402-compatible)       │
│                          │    │                          │
│  Collections:            │    │  • Quote endpoint        │
│  • runs                  │    │  • Submit job            │
│  • jobs                  │    │  • Poll status           │
│  • payments              │    │  • 402 payment challenge │
│  • observations          │    └──────────────────────────┘
│  • vendors               │                 │
└──────────────────────────┘                 ▼
                              ┌──────────────────────────┐
                              │  x402 Payment Protocol   │
                              │  (Coinbase CDP + EVM)    │
                              │                          │
                              │  • Wallet management     │
                              │  • On-chain settlement   │
                              │  • Payment receipts      │
                              └──────────────────────────┘
```

## Core Components

### 1. **Agent Orchestration Layer**

#### Stateless Tick Architecture
Each agent execution is triggered by a `POST /api/agent-tick` call and follows this flow:

```typescript
tick(runId) → fetchState(MongoDB) → plan(LLM) → execute(action) → persistState(MongoDB)
```

**Key Design Decision**: The agent is completely stateless. Every tick:
- Reads the entire run context from MongoDB (budget, jobs, payments, observations)
- Makes a fresh decision based on current state
- Executes the action
- Writes all state changes back to MongoDB

This design enables:
- Easy horizontal scaling (any instance can process any tick)
- Crash recovery (no in-memory state loss)
- Observable execution (full audit trail in MongoDB)

#### State Machine

```
START (idle) → PLANNING → EXECUTING → WAITING → [SUCCESS | FAILED]
                 ↑_____________________________________↓
                         (retry/recovery loop)
```

### 2. **LLM-Based Planning Engine**

**Location**: [`src/agent/planner.ts`](src/agent/planner.ts)

The planner uses Fireworks AI (Llama 3 8B) to make intelligent decisions about GPU procurement.

**Input Context**:
- User's goal (e.g., "Fine-tune tiny-llm")
- Budget remaining
- Vendor catalog (price, reliability scores, GPU types)
- Past job history (successes, failures)
- Payment history

**Output**: Structured JSON decision
```typescript
{
  action: "start_job" | "wait" | "abort",
  vendorId?: string,
  maxHours?: number,
  reason: string
}
```

**Fallback Mode**: A "stub" mode is available for deterministic testing without LLM calls.

**Key Capability**: The LLM can learn from failures and switch vendors if one fails:
```
Job fails on gpu_vendor_1 → Next tick → LLM decides → Switch to gpu_vendor_2
```

### 3. **x402 Payment Protocol Integration**

**Location**: [`src/x402/client.ts`](src/x402/client.ts), [`src/gpu/vendorApi.ts`](src/gpu/vendorApi.ts)

This project implements the **x402 HTTP payment protocol** - an emerging standard for machine-to-machine micropayments.

#### How it Works

1. **Request Quote**: Agent asks vendor for price estimate
2. **Submit Job**: Agent attempts to submit job
3. **402 Payment Required**: Vendor responds with `402` status + payment challenge
4. **Automatic Payment**: `x402` client intercepts 402, signs transaction on-chain
5. **Retry with Receipt**: Request retried with `x402TxId` header
6. **Job Approved**: Vendor verifies payment and starts job

```typescript
// x402-aware fetch automatically handles payment challenges
const response = await fetchWithPayment('/submit-job', { ... });
// If 402 is returned, payment happens transparently
// Response contains: { vendorJobId, status, paymentTxId }
```

**Integration Stack**:
- **Coinbase Developer Platform (CDP)**: Wallet management and signing
- **@x402/fetch**: Middleware for automatic 402 handling
- **@x402/evm**: Ethereum-based payment settlement
- **viem**: Low-level transaction signing

### 4. **MongoDB Data Model**

**Location**: [`src/db/models.ts`](src/db/models.ts)

#### Collections

**`runs`** - Agent execution contexts
```typescript
{
  _id: ObjectId,
  userId: string,
  goal: string,
  status: "running" | "completed" | "failed",
  budgetTotal: number,
  budgetRemaining: number,
  createdAt: Date,
  updatedAt: Date
}
```

**`jobs`** - GPU rental jobs
```typescript
{
  _id: ObjectId,
  runId: ObjectId,
  vendorId: string,
  vendorJobId: string,
  status: "submitted" | "running" | "completed" | "failed",
  expectedCost: number,
  actualCost: number,
  jobParams: object,
  createdAt: Date,
  completedAt?: Date
}
```

**`payments`** - Payment records
```typescript
{
  _id: ObjectId,
  runId: ObjectId,
  jobId: ObjectId,
  vendorId: string,
  amount: number,
  currency: string,
  status: "pending" | "completed" | "failed",
  x402TxId: string,  // On-chain transaction ID
  createdAt: Date
}
```

**`observations`** - Execution logs (for debugging and transparency)
```typescript
{
  _id: ObjectId,
  runId: ObjectId,
  type: "agent_reasoning" | "job_log" | "error" | "payment_event",
  content: string,
  timestamp: Date
}
```

**`vendors`** - GPU provider registry
```typescript
{
  _id: ObjectId,
  vendorId: string,
  name: string,
  endpoint: string,
  basePricePerHour: number,
  reliabilityScore: number,
  supportedGpuTypes: string[],
  createdAt: Date
}
```

### 5. **GPU Vendor API Client**

**Location**: [`src/gpu/vendorApi.ts`](src/gpu/vendorApi.ts)

Abstracts vendor communication with three key operations:

1. **`getQuote(vendor, params)`** - Get price estimate
2. **`submitJob(vendor, args)`** - Start job (with x402 payment)
3. **`pollJobStatus(vendor, vendorJobId)`** - Check progress

The client automatically handles:
- x402 payment challenges
- Retry logic on 402 responses
- Payment receipt extraction
- Error handling and logging

### 6. **Mock GPU Vendor**

**Location**: [`gpu-vendor-mock/`](gpu-vendor-mock/)

A testing harness that simulates:
- x402 payment challenges (returns 402 status)
- Job execution with realistic progress
- Configurable failure injection (`FAIL_VENDOR_ID`, `FAIL_RATE`)
- Multi-epoch training simulation

This allows full end-to-end testing without real GPU providers or payments.

## API Endpoints

### `POST /api/agent-start`
Initialize a new agent run
```json
Request: {
  "userId": "u1",
  "goal": "Fine-tune tiny-llm",
  "budgetTotal": 5
}

Response: {
  "_id": "66a1f2c9d53a3f9ef1f0c123",
  "status": "running",
  "budgetTotal": 5,
  "budgetRemaining": 5
}
```

### `POST /api/agent-tick`
Advance agent execution by one step
```json
Request: {
  "runId": "66a1f2c9d53a3f9ef1f0c123"
}

Response: {
  "message": "Job started",
  "action": {
    "action": "start_job",
    "vendorId": "gpu_vendor_1",
    "reason": "Best price/reliability ratio"
  }
}
```

### `GET /api/agent-status?runId=...`
Get comprehensive run state
```json
Response: {
  "run": { 
    "status": "running", 
    "budgetRemaining": 3.6 
  },
  "jobs": [...],
  "payments": [...],
  "observations": [...]
}
```

## Key Technical Decisions

### Why Stateless Agent Design?
- **Scalability**: No session affinity required
- **Reliability**: Crashes don't lose progress
- **Debugging**: Full execution trace in MongoDB
- **Cost**: Can run on serverless (Vercel Functions)

### Why LLM for Planning?
- **Adaptability**: Can handle vendor failures, budget changes dynamically
- **Explainability**: Returns reasoning for each decision
- **No hardcoding**: Easily adapts to new vendors or constraints

### Why x402 Payment Protocol?
- **Automation**: No manual payment approval needed
- **Speed**: Instant settlement vs. traditional invoicing
- **Machine-native**: Designed for AI agent interactions
- **Auditability**: On-chain payment trail

### Why MongoDB?
- **Schema flexibility**: Easy to add new observation types
- **Developer experience**: Rich querying for debugging
- **Atlas**: Managed service, no ops overhead
- **Document model**: Natural fit for agent state

## Deployment Architecture

```
Vercel (Serverless Functions)
├── /api/agent-start.ts
├── /api/agent-tick.ts
└── /api/agent-status.ts

MongoDB Atlas (Shared Cluster)
├── runs collection
├── jobs collection
├── payments collection
├── observations collection
└── vendors collection

Coinbase CDP (Wallet Service)
└── EVM wallet for x402 payments

External Services
├── Fireworks AI (LLM API)
└── GPU Vendors (x402-compatible)
```

## Development Workflow

1. **Local Development**:
   ```bash
   npm run dev  # Starts dev server on localhost:3000
   ```

2. **Testing with Mock Vendor**:
   ```bash
   cd gpu-vendor-mock && npm run dev  # Port 4001
   ```

3. **Seeding Test Data**:
   ```bash
   npm run seed:vendor  # Creates gpu_vendor_1, gpu_vendor_2
   ```

4. **Production Deployment**:
   ```bash
   vercel deploy --prod
   ```

## Security Considerations

- **Secret Management**: All API keys in environment variables, never committed
- **x402 Wallet**: Private keys secured via CDP, never exposed
- **Vendor Authentication**: Bearer token authentication on all vendor APIs
- **Budget Enforcement**: Agent cannot exceed `budgetRemaining` (enforced in planner)
- **Payment Verification**: Vendors verify on-chain payment before starting jobs

## Future Enhancements

- **Multi-agent coordination**: Parallel job execution across vendors
- **Real-time WebSocket updates**: Push status changes to clients
- **Cost optimization**: A/B testing different LLM models for planning
- **Payment aggregation**: Batch multiple micro-payments
- **Vendor reputation system**: Learn from community feedback
