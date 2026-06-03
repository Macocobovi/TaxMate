import type { NextFunction, Request, Response } from "express";
import type { AuthUser } from "./auth.js";

export function requireRole(allowedRoles: AuthUser["role"][]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.authUser || !allowedRoles.includes(req.authUser.role)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    next();
  };
}
