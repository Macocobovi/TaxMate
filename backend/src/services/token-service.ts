import { SignJWT, jwtVerify } from "jose";
import { env } from "../config/env.js";

const jwtSecret = new TextEncoder().encode(env.JWT_SECRET);
const jwtRefreshSecret = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

export type AuthClaims = {
  sub: string;
  email: string;
  role: "USER" | "ADMIN" | "SUPER_ADMIN";
  profileType?: "INDIVIDUAL" | "BUSINESS";
};

export class TokenService {
  async signAccessToken(claims: AuthClaims): Promise<string> {
    const payload: Record<string, string> = {
      email: claims.email,
      role: claims.role
    };
    if (claims.profileType) {
      payload.profileType = claims.profileType;
    }

    return await new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(jwtSecret);
  }

  async signRefreshToken(claims: AuthClaims): Promise<string> {
    const payload: Record<string, string> = {
      email: claims.email,
      role: claims.role
    };
    if (claims.profileType) {
      payload.profileType = claims.profileType;
    }

    return await new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(jwtRefreshSecret);
  }

  async verifyAccessToken(token: string): Promise<AuthClaims> {
    const { payload } = await jwtVerify(token, jwtSecret);
    return {
      sub: String(payload.sub),
      email: String(payload.email),
      role: payload.role as AuthClaims["role"],
      profileType: typeof payload.profileType === "string" ? payload.profileType as AuthClaims["profileType"] : undefined
    };
  }

  async verifyRefreshToken(token: string): Promise<AuthClaims> {
    const { payload } = await jwtVerify(token, jwtRefreshSecret);
    return {
      sub: String(payload.sub),
      email: String(payload.email),
      role: payload.role as AuthClaims["role"],
      profileType: typeof payload.profileType === "string" ? payload.profileType as AuthClaims["profileType"] : undefined
    };
  }
}

export const tokenService = new TokenService();
