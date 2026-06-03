import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import { env } from "../src/config/env.js";
import { requireAuth } from "../src/middleware/auth.js";
import { tokenService } from "../src/services/token-service.js";

type ResponseRecord = {
  statusCode?: number;
  body?: unknown;
};

function makeResponse(): { res: Response; record: ResponseRecord } {
  const record: ResponseRecord = {};
  const res = {
    status(code: number) {
      record.statusCode = code;
      return res;
    },
    json(body: unknown) {
      record.body = body;
      return res;
    }
  } as Response;

  return { res, record };
}

function makeRequest(headers: Record<string, string | undefined>): Request {
  return {
    header(name: string) {
      return headers[name.toLowerCase()];
    }
  } as Request;
}

test("refresh tokens can be verified from signed claims", async () => {
  const claims = {
    sub: "user-1",
    email: "user@example.com",
    role: "USER" as const,
    profileType: "INDIVIDUAL" as const
  };

  const token = await tokenService.signRefreshToken(claims);
  const verified = await tokenService.verifyRefreshToken(token);

  assert.equal(verified.sub, claims.sub);
  assert.equal(verified.email, claims.email);
  assert.equal(verified.role, claims.role);
  assert.equal(verified.profileType, claims.profileType);
});

test("dev auth headers are rejected in production", () => {
  const previousNodeEnv = env.NODE_ENV;
  env.NODE_ENV = "production";

  try {
    const req = makeRequest({
      "x-dev-user-id": "user-1",
      "x-dev-role": "USER"
    });
    const { res, record } = makeResponse();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    requireAuth(req, res, next);

    assert.equal(nextCalled, false);
    assert.equal(record.statusCode, 401);
    assert.deepEqual(record.body, { message: "Unauthorized" });
  } finally {
    env.NODE_ENV = previousNodeEnv;
  }
});

test("dev auth headers remain available outside production", () => {
  const previousNodeEnv = env.NODE_ENV;
  env.NODE_ENV = "development";

  try {
    const req = makeRequest({
      "x-dev-user-id": "user-1",
      "x-dev-role": "ADMIN"
    });
    const { res } = makeResponse();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    requireAuth(req, res, next);

    assert.equal(nextCalled, true);
    assert.deepEqual(req.authUser, { id: "user-1", role: "ADMIN" });
  } finally {
    env.NODE_ENV = previousNodeEnv;
  }
});
