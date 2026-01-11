import "../src/config/env.js";
import { ObjectId } from "mongodb";
import { getDb } from "../src/db/mongoClient.js";
import { getVendorsCollection, Vendor } from "../src/db/models.js";

async function seed() {
  const db = await getDb();
  const vendors = getVendorsCollection(db);
  const now = new Date();

  const vendorOne: Vendor = {
    _id: new ObjectId(),
    vendorId: "gpu_vendor_1",
    name: "FastGPU",
    endpoint: "http://localhost:4001",
    basePricePerHour: 1.4,
    reliabilityScore: 0.9,
    supportedGpuTypes: ["A10", "A100"],
    createdAt: now,
    updatedAt: now
  };

  const vendorTwo: Vendor = {
    _id: new ObjectId(),
    vendorId: "gpu_vendor_2",
    name: "ReliableGPU",
    endpoint: "http://localhost:4001",
    basePricePerHour: 1.8,
    reliabilityScore: 0.95,
    supportedGpuTypes: ["A10", "A100"],
    createdAt: now,
    updatedAt: now
  };

  await vendors.updateOne(
    { vendorId: vendorOne.vendorId },
    { $setOnInsert: vendorOne },
    { upsert: true }
  );
  await vendors.updateOne(
    { vendorId: vendorTwo.vendorId },
    { $setOnInsert: vendorTwo },
    { upsert: true }
  );
  console.log("Seeded vendors gpu_vendor_1 and gpu_vendor_2");
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
