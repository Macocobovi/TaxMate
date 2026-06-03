import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { businessProfiles, individualProfiles } from "../db/schema.js";
import { ApiError } from "../utils/errors.js";

export type TinType = "INDIVIDUAL" | "BUSINESS";

type TinSeed = {
  tin: string;
  label: string;
  linkedIdentifier?: string;
};

type TinMockData = {
  individual: TinSeed[];
  business: TinSeed[];
};

export type TinAvailability = TinSeed & {
  type: TinType;
  status: "AVAILABLE" | "RESERVED" | "USED";
  reservedBy?: string;
};

const RESERVATION_TTL_MS = 30 * 60 * 1000;

const mockData = JSON.parse(
  readFileSync(new URL("../mocks/tins.json", import.meta.url), "utf-8")
) as TinMockData;

class TinService {
  private reservations = new Map<string, { type: TinType; email: string; expiresAt: number }>();

  private getPool(type: TinType): TinSeed[] {
    return type === "BUSINESS" ? mockData.business : mockData.individual;
  }

  private cleanupReservations(): void {
    const now = Date.now();
    for (const [tin, reservation] of this.reservations.entries()) {
      if (reservation.expiresAt <= now) {
        this.reservations.delete(tin);
      }
    }
  }

  private async getUsedTins(type: TinType): Promise<Set<string>> {
    if (type === "BUSINESS") {
      const rows = await db.select({ tin: businessProfiles.tin }).from(businessProfiles);
      return new Set(rows.map((row) => row.tin));
    }

    const rows = await db.select({ tin: individualProfiles.tin }).from(individualProfiles);
    return new Set(rows.map((row) => row.tin));
  }

  async list(type: TinType): Promise<TinAvailability[]> {
    this.cleanupReservations();
    const used = await this.getUsedTins(type);

    return this.getPool(type).map((record) => {
      const reservation = this.reservations.get(record.tin);
      const status = used.has(record.tin) ? "USED" : reservation ? "RESERVED" : "AVAILABLE";
      return {
        ...record,
        type,
        status,
        reservedBy: reservation?.email
      };
    });
  }

  async listAvailable(type: TinType): Promise<TinAvailability[]> {
    const items = await this.list(type);
    return items.filter((item) => item.status === "AVAILABLE");
  }

  async reserve(type: TinType, tin: string, email: string): Promise<TinAvailability> {
    this.cleanupReservations();
    const poolRecord = this.getPool(type).find((record) => record.tin === tin);

    if (!poolRecord) {
      throw new ApiError(404, "TIN is not in the mocked availability pool");
    }

    const used = await this.getUsedTins(type);
    if (used.has(tin)) {
      throw new ApiError(409, "TIN has already been used");
    }

    const existing = this.reservations.get(tin);
    if (existing && existing.email !== email) {
      throw new ApiError(409, "TIN is currently reserved");
    }

    this.reservations.set(tin, {
      type,
      email,
      expiresAt: Date.now() + RESERVATION_TTL_MS
    });

    return {
      ...poolRecord,
      type,
      status: "RESERVED",
      reservedBy: email
    };
  }

  async assertAvailableForRegistration(type: TinType, tin: string, email: string): Promise<void> {
    this.cleanupReservations();
    const poolRecord = this.getPool(type).find((record) => record.tin === tin);

    if (!poolRecord) {
      throw new ApiError(400, "Select a valid mocked TIN");
    }

    const used = await this.getUsedTins(type);
    if (used.has(tin)) {
      throw new ApiError(409, "TIN has already been used");
    }

    const reservation = this.reservations.get(tin);
    if (reservation && reservation.email !== email) {
      throw new ApiError(409, "TIN is currently reserved by another registration");
    }

    if (!reservation) {
      await this.reserve(type, tin, email);
    }
  }

  release(tin: string, email: string): void {
    const reservation = this.reservations.get(tin);
    if (reservation?.email === email) {
      this.reservations.delete(tin);
    }
  }

  async isUsed(type: TinType, tin: string): Promise<boolean> {
    const used = await this.getUsedTins(type);
    return used.has(tin);
  }

  async resolveProfileTypeForTin(tin: string): Promise<TinType | null> {
    const [individual] = await db
      .select({ tin: individualProfiles.tin })
      .from(individualProfiles)
      .where(eq(individualProfiles.tin, tin))
      .limit(1);

    if (individual) {
      return "INDIVIDUAL";
    }

    const [business] = await db
      .select({ tin: businessProfiles.tin })
      .from(businessProfiles)
      .where(eq(businessProfiles.tin, tin))
      .limit(1);

    return business ? "BUSINESS" : null;
  }
}

export const tinService = new TinService();
