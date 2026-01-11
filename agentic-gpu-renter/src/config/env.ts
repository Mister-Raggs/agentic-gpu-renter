import dotenv from "dotenv";

dotenv.config();

export const env = {
  mongodbUri: process.env.MONGODB_URI,
  mongodbDbName: process.env.MONGODB_DB_NAME,
  fireworksApiKey: process.env.FIREWORKS_API_KEY,
  fireworksModel: process.env.FIREWORKS_MODEL || "accounts/fireworks/models/llama-v3-8b-instruct",
  x402WalletId: process.env.X402_WALLET_ID,
  x402PrivateKey: process.env.X402_PRIVATE_KEY,
  gpuVendorSecret: process.env.GPU_VENDOR_SECRET,
  cdpApiKeyId: process.env.CDP_API_KEY_ID || process.env.CDP_KEY,
  cdpApiKeySecret: process.env.CDP_API_KEY_SECRET || process.env.CDP_SECRET,
  cdpWalletSecret: process.env.CDP_WALLET_SECRET,
  plannerMode: process.env.PLANNER_MODE
};

export function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}
