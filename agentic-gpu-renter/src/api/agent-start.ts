import "../config/env.js";
import { startRun } from "../agent/startRun.js";

interface VercelRequest {
  method?: string;
  body?: any;
}

interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (payload: unknown) => void;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { userId, goal, budgetTotal } = req.body || {};
  if (!userId || !goal || typeof budgetTotal !== "number") {
    res.status(400).json({ error: "Missing userId, goal, or budgetTotal" });
    return;
  }

  try {
    const run = await startRun({ userId, goal, budgetTotal });
    res.status(200).json(run);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
}
