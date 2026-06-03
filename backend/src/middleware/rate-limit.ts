import type { NextFunction, Request, Response } from "express";

type Counter = { count: number; resetAt: number };
const memoryStore = new Map<string, Counter>();

export function memoryRateLimit(keyPrefix: string, limit: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${keyPrefix}:${req.ip ?? "unknown"}`;
    const now = Date.now();
    const current = memoryStore.get(key);

    if (!current || current.resetAt <= now) {
      memoryStore.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (current.count >= limit) {
      res.status(429).json({ message: "Too many requests" });
      return;
    }

    current.count += 1;
    memoryStore.set(key, current);
    next();
  };
}
