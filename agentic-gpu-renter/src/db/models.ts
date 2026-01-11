import { Collection, Db, ObjectId } from "mongodb";

export type RunStatus = "pending" | "running" | "completed" | "failed";

export interface Run {
  _id: ObjectId;
  userId: string;
  goal: string;
  budgetTotal: number;
  budgetRemaining: number;
  status: RunStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface Vendor {
  _id: ObjectId;
  vendorId: string;
  name: string;
  endpoint: string;
  basePricePerHour: number;
  reliabilityScore: number;
  supportedGpuTypes: string[];
  createdAt: Date;
  updatedAt: Date;
}

export type JobStatus =
  | "quoted"
  | "submitted"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface Job {
  _id: ObjectId;
  runId: ObjectId;
  vendorId: string;
  vendorJobId?: string;
  status: JobStatus;
  expectedCost?: number;
  expectedDurationMinutes?: number;
  actualCost?: number;
  artifactUrl?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type PaymentStatus = "pending" | "completed" | "failed";

export interface Payment {
  _id: ObjectId;
  runId: ObjectId;
  jobId: ObjectId;
  vendorId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  x402TxId?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ObservationType = "job_log" | "metric" | "error" | "agent_reasoning";

export interface Observation {
  _id: ObjectId;
  runId: ObjectId;
  jobId?: ObjectId;
  type: ObservationType;
  content: string;
  timestamp: Date;
}

export function getRunsCollection(db: Db): Collection<Run> {
  return db.collection<Run>("runs");
}

export function getVendorsCollection(db: Db): Collection<Vendor> {
  return db.collection<Vendor>("vendors");
}

export function getJobsCollection(db: Db): Collection<Job> {
  return db.collection<Job>("jobs");
}

export function getPaymentsCollection(db: Db): Collection<Payment> {
  return db.collection<Payment>("payments");
}

export function getObservationsCollection(db: Db): Collection<Observation> {
  return db.collection<Observation>("observations");
}
