import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { registrationSessions } from "../db/schema.js";
import { randomToken, sha256 } from "../utils/crypto.js";
import { ApiError } from "../utils/errors.js";

const SESSION_TTL_MS = 45 * 60 * 1000;

export class RegistrationSessionService {
  async create(email: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await db.insert(registrationSessions).values({
      email,
      sessionTokenHash: sha256(token),
      expiresAt
    });

    return { token, expiresAt };
  }

  async assertValid(token: string, email: string): Promise<{ id: string }> {
    const [session] = await db
      .select()
      .from(registrationSessions)
      .where(
        and(
          eq(registrationSessions.email, email),
          eq(registrationSessions.sessionTokenHash, sha256(token)),
          isNull(registrationSessions.usedAt)
        )
      )
      .orderBy(desc(registrationSessions.createdAt))
      .limit(1);

    if (!session) {
      throw new ApiError(401, "Invalid registration session");
    }

    if (session.expiresAt.getTime() < Date.now()) {
      throw new ApiError(401, "Registration session expired");
    }

    return { id: session.id };
  }

  async consume(id: string): Promise<void> {
    await db
      .update(registrationSessions)
      .set({ usedAt: new Date() })
      .where(eq(registrationSessions.id, id));
  }
}

export const registrationSessionService = new RegistrationSessionService();
