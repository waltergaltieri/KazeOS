// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createDatabaseClient } from "./client";

describe("createDatabaseClient", () => {
  it("creates a deliberately bounded postgres-js client", () => {
    const fakeClient = { end: vi.fn() };
    const postgresFactory = vi.fn(() => fakeClient);

    const client = createDatabaseClient(
      "postgresql://postgres:password@db.example.test/postgres",
      postgresFactory,
    );

    expect(client).toBe(fakeClient);
    expect(postgresFactory).toHaveBeenCalledWith(
      "postgresql://postgres:password@db.example.test/postgres",
      {
        prepare: false,
        max: 1,
        idle_timeout: 20,
        max_lifetime: 60 * 30,
      },
    );
  });
});
