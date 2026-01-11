import { ObjectId } from "mongodb";
import { getDb } from "../db/mongoClient.js";
import {
  getJobsCollection,
  getObservationsCollection,
  getPaymentsCollection,
  getRunsCollection,
  getVendorsCollection,
  Job,
  Observation
} from "../db/models.js";
import { decideNextAction } from "./planner.js";
import { getJobStatus, getQuote, submitJob } from "../gpu/vendorApi.js";

function createObservation(params: {
  runId: ObjectId;
  jobId?: ObjectId;
  type: Observation["type"];
  content: string;
}): Observation {
  return {
    _id: new ObjectId(),
    runId: params.runId,
    jobId: params.jobId,
    type: params.type,
    content: params.content,
    timestamp: new Date()
  };
}

async function writeObservation(obs: Observation): Promise<void> {
  const db = await getDb();
  await getObservationsCollection(db).insertOne(obs);
}

function pickActiveJob(jobs: Job[]): Job | undefined {
  return jobs.find((job) => job.status === "submitted" || job.status === "running");
}

function safeObjectId(value: string): ObjectId | null {
  try {
    return new ObjectId(value);
  } catch (error) {
    return null;
  }
}

export async function runAgentTick(runId: string): Promise<{ message: string }> {
  const db = await getDb();
  const runsColl = getRunsCollection(db);
  const jobsColl = getJobsCollection(db);
  const vendorsColl = getVendorsCollection(db);
  const paymentsColl = getPaymentsCollection(db);
  const observationsColl = getObservationsCollection(db);

  try {
    const runObjectId = safeObjectId(runId);
    if (!runObjectId) {
      return { message: "Invalid runId" };
    }

    const run = await runsColl.findOne({ _id: runObjectId });
    if (!run) {
      return { message: "Run not found" };
    }

    if (run.status === "completed" || run.status === "failed") {
      return { message: `Run already ${run.status}` };
    }

    const jobs = await jobsColl.find({ runId: run._id }).toArray();
    const activeJob = pickActiveJob(jobs);

    if (activeJob) {
      const vendor = await vendorsColl.findOne({ vendorId: activeJob.vendorId });
      if (!vendor || !activeJob.vendorJobId) {
        await jobsColl.updateOne(
          { _id: activeJob._id },
          {
            $set: {
              status: "failed",
              errorMessage: "Active job missing vendor configuration",
              updatedAt: new Date()
            }
          }
        );
        await observationsColl.insertOne(
          createObservation({
            runId: run._id,
            jobId: activeJob._id,
            type: "error",
            content: "Active job missing vendor configuration"
          })
        );
        return { message: "Active job missing vendor configuration" };
      }

      const status = await getJobStatus(vendor, activeJob.vendorJobId);
      if (status.logs?.length) {
        const logObservation = createObservation({
          runId: run._id,
          jobId: activeJob._id,
          type: "job_log",
          content: status.logs.join("\n")
        });
        await observationsColl.insertOne(logObservation);
      }

      if (status.status === "completed") {
        await jobsColl.updateOne(
          { _id: activeJob._id },
          {
            $set: {
              status: "completed",
              actualCost: status.costSoFar,
              artifactUrl: status.artifactUrl,
              updatedAt: new Date()
            }
          }
        );

        await runsColl.updateOne(
          { _id: run._id },
          { $set: { status: "completed", updatedAt: new Date() } }
        );

        if (status.finalMetrics) {
          await observationsColl.insertOne(
            createObservation({
              runId: run._id,
              jobId: activeJob._id,
              type: "metric",
              content: JSON.stringify(status.finalMetrics)
            })
          );
        }

        return { message: "Job completed" };
      }

      if (status.status === "failed") {
        await jobsColl.updateOne(
          { _id: activeJob._id },
          {
            $set: {
              status: "failed",
              errorMessage: status.errorMessage || "Vendor reported failure",
              updatedAt: new Date()
            }
          }
        );

        await observationsColl.insertOne(
          createObservation({
            runId: run._id,
            jobId: activeJob._id,
            type: "error",
            content: status.errorMessage || "Vendor reported failure"
          })
        );

        return { message: "Job failed" };
      }

      return { message: "Job still running" };
    }

    const vendors = await vendorsColl.find({}).toArray();
    const payments = await paymentsColl.find({ runId: run._id }).toArray();

    if (vendors.length === 0) {
      await observationsColl.insertOne(
        createObservation({
          runId: run._id,
          type: "error",
          content: "No vendors available"
        })
      );
      return { message: "No vendors available" };
    }

    const plan = await decideNextAction({ run, vendors, jobs, payments });
    const decision = plan.decision;

    await observationsColl.insertOne(
      createObservation({
        runId: run._id,
        type: "agent_reasoning",
        content: [
          `mode: ${plan.mode}`,
          `prompt: ${plan.prompt}`,
          `decision: ${JSON.stringify(decision)}`,
          plan.usedFallback ? `fallback: true` : `fallback: false`,
          plan.rawResponse ? `raw: ${plan.rawResponse}` : undefined
        ]
          .filter(Boolean)
          .join("\n")
      })
    );

    if (decision.action === "wait") {
      return { message: "Waiting" };
    }

    if (decision.action === "abort") {
      await runsColl.updateOne(
        { _id: run._id },
        { $set: { status: "failed", updatedAt: new Date() } }
      );
      return { message: "Run aborted" };
    }

    const vendor = vendors.find((item) => item.vendorId === decision.vendorId);
    if (!vendor) {
      await observationsColl.insertOne(
        createObservation({
          runId: run._id,
          type: "error",
          content: `Unknown vendorId: ${decision.vendorId}`
        })
      );
      return { message: "Unknown vendor" };
    }

    const quote = await getQuote(vendor, {
      jobType: "fine_tune",
      gpuType: vendor.supportedGpuTypes[0] || "A10",
      maxHours: decision.maxHours,
      jobMetadata: { goal: run.goal }
    });

    if (quote.priceEstimate > run.budgetRemaining) {
      await observationsColl.insertOne(
        createObservation({
          runId: run._id,
          type: "error",
          content: "Quote exceeds remaining budget"
        })
      );
      return { message: "Quote exceeds budget" };
    }

    await observationsColl.insertOne(
      createObservation({
        runId: run._id,
        type: "agent_reasoning",
        content: [
          `Budget remaining: ${run.budgetRemaining}`,
          `Quote: ${quote.priceEstimate} ${quote.currency}`,
          `Proceeding with payment via x402 to vendor ${vendor.vendorId}`
        ].join("\n")
      })
    );

    const jobId = new ObjectId();
    await jobsColl.insertOne({
      _id: jobId,
      runId: run._id,
      vendorId: vendor.vendorId,
      status: "quoted",
      expectedCost: quote.priceEstimate,
      expectedDurationMinutes: quote.etaMinutes,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const fallbackTxId = `local_tx_${Date.now()}`;
    let submitResult: Awaited<ReturnType<typeof submitJob>>;
    try {
      submitResult = await submitJob(vendor, {
        vendorJobTemplateId: quote.vendorJobTemplateId,
        x402TxId: fallbackTxId,
        jobParams: { goal: run.goal, maxHours: decision.maxHours }
      });
    } catch (error) {
      const message = (error as Error).message || "Submit job failed";
      await paymentsColl.insertOne({
        _id: new ObjectId(),
        runId: run._id,
        jobId,
        vendorId: vendor.vendorId,
        amount: quote.priceEstimate,
        currency: quote.currency,
        status: "failed",
        errorMessage: message,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      await jobsColl.updateOne(
        { _id: jobId },
        { $set: { status: "failed", errorMessage: message, updatedAt: new Date() } }
      );
      await observationsColl.insertOne(
        createObservation({
          runId: run._id,
          jobId,
          type: "error",
          content: message
        })
      );
      return { message: "Submit job failed" };
    }

    const paymentTxId = submitResult.paymentTxId || fallbackTxId;

    await paymentsColl.insertOne({
      _id: new ObjectId(),
      runId: run._id,
      jobId,
      vendorId: vendor.vendorId,
      amount: quote.priceEstimate,
      currency: quote.currency,
      status: "completed",
      x402TxId: paymentTxId,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await observationsColl.insertOne(
      createObservation({
        runId: run._id,
        jobId,
        type: "agent_reasoning",
        content: `Payment settled via x402. txId=${paymentTxId}`
      })
    );

    const budgetUpdate = await runsColl.updateOne(
      { _id: run._id, budgetRemaining: { $gte: quote.priceEstimate } },
      { $inc: { budgetRemaining: -quote.priceEstimate }, $set: { updatedAt: new Date() } }
    );

    if (budgetUpdate.modifiedCount === 0) {
      await jobsColl.updateOne(
        { _id: jobId },
        { $set: { status: "failed", errorMessage: "Budget update failed", updatedAt: new Date() } }
      );
      await observationsColl.insertOne(
        createObservation({
          runId: run._id,
          jobId,
          type: "error",
          content: "Budget update failed or insufficient funds"
        })
      );
      return { message: "Budget update failed" };
    }

    await jobsColl.updateOne(
      { _id: jobId },
      {
        $set: {
          vendorJobId: submitResult.vendorJobId,
          status: "running",
          updatedAt: new Date()
        }
      }
    );

    await runsColl.updateOne(
      { _id: run._id },
      { $set: { status: "running", updatedAt: new Date() } }
    );

    return { message: "Job started" };
  } catch (error) {
    const message = (error as Error).message || "Unexpected error";
    const runObjectId = safeObjectId(runId);
    if (runObjectId) {
      await writeObservation(
        createObservation({
          runId: runObjectId,
          type: "error",
          content: message
        })
      );
    }
    return { message: "Tick failed" };
  }
}
