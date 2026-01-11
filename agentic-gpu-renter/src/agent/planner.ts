import { env, requireEnv } from "../config/env.js";
import { Job, Payment, Run, Vendor } from "../db/models.js";

export type AgentAction =
  | { action: "start_job"; vendorId: string; maxHours: number; reason: string }
  | { action: "wait"; reason: string }
  | { action: "abort"; reason: string };

export interface PlannerResult {
  decision: AgentAction;
  prompt: string;
  rawResponse?: string;
  usedFallback: boolean;
  mode: "stub" | "llm";
}

interface FireworksResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

function buildPrompt(params: {
  run: Run;
  vendors: Vendor[];
  jobs: Job[];
  payments: Payment[];
}): string {
  const vendorSummary = params.vendors.map((vendor) => ({
    vendorId: vendor.vendorId,
    basePricePerHour: vendor.basePricePerHour,
    reliabilityScore: vendor.reliabilityScore
  }));

  const jobSummary = params.jobs.map((job) => ({
    vendorId: job.vendorId,
    status: job.status,
    expectedCost: job.expectedCost,
    actualCost: job.actualCost
  }));

  return [
    "You are a GPU procurement agent.",
    "Constraints:",
    "- Must not exceed run.budgetRemaining.",
    "- Must choose vendorId from provided vendors only.",
    "Return STRICT JSON only with fields: action, vendorId (if start_job), maxHours (if start_job), reason.",
    "",
    `Goal: ${params.run.goal}`,
    `Budget remaining: ${params.run.budgetRemaining}`,
    `Vendors: ${JSON.stringify(vendorSummary)}`,
    `Past jobs: ${JSON.stringify(jobSummary)}`,
    `Payments count: ${params.payments.length}`
  ].join("\n");
}

export async function decideNextAction(params: {
  run: Run;
  vendors: Vendor[];
  jobs: Job[];
  payments: Payment[];
}): Promise<PlannerResult> {
  if (env.plannerMode === "stub") {
    const hasActiveJob = params.jobs.some(
      (job) => job.status === "submitted" || job.status === "running"
    );
    const hasFailedVendorOne = params.jobs.some(
      (job) => job.status === "failed" && job.vendorId === "gpu_vendor_1"
    );
    const decision: AgentAction = hasActiveJob
      ? { action: "wait", reason: "Job already active" }
      : {
          action: "start_job",
          vendorId: hasFailedVendorOne ? "gpu_vendor_2" : "gpu_vendor_1",
          maxHours: 1,
          reason: "Stub plan"
        };
    return { decision, prompt: "stub", usedFallback: false, mode: "stub" };
  }

  const apiKey = requireEnv(env.fireworksApiKey, "FIREWORKS_API_KEY");
  const prompt = buildPrompt(params);

  const payload = {
    model: env.fireworksModel || "accounts/fireworks/models/llama-v3-8b-instruct",
    messages: [
      { role: "system", content: "You are a careful planner." },
      { role: "user", content: prompt }
    ],
    temperature: 0.2
  };

  const response = await fetch("https://api.fireworks.ai/inference/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    return { action: "wait", reason: "Planner request failed" };
  }

  const data = (await response.json()) as FireworksResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    return {
      decision: fallbackDecision(params, "Planner returned empty content"),
      prompt,
      rawResponse: content,
      usedFallback: true,
      mode: "llm"
    };
  }

  try {
    const parsed = JSON.parse(content) as AgentAction;
    if (parsed.action === "start_job") {
      return {
        decision: adjustDecisionForRecovery(params, parsed),
        prompt,
        rawResponse: content,
        usedFallback: false,
        mode: "llm"
      };
    }
    if (parsed.action === "wait" || parsed.action === "abort") {
      return { decision: parsed, prompt, rawResponse: content, usedFallback: false, mode: "llm" };
    }
  } catch (error) {
    return {
      decision: fallbackDecision(params, "Planner JSON parse failed"),
      prompt,
      rawResponse: content,
      usedFallback: true,
      mode: "llm"
    };
  }

  return {
    decision: fallbackDecision(params, "Planner returned invalid response"),
    prompt,
    rawResponse: content,
    usedFallback: true,
    mode: "llm"
  };
}

function adjustDecisionForRecovery(
  params: { vendors: Vendor[]; jobs: Job[] },
  decision: AgentAction
): AgentAction {
  if (decision.action !== "start_job") {
    return decision;
  }

  const hasFailedVendorOne = params.jobs.some(
    (job) => job.status === "failed" && job.vendorId === "gpu_vendor_1"
  );
  const vendorTwo = params.vendors.find((vendor) => vendor.vendorId === "gpu_vendor_2");

  if (hasFailedVendorOne && vendorTwo && decision.vendorId === "gpu_vendor_1") {
    return {
      ...decision,
      vendorId: vendorTwo.vendorId,
      reason: `${decision.reason} (recovery: prefer gpu_vendor_2)`
    };
  }

  return decision;
}

function fallbackDecision(
  params: { run: Run; vendors: Vendor[]; jobs: Job[] },
  reason: string
): AgentAction {
  const hasFailedVendorOne = params.jobs.some(
    (job) => job.status === "failed" && job.vendorId === "gpu_vendor_1"
  );
  const vendorTwo = params.vendors.find((vendor) => vendor.vendorId === "gpu_vendor_2");
  const cheapest = [...params.vendors].sort(
    (a, b) => a.basePricePerHour - b.basePricePerHour
  )[0];

  const preferred = hasFailedVendorOne && vendorTwo ? vendorTwo : cheapest;

  if (!preferred || preferred.basePricePerHour <= 0) {
    return { action: "wait", reason };
  }

  const maxHours = Math.min(params.run.budgetRemaining / preferred.basePricePerHour, 1);
  if (maxHours <= 0) {
    return { action: "abort", reason: "Insufficient budget" };
  }

  return {
    action: "start_job",
    vendorId: preferred.vendorId,
    maxHours: Number(maxHours.toFixed(2)),
    reason: `${reason} (fallback)`
  };
}
