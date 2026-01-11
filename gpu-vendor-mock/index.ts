import dotenv from "dotenv";
import express from "express";

dotenv.config();

const app = express();
app.use(express.json());

const gpuVendorSecret = process.env.GPU_VENDOR_SECRET;
const basePricePerHour = Number(process.env.BASE_PRICE_PER_HOUR || 1.4);
const failVendorId = process.env.FAIL_VENDOR_ID;
const failRate = Number(process.env.FAIL_RATE || 0.1);

if (!gpuVendorSecret) {
  throw new Error("Missing GPU_VENDOR_SECRET");
}

interface VendorJob {
  vendorJobId: string;
  status: "running" | "completed" | "failed";
  progress: number;
  logs: string[];
  polls: number;
  vendorId?: string;
}

const jobs = new Map<string, VendorJob>();

function authorize(req: express.Request, res: express.Response): boolean {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${gpuVendorSecret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

function createJob(): VendorJob {
  const vendorJobId = `vgpu_${Math.random().toString(36).slice(2, 10)}`;
  const job: VendorJob = {
    vendorJobId,
    status: "running",
    progress: 0,
    logs: [],
    polls: 0
  };
  jobs.set(vendorJobId, job);
  return job;
}

function updateJob(job: VendorJob): VendorJob {
  if (job.status !== "running") {
    return job;
  }

  job.polls += 1;
  job.progress = Math.min(1, job.progress + 0.35);
  job.logs.push(`Epoch ${job.polls}/3 loss=${(1.5 / job.polls).toFixed(2)}`);

  if (job.polls >= 3) {
    const shouldFail = job.vendorId && failVendorId && job.vendorId === failVendorId;
    if (shouldFail || Math.random() < failRate) {
      job.status = "failed";
    } else {
      job.status = "completed";
    }
  }

  jobs.set(job.vendorJobId, job);
  return job;
}

app.post("/quote", (req, res) => {
  if (!authorize(req, res)) {
    return;
  }

  const { jobType, gpuType, maxHours } = req.body || {};
  if (!jobType || !gpuType || typeof maxHours !== "number") {
    res.status(400).json({ error: "Missing jobType, gpuType, or maxHours" });
    return;
  }

  const priceEstimate = Number((basePricePerHour * maxHours).toFixed(2));
  res.json({
    vendorJobTemplateId: `tmpl_${gpuType}_${Date.now()}`,
    priceEstimate,
    currency: "USD",
    etaMinutes: Math.ceil(maxHours * 60)
  });
});

app.post("/submit-job", (req, res) => {
  if (!authorize(req, res)) {
    return;
  }

  const { vendorJobTemplateId, x402TxId, jobParams } = req.body || {};
  if (!vendorJobTemplateId) {
    res.status(400).json({ error: "Missing vendorJobTemplateId" });
    return;
  }

  if (!x402TxId) {
    res.setHeader("x402-tx-id", `mock_tx_${Date.now()}`);
    res.status(402).json({ error: "Payment required" });
    return;
  }

  const job = createJob();
  job.vendorId = req.headers["x-vendor-id"] as string | undefined;
  job.logs.push(`Starting job ${vendorJobTemplateId}`);
  if (jobParams?.goal) {
    job.logs.push(`Goal: ${jobParams.goal}`);
  }

  res.json({ vendorJobId: job.vendorJobId, status: job.status });
});

app.get("/job-status", (req, res) => {
  if (!authorize(req, res)) {
    return;
  }

  const vendorJobId = req.query.vendorJobId as string | undefined;
  if (!vendorJobId) {
    res.status(400).json({ error: "Missing vendorJobId" });
    return;
  }

  const job = jobs.get(vendorJobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const updated = updateJob(job);

  if (updated.status === "completed") {
    res.json({
      status: updated.status,
      progress: updated.progress,
      logs: updated.logs,
      estimatedRemainingMinutes: 0,
      costSoFar: basePricePerHour,
      finalMetrics: { loss: 0.78, val_accuracy: 0.87 },
      artifactUrl: "https://fake-storage/artifacts/model.bin"
    });
    return;
  }

  if (updated.status === "failed") {
    res.json({
      status: updated.status,
      progress: updated.progress,
      logs: updated.logs,
      estimatedRemainingMinutes: 0,
      costSoFar: basePricePerHour / 2,
      errorMessage: "Simulated vendor failure"
    });
    return;
  }

  res.json({
    status: updated.status,
    progress: updated.progress,
    logs: updated.logs,
    estimatedRemainingMinutes: Math.ceil((1 - updated.progress) * 60),
    costSoFar: Number((updated.progress * basePricePerHour).toFixed(2))
  });
});

const port = Number(process.env.PORT || 4001);
app.listen(port, () => {
  console.log(`GPU vendor mock listening on ${port}`);
});
