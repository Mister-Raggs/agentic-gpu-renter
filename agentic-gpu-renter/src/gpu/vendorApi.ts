import { Vendor } from "../db/models.js";
import { env, requireEnv } from "../config/env.js";
import { getPaymentFetch, getPaymentReceipt } from "../x402/client.js";

export interface QuoteResponse {
  vendorJobTemplateId: string;
  priceEstimate: number;
  currency: string;
  etaMinutes: number;
}

export interface SubmitJobResponse {
  vendorJobId: string;
  status: "running" | "queued";
  paymentTxId?: string;
}

export interface JobStatusResponse {
  status: "running" | "completed" | "failed";
  progress: number;
  logs: string[];
  estimatedRemainingMinutes?: number;
  costSoFar?: number;
  finalMetrics?: Record<string, unknown>;
  artifactUrl?: string;
  errorMessage?: string;
}

function vendorHeaders(vendorId?: string): Record<string, string> {
  const secret = requireEnv(env.gpuVendorSecret, "GPU_VENDOR_SECRET");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${secret}`,
    ...(vendorId ? { "x-vendor-id": vendorId } : {})
  };
}

export async function getQuote(
  vendor: Vendor,
  params: { jobType: string; gpuType: string; maxHours: number; jobMetadata?: Record<string, unknown> }
): Promise<QuoteResponse> {
  const response = await fetch(`${vendor.endpoint}/quote`, {
    method: "POST",
    headers: vendorHeaders(vendor.vendorId),
    body: JSON.stringify(params)
  });

  if (!response.ok) {
    throw new Error(`Vendor quote failed: ${response.status}`);
  }

  return (await response.json()) as QuoteResponse;
}

export async function submitJob(
  vendor: Vendor,
  args: { vendorJobTemplateId: string; x402TxId?: string; jobParams: unknown; callbackUrl?: string }
): Promise<SubmitJobResponse> {
  const fetchWithPayment = await getPaymentFetch();
  const makeRequest = async (payload: typeof args) =>
    fetchWithPayment(`${vendor.endpoint}/submit-job`, {
      method: "POST",
      headers: vendorHeaders(vendor.vendorId),
      body: JSON.stringify(payload)
    });

  let response = await makeRequest(args);

  if (response.status === 402 && !args.x402TxId) {
    const txId = response.headers.get("x402-tx-id");
    if (txId) {
      response = await makeRequest({ ...args, x402TxId: txId });
    }
  }

  if (!response.ok) {
    throw new Error(`Vendor submit failed: ${response.status}`);
  }

  const data = (await response.json()) as SubmitJobResponse;
  const receipt = await getPaymentReceipt((name) => response.headers.get(name));
  const headerTxId = response.headers.get("x402-tx-id") || undefined;

  return {
    ...data,
    paymentTxId: data.paymentTxId ?? receipt?.txId ?? headerTxId
  };
}

export async function getJobStatus(vendor: Vendor, vendorJobId: string): Promise<JobStatusResponse> {
  const response = await fetch(`${vendor.endpoint}/job-status?vendorJobId=${encodeURIComponent(vendorJobId)}`, {
    method: "GET",
    headers: vendorHeaders(vendor.vendorId)
  });

  if (!response.ok) {
    throw new Error(`Vendor status failed: ${response.status}`);
  }

  return (await response.json()) as JobStatusResponse;
}
