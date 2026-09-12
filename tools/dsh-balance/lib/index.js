// src/index.ts
var name = "dsh-balance";
var inject = ["webServer"];
var ROUTE_PATH = "/api/dsh/balance";
var BALANCE_URL = "https://api.deepseek.com/user/balance";
var API_KEY_REF = "DEEPSEEK_API_KEY";
var CACHE_TTL_MS = 6e4;
var REQUEST_TIMEOUT_MS = 8e3;
var MAX_STALE_MS = 30 * 6e4;
async function resolveApiKey(ctx) {
  const credentials = ctx.get("credentials");
  if (credentials !== void 0 && typeof credentials.resolve === "function") {
    try {
      const resolved = await credentials.resolve(API_KEY_REF);
      const value = typeof resolved === "string" ? resolved : resolved?.value;
      if (typeof value === "string" && value.trim() !== "") return value.trim();
    } catch {
    }
  }
  const fromEnv = process.env[API_KEY_REF];
  return typeof fromEnv === "string" && fromEnv.trim() !== "" ? fromEnv.trim() : null;
}
async function queryBalance(key) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(BALANCE_URL, {
      headers: { authorization: `Bearer ${key}`, accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) {
      return { ok: false, error: `http-${response.status}` };
    }
    const body = await response.json();
    const info = Array.isArray(body.balance_infos) ? body.balance_infos[0] : void 0;
    if (info === void 0 || info === null) {
      return { ok: false, error: "no-balance-info" };
    }
    const text = (value, fallback = "") => value === void 0 || value === null ? fallback : String(value);
    return {
      ok: true,
      available: body.is_available !== false,
      currency: text(info.currency, "CNY"),
      total: text(info.total_balance, "0"),
      granted: text(info.granted_balance, "0"),
      toppedUp: text(info.topped_up_balance, "0"),
      fetchedAt: Date.now()
    };
  } catch (error) {
    const aborted = error?.name === "AbortError";
    return { ok: false, error: aborted ? "timeout" : "network-error" };
  } finally {
    clearTimeout(timer);
  }
}
var BalanceReader = class {
  ctx;
  cached = null;
  cachedAt = 0;
  inflight = null;
  constructor(ctx) {
    this.ctx = ctx;
  }
  /**
   * 读取余额(命中缓存直接返回,否则合并同一次上游查询)。
   * @param force - true 时忽略缓存(本轮仍与在途请求合并)。
   * @returns 归一化快照。
   */
  async read(force = false) {
    const now = Date.now();
    if (!force && this.cached !== null && now - this.cachedAt < CACHE_TTL_MS) {
      return this.cached;
    }
    if (this.inflight !== null) return this.inflight;
    this.inflight = this.refresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }
  /** 真正打上游一次,并把成功值/旧值回退逻辑都收在这里。 */
  async refresh() {
    const key = await resolveApiKey(this.ctx);
    if (key === null) {
      return { ok: false, error: "no-api-key" };
    }
    const fresh = await queryBalance(key);
    if (fresh.ok) {
      this.cached = fresh;
      this.cachedAt = Date.now();
      return fresh;
    }
    const last = this.cached;
    if (last !== null && Date.now() - this.cachedAt < MAX_STALE_MS) {
      return { ...last, stale: true, error: fresh.error };
    }
    return fresh;
  }
};
function sameOrigin(request) {
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = request.headers.origin;
  if (typeof origin !== "string" || origin === "" || origin === "null") return true;
  const host = request.headers.host;
  if (typeof host !== "string" || host === "") return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
function makeBalanceRoute(reader) {
  return {
    kind: "exact",
    path: ROUTE_PATH,
    async handler(request, response) {
      const send = (status, payload) => {
        response.writeHead(status, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store"
        });
        response.end(JSON.stringify(payload));
      };
      if (!sameOrigin(request)) {
        send(403, { ok: false, error: "cross-site-request-rejected" });
        return;
      }
      if (request.method !== void 0 && request.method !== "GET" && request.method !== "HEAD") {
        send(405, { ok: false, error: "method-not-allowed" });
        return;
      }
      try {
        const force = String(request.url ?? "").includes("force=1");
        send(200, await reader.read(force));
      } catch (error) {
        send(200, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  };
}
function apply(ctx) {
  const webServer = ctx.get("webServer");
  if (webServer === void 0) return;
  const reader = new BalanceReader(ctx);
  ctx.provide("balance", reader);
  ctx.effect(
    () => webServer.register(makeBalanceRoute(reader)),
    "dsh-balance: read-only balance route"
  );
}
export {
  BalanceReader,
  apply,
  inject,
  makeBalanceRoute,
  name
};
//# sourceMappingURL=index.js.map
