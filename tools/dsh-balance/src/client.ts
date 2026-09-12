/**
 * dsh-balance client:把 DeepSeek 官方余额挂在输入卡片下方的那条 dock 上。
 *
 * 官方 slot `conversation.composer.dock`(kind=list / scope=session)就是"输入框
 * 下方那一条"——官方自带的会话统计行 StatsLine 用 id 'stats'、order 0 占在这里;
 * 本插件用 id 'balance'、order 100 追加在自己的格子里,不替换官方任何内容。
 *
 * 数据来自宿主同源只读路由 GET /api/dsh/balance(见 src/index.ts),客户端不接触密钥。
 */
import React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'

export const name = 'dsh-balance'
export const inject = ['slots']

/** slot 内的格子 id:全新 id = 与官方 stats 行并存,不会顶掉它。 */
const SLOT_ID = 'balance'
/** 轮询间隔(ms):宿主侧另有 60s 缓存,这里只是把新值取回页面。 */
const POLL_INTERVAL_MS = 60_000
/** 宿主路由。 */
const ENDPOINT = '/api/dsh/balance'
/** 余额低于该值时用警示色提示(单位同币种,仅对 CNY/USD 做视觉提醒)。 */
const LOW_BALANCE_THRESHOLD = 5

interface BalancePayload {
  ok?: boolean
  available?: boolean
  currency?: string
  total?: string
  granted?: string
  toppedUp?: string
  fetchedAt?: number
  stale?: boolean
  error?: string
}

/** 与官方 StatsLine 同一套排版(12/20 tertiary 文本、内容列宽、居中)。 */
const LINE_STYLE: React.CSSProperties = {
  display: 'block',
  textAlign: 'center',
  maxWidth: 'var(--dsh-chat-content-width)',
  width: '100%',
  margin: '0 auto',
  boxSizing: 'border-box',
  padding: '0 calc(var(--dsh-composer-side-clearance) + 16px) 2px',
  fontSize: 12,
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-tertiary)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

/** 币种符号:认识的用符号,不认识的用代码前缀。 */
function currencySymbol(currency: string): string {
  if (currency === 'CNY') return '¥'
  if (currency === 'USD') return '$'
  return `${currency} `
}

/** 金额原样透传,只做显示层的最小归一(去掉无意义的尾随零)。 */
function formatAmount(raw: string | undefined): string {
  if (raw === undefined || raw === '') return '--'
  const value = Number(raw)
  if (!Number.isFinite(value)) return raw
  return String(Math.round(value * 100) / 100)
}

/** 本地时间 HH:MM / HH:MM:SS。 */
function formatTime(at: number | undefined): string {
  if (at === undefined) return ''
  const date = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 悬浮提示:完整的三个口径 + 取数时间 + 降级原因。 */
function tooltipFor(payload: BalancePayload, symbol: string): string {
  const lines = [
    'DeepSeek 官方账户余额',
    `总余额 ${symbol}${formatAmount(payload.total)}(充值 ${symbol}${formatAmount(payload.toppedUp)} / 赠送 ${symbol}${formatAmount(payload.granted)})`,
  ]
  const at = formatTime(payload.fetchedAt)
  if (at !== '') lines.push(`更新于 ${at}`)
  if (payload.stale === true) lines.push(`上游查询失败(${payload.error ?? 'unknown'}),显示的是最近一次成功值`)
  return lines.join('\n')
}

const BalanceLine = React.memo(function BalanceLine(): React.ReactElement | null {
  const [payload, setPayload] = React.useState<BalancePayload | null>(null)

  React.useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const response = await fetch(ENDPOINT, {
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        })
        const body = (await response.json()) as BalancePayload
        if (alive) setPayload(body)
      } catch {
        /* 拿不到就保持上一次的值(或保持隐藏),绝不打断对话 */
      }
    }
    void load()
    const timer = window.setInterval(() => {
      // 后台标签页不轮询,回到前台立刻补一次。
      if (document.visibilityState === 'visible') void load()
    }, POLL_INTERVAL_MS)
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      alive = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // 首次成功前、以及宿主明确报不可用时都不占位:这条线上不加噪音。
  if (payload === null || payload.ok !== true || payload.available === false) {
    if (payload !== null && payload.available === false) {
      return el('div', { style: { ...LINE_STYLE, color: 'var(--dsw-alias-label-tertiary)' }, 'data-dsh-balance': 'unavailable' }, 'DeepSeek 余额不可用')
    }
    return null
  }

  const currency = payload.currency ?? 'CNY'
  const symbol = currencySymbol(currency)
  const totalText = formatAmount(payload.total)
  const low = Number(payload.total) <= LOW_BALANCE_THRESHOLD
  const style: React.CSSProperties = { ...LINE_STYLE }
  if (payload.stale === true) style.color = 'var(--dsw-alias-label-secondary, inherit)'
  if (low) style.color = 'var(--dsw-alias-label-warning, inherit)'

  const suffix = payload.stale === true ? ' · 缓存' : ''
  return el(
    'div',
    {
      style,
      title: tooltipFor(payload, symbol),
      'data-dsh-balance': payload.stale === true ? 'stale' : 'fresh',
    },
    `DeepSeek 余额 ${symbol}${totalText}${suffix}`,
  )
})

/** 无 JSX 构建(esbuild 不开 jsx),用 createElement 组装。 */
function el(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): React.ReactElement {
  return (React.createElement as (...args: unknown[]) => React.ReactElement)(type, props, ...children)
}

/**
 * cordis 客户端入口:等 dock 这个 slot 被会话页声明出来后,追加自己的格子。
 * @param ctx - 客户端 cordis 上下文。
 */
export function apply(ctx: Context): void {
  const slots = ctx.get('slots') as
    | {
        inject: (name: string, callback: () => unknown) => void
        register: (options: Record<string, unknown>, component: unknown) => unknown
      }
    | undefined
  if (slots === undefined) return
  slots.inject('conversation.composer.dock', () =>
    slots.register(
      {
        name: 'conversation.composer.dock',
        id: SLOT_ID,
        order: 100,
        label: 'DeepSeek 余额',
      },
      BalanceLine,
    ),
  )
}
