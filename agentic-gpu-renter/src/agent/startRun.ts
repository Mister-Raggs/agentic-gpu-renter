import { ObjectId } from "mongodb";
import { getDb } from "../db/mongoClient.js";
import { getRunsCollection, Run } from "../db/models.js";

export async function startRun(params: {
  userId: string;
  goal: string;
  budgetTotal: number;
}): Promise<Run> {
  const db = await getDb();
  const runsColl = getRunsCollection(db);
  const now = new Date();

  const run: Run = {
    _id: new ObjectId(),
    userId: params.userId,
    goal: params.goal,
    budgetTotal: params.budgetTotal,
    budgetRemaining: params.budgetTotal,
    status: "running",
    createdAt: now,
    updatedAt: now
  };

  await runsColl.insertOne(run);
  return run;
}
