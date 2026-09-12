/**
 * dsh-balance host:暴露 DeepSeek 官方账户余额给同源 WebUI。
 *
 * 设计要点:
 *  - 密钥只留在宿主侧。凭证优先走 cordis `credentials` 服务(~/.dsh/.credentials.yaml,
 *    引擎热监听该文件),取不到再回落进程环境变量 DEEPSEEK_API_KEY。
 *  - 同源只读路由 GET /api/dsh/balance 返回余额 JSON;浏览器侧只拿到数字,拿不到 key。
 *  - 服务端缓存 + in-flight 去重:多个标签页/多次轮询不会打爆上游。
 *  - 全部失败路径都返回结构化结果而不是抛错:上游挂了就回退最近一次成功值(stale),
 *    从未成功过则返回 ok:false,客户端据此静默隐藏,不打扰对话。
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-balance'
export const inject = ['webServer']

/** 同源只读路由(客户端由 conversation.composer.dock 上的组件轮询)。 */
const ROUTE_PATH = '/api/dsh/balance'
/** DeepSeek 官方余额接口。 */
const BALANCE_URL = 'https://api.deepseek.com/user/balance'
/** 受管存储/环境变量里的键名。 */
const API_KEY_REF = 'DEEPSEEK_API_KEY'
/** 上游查询缓存时长(ms)。 */
const CACHE_TTL_MS = 60_000
/** 上游请求超时(ms)。 */
const REQUEST_TIMEOUT_MS = 8_000
/** 最近一次成功值最多可以顶多久(超过则不再冒充新鲜数据)。 */
const MAX_STALE_MS = 30 * 60_000

/** 余额查询结果(线上契约,客户端按字段存在与否降级)。 */
export interface BalanceSnapshot {
  ok: boolean
  /** 账户是否可用(上游 is_available)。 */
  available?: boolean
  /** 币种,如 CNY / USD。 */
  currency?: string
  /** 总余额(上游为字符串,保留原样避免浮点误差)。 */
  total?: string
  /** 赠送余额。 */
  granted?: string
  /** 充值余额。 */
  toppedUp?: string
  /** 本次取数时间(ms)。 */
  fetchedAt?: number
  /** true = 上游查询失败、这是回退的旧值。 */
  stale?: boolean
  /** 失败原因(仅 ok=false 或 stale=true 时)。 */
  error?: string
}

/**
 * 取 API key:凭证服务优先(与引擎同一取值优先级),环境变量兜底。
 * @param ctx - cordis 上下文。
 * @returns 去空白后的 key,不可用时 null。
 */
async function resolveApiKey(ctx: Context): Promise<string | null> {
  const credentials = ctx.get('credentials') as
    | { resolve?: (ref: string) => Promise<unknown> }
    | undefined
  if (credentials !== undefined && typeof credentials.resolve === 'function') {
    try {
      const resolved = await credentials.resolve(API_KEY_REF)
      const value = typeof resolved === 'string'
        ? resolved
        : (resolved as { value?: unknown } | undefined)?.value
      if (typeof value === 'string' && value.trim() !== '') return value.trim()
    } catch {
      /* 凭证服务不可用 -> 回落环境变量 */
    }
  }
  const fromEnv = process.env[API_KEY_REF]
  return typeof fromEnv === 'string' && fromEnv.trim() !== '' ? fromEnv.trim() : null
}

/**
 * 查一次上游余额。
 * @param key - DeepSeek API key。
 * @returns 归一化后的快照(失败也是快照,不抛错)。
 */
async function queryBalance(key: string): Promise<BalanceSnapshot> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(BALANCE_URL, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) {
      return { ok: false, error: `http-${response.status}` }
    }
    const body = (await response.json()) as {
      is_available?: unknown
      balance_infos?: Array<Record<string, unknown>>
    }
    const info = Array.isArray(body.balance_infos) ? body.balance_infos[0] : undefined
    if (info === undefined || info === null) {
      return { ok: false, error: 'no-balance-info' }
    }
    const text = (value: unknown, fallback = ''): string =>
      value === undefined || value === null ? fallback : String(value)
    return {
      ok: true,
      available: body.is_available !== false,
      currency: text(info.currency, 'CNY'),
      total: text(info.total_balance, '0'),
      granted: text(info.granted_balance, '0'),
      toppedUp: text(info.topped_up_balance, '0'),
      fetchedAt: Date.now(),
    }
  } catch (error) {
    const aborted = (error as { name?: string } | undefined)?.name === 'AbortError'
    return { ok: false, error: aborted ? 'timeout' : 'network-error' }
  } finally {
    clearTimeout(timer)
  }
}

/** 带缓存的取数器:同一进程内所有调用共享一份缓存与同一次在途请求。 */
export class BalanceReader {
  private readonly ctx: Context
  private cached: BalanceSnapshot | null = null
  private cachedAt = 0
  private inflight: Promise<BalanceSnapshot> | null = null

  constructor(ctx: Context) {
    this.ctx = ctx
  }

  /**
   * 读取余额(命中缓存直接返回,否则合并同一次上游查询)。
   * @param force - true 时忽略缓存(本轮仍与在途请求合并)。
   * @returns 归一化快照。
   */
  async read(force = false): Promise<BalanceSnapshot> {
    const now = Date.now()
    if (!force && this.cached !== null && now - this.cachedAt < CACHE_TTL_MS) {
      return this.cached
    }
    if (this.inflight !== null) return this.inflight
    this.inflight = this.refresh().finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  /** 真正打上游一次,并把成功值/旧值回退逻辑都收在这里。 */
  private async refresh(): Promise<BalanceSnapshot> {
    const key = await resolveApiKey(this.ctx)
    if (key === null) {
      return { ok: false, error: 'no-api-key' }
    }
    const fresh = await queryBalance(key)
    if (fresh.ok) {
      this.cached = fresh
      this.cachedAt = Date.now()
      return fresh
    }
    // 上游失败:能用旧值就用旧值,并显式标注 stale,让客户端自行决定怎么呈现。
    const last = this.cached
    if (last !== null && Date.now() - this.cachedAt < MAX_STALE_MS) {
      return { ...last, stale: true, error: fresh.error }
    }
    return fresh
  }
}

/** 拒绝跨站读取(与页面同源的 fetch 才会带 sec-fetch-site: same-origin)。 */
function sameOrigin(request: { headers: Record<string, unknown> }): boolean {
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return true
  const host = request.headers.host
  if (typeof host !== 'string' || host === '') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/**
 * 组装只读路由(便于单测直接调用,不依赖 cordis)。
 * @param reader - 余额取数器。
 * @returns webServer.register 可用的路由描述。
 */
export function makeBalanceRoute(reader: BalanceReader) {
  return {
    kind: 'exact',
    path: ROUTE_PATH,
    async handler(request: any, response: any): Promise<void> {
      const send = (status: number, payload: BalanceSnapshot): void => {
        response.writeHead(status, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        response.end(JSON.stringify(payload))
      }
      if (!sameOrigin(request)) {
        send(403, { ok: false, error: 'cross-site-request-rejected' })
        return
      }
      if (request.method !== undefined && request.method !== 'GET' && request.method !== 'HEAD') {
        send(405, { ok: false, error: 'method-not-allowed' })
        return
      }
      try {
        const force = String(request.url ?? '').includes('force=1')
        send(200, await reader.read(force))
      } catch (error) {
        send(200, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
  }
}

/** cordis 入口:注册同源余额路由,随 fiber 释放。 */
export function apply(ctx: Context): void {
  const webServer = ctx.get('webServer') as
    | { register: (route: unknown) => unknown }
    | undefined
  if (webServer === undefined) return
  const reader = new BalanceReader(ctx)
  ctx.provide('balance' as never, reader as never)
  ctx.effect(
    () => webServer.register(makeBalanceRoute(reader)) as never,
    'dsh-balance: read-only balance route',
  )
}
