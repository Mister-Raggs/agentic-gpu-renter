import "../config/env.js";
import { runAgentTick } from "../agent/tick.js";

interface VercelRequest {
  method?: string;
  body?: any;
  query?: Record<string, string | string[]>;
}

interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (payload: unknown) => void;
}

function getQueryValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const runId = req.body?.runId || getQueryValue(req.query?.runId);
  if (!runId || typeof runId !== "string") {
    res.status(400).json({ error: "Missing runId" });
    return;
  }

  try {
    const result = await runAgentTick(runId);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
}
