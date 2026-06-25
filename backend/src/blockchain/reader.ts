import { Interface, JsonRpcProvider, type Log } from "ethers";
import { env } from "../config/env.js";

// Read-only view of the Taxmate contract (writes go through Circle). Used to check
// whether a tax item exists on-chain and to read the id the contract assigned when
// createTaxItem was executed.
const ABI = [
  "function taxItems(uint256) view returns (uint256 itemId, string name, string description, uint8 category, uint256 rate, bool isActive, uint256 createdAt, uint256 updatedAt)",
  "event TaxItemCreated(uint256 indexed itemId, string name, uint8 category, uint256 rate)"
];

const iface = new Interface(ABI);

export class TaxmateReader {
  private provider: JsonRpcProvider | null = null;

  isConfigured(): boolean {
    return Boolean(env.BASE_RPC_URL && env.TAXMATE_CONTRACT_ADDRESS);
  }

  private getProvider(): JsonRpcProvider {
    if (!this.provider) {
      if (!env.BASE_RPC_URL) {
        throw new Error("BASE_RPC_URL is not configured");
      }
      this.provider = new JsonRpcProvider(env.BASE_RPC_URL);
    }
    return this.provider;
  }

  private contractAddress(): string {
    if (!env.TAXMATE_CONTRACT_ADDRESS) {
      throw new Error("TAXMATE_CONTRACT_ADDRESS is not configured");
    }
    return env.TAXMATE_CONTRACT_ADDRESS;
  }

  // A tax item exists when its on-chain itemId field is non-zero.
  async taxItemExists(itemId: number): Promise<boolean> {
    const data = iface.encodeFunctionData("taxItems", [itemId]);
    const raw = await this.getProvider().call({ to: this.contractAddress(), data });
    const decoded = iface.decodeFunctionResult("taxItems", raw);
    return BigInt(decoded[0]) !== 0n;
  }

  // Reads the itemId the contract assigned, from the TaxItemCreated event in the receipt.
  async readCreatedItemId(txHash: string): Promise<number> {
    const receipt = await this.getProvider().getTransactionReceipt(txHash);
    if (!receipt) {
      throw new Error(`No receipt found for tx ${txHash}`);
    }

    const target = this.contractAddress().toLowerCase();
    for (const log of receipt.logs as Log[]) {
      if (log.address.toLowerCase() !== target) {
        continue;
      }
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === "TaxItemCreated") {
        return Number(parsed.args.itemId);
      }
    }
    throw new Error(`No TaxItemCreated event in tx ${txHash}`);
  }
}

export const taxmateReader = new TaxmateReader();
