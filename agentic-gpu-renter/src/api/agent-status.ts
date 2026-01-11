import "../config/env.js";
import { getRunStatus } from "../agent/status.js";

interface VercelRequest {
  method?: string;
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
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const runId = getQueryValue(req.query?.runId);
  if (!runId) {
    res.status(400).json({ error: "Missing runId" });
    return;
  }

  try {
    const payload = await getRunStatus(runId);
    res.status(200).json(payload);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
}
