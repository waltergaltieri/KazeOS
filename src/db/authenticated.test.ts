// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createAuthenticatedDatabaseRunner } from "./authenticated";

describe("createAuthenticatedDatabaseRunner", () => {
  it("sets transaction-local verified claims and the authenticated role", async () => {
    const taggedCalls: Array<{ sql: string; values: unknown[] }> = [];
    const unsafe = vi.fn(async () => []);
    const transaction = Object.assign(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        taggedCalls.push({ sql: strings.join("$"), values });
        return [];
      },
      { unsafe },
    );
    const client = {
      begin: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const createDatabase = vi.fn(() => ({ scoped: true }));
    const operation = vi.fn(async (database) => database);
    const run = createAuthenticatedDatabaseRunner(
      client as never,
      createDatabase as never,
    );

    await expect(
      run("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", operation),
    ).resolves.toEqual({ scoped: true });

    expect(client.begin).toHaveBeenCalledOnce();
    expect(taggedCalls).toEqual([
      {
        sql: "select set_config('request.jwt.claims', $, true)",
        values: [
          JSON.stringify({
            sub: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            role: "authenticated",
          }),
        ],
      },
    ]);
    expect(unsafe).toHaveBeenCalledWith("set local role authenticated");
    expect(operation).toHaveBeenCalledWith({ scoped: true });
  });

  it("rejects an unverified non-UUID identity before opening a transaction", async () => {
    const client = { begin: vi.fn() };
    const run = createAuthenticatedDatabaseRunner(client as never, vi.fn() as never);

    await expect(run("attacker-controlled", vi.fn())).rejects.toThrow(
      "verified user id",
    );
    expect(client.begin).not.toHaveBeenCalled();
  });
});
