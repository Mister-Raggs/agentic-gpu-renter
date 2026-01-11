import { env, requireEnv } from "../config/env.js";

let cachedFetch: typeof fetch | null = null;
let cachedHttpClient: { getPaymentSettleResponse: (getHeader: (name: string) => string | null) => any } | null =
  null;
let initPromise: Promise<void> | null = null;

async function initClient(): Promise<void> {
  if (cachedFetch) {
    return;
  }

  if (!env.cdpApiKeyId || !env.cdpApiKeySecret || !env.cdpWalletSecret) {
    cachedFetch = fetch;
    return;
  }

  try {
    const [{ CdpClient }, { x402Client, wrapFetchWithPayment, x402HTTPClient }, { registerExactEvmScheme }, { privateKeyToAccount }] =
      await Promise.all([
        import("@coinbase/cdp-sdk"),
        import("@x402/fetch"),
        import("@x402/evm/exact/client"),
        import("viem/accounts")
      ]);

    requireEnv(env.cdpApiKeyId, "CDP_API_KEY_ID");
    requireEnv(env.cdpApiKeySecret, "CDP_API_KEY_SECRET");
    new CdpClient();

    const signer = privateKeyToAccount(env.cdpWalletSecret as `0x${string}`);
    const client = new x402Client();
    registerExactEvmScheme(client, { signer });
    cachedFetch = wrapFetchWithPayment(fetch, client);
    cachedHttpClient = new x402HTTPClient(client);
  } catch (error) {
    cachedFetch = fetch;
  }
}

export async function getPaymentFetch(): Promise<typeof fetch> {
  if (!initPromise) {
    initPromise = initClient();
  }
  await initPromise;
  return cachedFetch || fetch;
}

export async function getPaymentReceipt(getHeader: (name: string) => string | null) {
  if (!initPromise) {
    initPromise = initClient();
  }
  await initPromise;

  if (!cachedHttpClient) {
    return null;
  }

  try {
    return cachedHttpClient.getPaymentSettleResponse(getHeader);
  } catch (error) {
    return null;
  }
}
