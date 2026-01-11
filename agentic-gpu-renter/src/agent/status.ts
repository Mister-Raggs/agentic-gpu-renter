import { ObjectId } from "mongodb";
import { getDb } from "../db/mongoClient.js";
import {
  getJobsCollection,
  getObservationsCollection,
  getPaymentsCollection,
  getRunsCollection,
  Job,
  Observation,
  Payment,
  Run
} from "../db/models.js";

export interface RunStatusPayload {
  run: Run;
  jobs: Job[];
  payments: Payment[];
  observations: Observation[];
}

export async function getRunStatus(runId: string): Promise<RunStatusPayload> {
  const db = await getDb();
  const runsColl = getRunsCollection(db);
  const jobsColl = getJobsCollection(db);
  const paymentsColl = getPaymentsCollection(db);
  const observationsColl = getObservationsCollection(db);

  const run = await runsColl.findOne({ _id: new ObjectId(runId) });
  if (!run) {
    throw new Error("Run not found");
  }

  const jobs = await jobsColl.find({ runId: run._id }).sort({ updatedAt: -1 }).toArray();
  const payments = await paymentsColl.find({ runId: run._id }).sort({ updatedAt: -1 }).toArray();
  const observations = await observationsColl
    .find({ runId: run._id })
    .sort({ timestamp: -1 })
    .limit(50)
    .toArray();

  return { run, jobs, payments, observations };
}
