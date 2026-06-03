import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { createHash, randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { ApiError } from "../utils/errors.js";

type ContractExecutionParams = {
  walletId: string;
  abiFunctionSignature: string;
  abiParameters: unknown[];
};

type CircleSdkClient = ReturnType<typeof initiateDeveloperControlledWalletsClient>;

export class CircleClient {
  private client: CircleSdkClient | null = null;

  constructor() {
    if (this.useMockMode()) {
      return;
    }

    this.client = initiateDeveloperControlledWalletsClient({
      apiKey: env.CIRCLE_API_KEY!,
      entitySecret: env.CIRCLE_ENTITY_SECRET!
    });
  }

  private useMockMode(): boolean {
    return !env.CIRCLE_API_KEY || !env.CIRCLE_ENTITY_SECRET;
  }

  private getRequiredClient(): CircleSdkClient {
    if (!this.client) {
      throw new ApiError(500, "Circle credentials not configured");
    }

    return this.client;
  }

  private mockAddress(seed: string): string {
    return `0x${createHash("sha256").update(seed).digest("hex").slice(0, 40)}`;
  }

  async createScaWallet(): Promise<{ walletId: string; address: string; raw: unknown }> {
    if (this.useMockMode()) {
      const walletId = `mock-wallet-${randomUUID().slice(0, 8)}`;
      return {
        walletId,
        address: this.mockAddress(walletId),
        raw: { mock: true }
      };
    }

    try {
      if (!env.CIRCLE_WALLET_SET_ID) {
        throw new ApiError(500, "CIRCLE_WALLET_SET_ID is not configured");
      }

      const response = await this.getRequiredClient().createWallets({
        walletSetId: env.CIRCLE_WALLET_SET_ID,
        blockchains: ["BASE-SEPOLIA"],
        count: 1,
        accountType: "SCA"
      });

      const wallet = response.data?.wallets?.[0];
      if (!wallet?.id || !wallet?.address) {
        throw new Error("Wallet creation failed: missing wallet data");
      }

      return {
        walletId: wallet.id,
        address: wallet.address,
        raw: response
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Circle error";
      throw new ApiError(500, `Circle wallet creation failed: ${message}`);
    }
  }

  async executeContract(params: ContractExecutionParams): Promise<{ transactionId: string; raw: unknown }> {
    if (this.useMockMode()) {
      return {
        transactionId: `mock-tx-${randomUUID().slice(0, 12)}`,
        raw: { mock: true, params }
      };
    }

    try {
      if (!env.TAXMATE_CONTRACT_ADDRESS) {
        throw new ApiError(500, "TAXMATE_CONTRACT_ADDRESS is not configured");
      }

      const response = await this.getRequiredClient().createContractExecutionTransaction({
        walletId: params.walletId,
        contractAddress: env.TAXMATE_CONTRACT_ADDRESS,
        abiFunctionSignature: params.abiFunctionSignature,
        abiParameters: params.abiParameters as string[],
        fee: { type: "level", config: { feeLevel: "MEDIUM" } }
      });

      const txId = response.data?.id;
      if (!txId) {
        throw new Error("Transaction creation failed: no ID returned");
      }

      return {
        transactionId: txId,
        raw: response
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Circle error";
      throw new ApiError(500, `Circle contract execution failed: ${message}`);
    }
  }

  async getTransaction(txId: string): Promise<{ state: string; txHash?: string; raw: unknown }> {
    if (this.useMockMode()) {
      return {
        state: "CONFIRMED",
        txHash: this.mockAddress(txId),
        raw: { mock: true }
      };
    }

    try {
      const response = await this.getRequiredClient().getTransaction({ id: txId });
      const tx = response.data?.transaction;

      return {
        state: tx?.state || "PENDING",
        txHash: tx?.txHash,
        raw: response
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Circle error";
      throw new ApiError(500, `Circle transaction query failed: ${message}`);
    }
  }
}

export const circleClient = new CircleClient();
