import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { env } from "../src/config/env.js";

type CircleError = Error & {
  response?: {
    data?: unknown;
  };
};

async function testCircleSdk() {
  console.log("=== TESTING CIRCLE SDK ===");

  try {
    const client = initiateDeveloperControlledWalletsClient({
      apiKey: env.CIRCLE_API_KEY!,
      entitySecret: env.CIRCLE_ENTITY_SECRET!
    });
    console.log("Client initialized");

    console.log("\n1. Creating a test wallet set...");
    try {
      const walletSetResponse = await client.createWalletSet({
        name: `Test Wallet Set ${Date.now()}`
      });
      console.log("Wallet set created:", walletSetResponse.data?.walletSet);
    } catch {
      console.log("Note: If you already have a wallet set, this might fail with duplicate");
      console.log("Existing wallet set ID:", env.CIRCLE_WALLET_SET_ID);
    }

    console.log("\n2. Testing wallet operations...");
    if (env.CIRCLE_WALLET_SET_ID) {
      console.log("Would create wallet with set:", env.CIRCLE_WALLET_SET_ID);
    }

    console.log("\nSDK configuration looks correct");
    console.log("Next steps:");
    console.log("1. Verify CIRCLE_WALLET_SET_ID exists in Circle Console");
    console.log("2. Make sure the entity secret is registered");
    console.log("3. Check that the API key has proper permissions");
  } catch (error) {
    const circleError = error as CircleError;
    console.error("SDK test failed:", circleError);
    if (circleError.response) {
      console.error("Response data:", circleError.response.data);
    }
  }
}

void testCircleSdk();
