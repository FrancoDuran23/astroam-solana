// Tests for CitrusClient (docs/citrus-mobile-spec.md v2 §7 R3): the error
// table and the retry policy over an injectable axios-shaped HTTP seam — the
// mapped CitrusApiError carries `retryable`/`retryAfterSeconds`, 429/502/503
// are re-attempted, 400/401/404/409 are not, 402 is the operational balance
// alert, `fund` and `provision` (both chargeable) are NEVER retried (R5), and
// transport/timeout errors fall back to the retryable set.

import { test } from "node:test";
import assert from "node:assert/strict";
import { AxiosError } from "axios";
import {
  CitrusClient,
  type HttpClient,
  type CitrusClientOptions,
  type CitrusEsim,
} from "./CitrusClient.ts";
import {
  CitrusApiError,
  CitrusResellerBalanceError,
  CitrusRateLimitedError,
} from "../../shared/citrus-errors.ts";

const API_BASE = "https://citrus.test/api/v2/reseller";

type HttpSpec = {
  get?: (url: string) => unknown;
  post?: (url: string, body?: unknown) => unknown;
  calls?: { get: Array<{ url: string }>; post: Array<{ url: string; body?: unknown }> };
};

function httpStub(spec: HttpSpec): HttpClient {
  const calls = spec.calls!;
  return {
    async get<T>(url: string): Promise<{ data: T }> {
      calls.get.push({ url });
      const result = spec.get!(url);
      if (result instanceof Error) throw result;
      return { data: result as T };
    },
    async post<T>(url: string, body?: unknown): Promise<{ data: T }> {
      calls.post.push({ url, body });
      const result = spec.post!(url, body);
      if (result instanceof Error) throw result;
      return { data: result as T };
    },
  };
}

function makeClient(spec: HttpSpec, over: Partial<CitrusClientOptions> = {}): {
  client: CitrusClient;
  calls: NonNullable<HttpSpec["calls"]>;
} {
  const calls = { get: [] as Array<{ url: string }>, post: [] as Array<{ url: string; body?: unknown }> };
  spec.calls = calls;
  const http = httpStub(spec);
  const citrus = new CitrusClient({
    apiKey: "rsk_test_0123456789",
    baseUrl: API_BASE,
    httpClient: http,
    sleep: async () => {}, // retries never wait on a real timer
    ...over,
  });
  return { client: citrus, calls };
}

function esimBody(): Record<string, unknown> {
  return {
    id: "esim_1",
    iccid: "895999000000000000",
    lpa_string: "LPA:1$smdp.plusq.com$RE7TFQ",
    qr_code: "data:image/png;base64,qr",
    direct_install_url: "https://direct",
    status: "active",
    wallet_balance_usd: 3.33,
    total_data_charged_usd: 1.0,
  };
}

function apiError(status: number, code: string, headers: Record<string, string> = {}): AxiosError {
  return new AxiosError(
    `Request failed with status code ${status}`,
    AxiosError.ERR_BAD_RESPONSE,
    undefined,
    undefined,
    { status, data: { error: code, message: "boom" }, headers, config: undefined } as never,
  );
}

function transportError(code: string): AxiosError {
  return new AxiosError("network bricked", code);
}

test("provision: sends end_user_reference and parses the eSIM (R4)", async () => {
  const { client, calls } = makeClient({ post: () => esimBody() });
  const esim = await client.provision({ endUserReference: "user-1", label: "trip" });
  const call = calls.post[0]!;
  assert.equal(call.url, `${API_BASE}/esim/provision`);
  assert.deepEqual(call.body, { endUserReference: "user-1", label: "trip" });
  assert.equal(esim.iccid, "895999000000000000");
  assert.equal(esim.status, "active");
  assert.equal(esim.walletBalanceUsd, 3.33);
});

test("detail: reads wallet + charged (U2) and parses", async () => {
  const { client, calls } = makeClient({ get: () => esimBody() });
  const esim = await client.detail("895999000000000000");
  assert.equal(calls.get[0]!.url, `${API_BASE}/esim/895999000000000000`);
  assert.equal(esim.totalDataChargedUsd, 1.0);
});

test("429 is retryable (up to 4 attempts) and a Retry-After wins", async () => {
  let tries = 0;
  const { client, calls } = makeClient({
    get: () => {
      tries += 1;
      if (tries < 3) throw apiError(429, "RATE_LIMITED", { "retry-after": "2" });
      return esimBody();
    },
  });
  const esim = await client.detail("x");
  assert.equal(esim.iccid, "895999000000000000");
  assert.equal(tries, 3);
});

test("the final 429 error (no success) carries retryAfterSeconds and is a CitrusRateLimitedError", async () => {
  const { client } = makeClient({ get: () => { throw apiError(429, "RATE_LIMITED", { "retry-after": "5" }); } });
  await assert.rejects(client.detail("x"), (error: unknown) => {
    assert.equal(error instanceof CitrusRateLimitedError, true);
    assert.equal(error instanceof CitrusApiError, true);
    assert.equal((error as CitrusRateLimitedError).retryAfterSeconds, 5);
    assert.equal((error as CitrusApiError).retryable, true);
    return true;
  });
});

test("502 and 503 are retryable", async () => {
  for (const status of [502, 503]) {
    let tries = 0;
    const { client } = makeClient({
      get: () => {
        tries += 1;
        if (tries < 2) throw apiError(status, "BAD_GATEWAY");
        return esimBody();
      },
    });
    const esim = await client.detail("x");
    assert.equal(esim.iccid, "895999000000000000");
    assert.equal(tries, 2);
  }
});

test("400/401/404/409 are NOT retryable: they fail with a single attempt", async () => {
  for (const status of [400, 401, 404, 409]) {
    let tries = 0;
    const { client } = makeClient({
      get: () => {
        tries += 1;
        throw apiError(status, "ESIM_NOT_FOUND");
      },
    });
    await assert.rejects(client.detail("x"), (error: unknown) => {
      assert.equal(error instanceof CitrusApiError, true);
      assert.equal((error as CitrusApiError).httpStatus, status);
      assert.equal((error as CitrusApiError).retryable, false);
      return true;
    });
    assert.equal(tries, 1);
  }
});

test("402 INSUFFICIENT_BALANCE → CitrusResellerBalanceError (operational alert, not retried)", async () => {
  let tries = 0;
  const { client } = makeClient({
    get: () => {
      tries += 1;
      throw apiError(402, "INSUFFICIENT_BALANCE");
    },
  });
  await assert.rejects(client.detail("x"), (error: unknown) => {
    assert.equal(error instanceof CitrusResellerBalanceError, true);
    assert.equal((error as CitrusApiError).httpStatus, 402);
    return true;
  });
  assert.equal(tries, 1);
});

test("a transport error (network down) maps to retryable and uses up its attempts", async () => {
  let tries = 0;
  const { client } = makeClient({
    get: () => {
      tries += 1;
      throw transportError("ECONNABORTED");
    },
  });
  await assert.rejects(client.detail("x"), (error: unknown) => {
    assert.equal((error as CitrusApiError).retryable, true);
    return true;
  });
  assert.equal(tries, 4);
});

test("fund is NOT retried: a 503 fails with a single attempt (R5: a blind retry would duplicate)", async () => {
  let tries = 0;
  const { client } = makeClient({
    post: () => {
      tries += 1;
      throw apiError(503, "SERVICE_UNAVAILABLE");
    },
  });
  await assert.rejects(client.fund("x", 3.33));
  assert.equal(tries, 1);
});

test("provision (chargeable, $1.75) is not retried either", async () => {
  let tries = 0;
  const { client } = makeClient({
    post: () => {
      tries += 1;
      throw apiError(503, "SERVICE_UNAVAILABLE");
    },
  });
  await assert.rejects(client.provision({ endUserReference: "user-1" }));
  assert.equal(tries, 1);
});

test("defund: parses the 202 and applies defaults to the assumed 202 (settles_in_minutes=15)", async () => {
  const { client } = makeClient({
    post: (url) => (url.includes("/defund") ? { settles_in_minutes: 20, estimated_return_usd: 2.5 } : {}),
  });
  const result = await client.defund("895999000000000000");
  assert.equal(result.settlesInMinutes, 20);
  assert.equal(result.estimatedReturnUsd, 2.5);

  const { client: bare } = makeClient({ post: () => ({}) });
  const defaults = await bare.defund("x");
  assert.equal(defaults.settlesInMinutes, 15);
  assert.equal(defaults.estimatedReturnUsd, 0);
});

test("a malformed response without iccid throws a non-retryable CitrusApiError", async () => {
  const { client } = makeClient({ post: () => ({ id: "esim_1" }) });
  await assert.rejects(client.provision({ endUserReference: "u" }), (error: unknown) => {
    assert.equal(error instanceof CitrusApiError, true);
    assert.equal((error as CitrusApiError).code, "MALFORMED_RESPONSE");
    assert.equal((error as CitrusApiError).retryable, false);
    return true;
  });
});