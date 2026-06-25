import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { tokenService } from "../services/token-service.js";

export type AuthUser = {
  id: string;
  role: "USER" | "ADMIN" | "SUPER_ADMIN";
};

declare module "express-serve-static-core" {
  interface Request {
    authUser?: AuthUser;
    // Raw request body, captured for webhook signature verification.
    rawBody?: Buffer;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.header("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  if (bearerToken) {
    tokenService
      .verifyAccessToken(bearerToken)
      .then((claims) => {
        req.authUser = { id: claims.sub, role: claims.role };
        next();
      })
      .catch(() => {
        res.status(401).json({ message: "Unauthorized" });
      });
    return;
  }

  if (env.NODE_ENV === "production") {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const userId = req.header("x-dev-user-id");
  const role = req.header("x-dev-role") as AuthUser["role"] | undefined;

  if (!userId || !role) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  req.authUser = { id: userId, role };
  next();
}
