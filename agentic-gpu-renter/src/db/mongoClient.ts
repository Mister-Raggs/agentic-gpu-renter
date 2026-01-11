import { Db, MongoClient } from "mongodb";
import { env, requireEnv } from "../config/env.js";

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

export async function getDb(): Promise<Db> {
  if (cachedDb) {
    return cachedDb;
  }

  const uri = requireEnv(env.mongodbUri, "MONGODB_URI");
  const dbName = requireEnv(env.mongodbDbName, "MONGODB_DB_NAME");

  cachedClient = new MongoClient(uri);
  await cachedClient.connect();
  cachedDb = cachedClient.db(dbName);

  return cachedDb;
}
