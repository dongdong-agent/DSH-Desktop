// 只读探测:自签引擎会话 Cookie,取 3080 根页面,检查前端 boot graph 是否已含 dsh-balance。
// 不打印密钥、不打印 Cookie 值。
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash, createHmac } from 'node:crypto'

const PORT = 3080
const AUTHORITY = `127.0.0.1:${PORT}`
const RECORD = 'client-connection/browser-session'

const lines = readFileSync(join(homedir(), '.dsh', '.credentials.yaml'), 'utf8').split(/\r?\n/)
const start = lines.findIndex((l) => l.trim().startsWith(`${RECORD}:`))
if (start < 0) throw new Error('credentials 里没有 browser-session 记录')
const baseIndent = lines[start].length - lines[start].trimStart().length
let secret = null
for (let i = start + 1; i < lines.length; i++) {
  const raw = lines[i]
  if (!raw.trim() || raw.trim().startsWith('#')) continue
  if (raw.length - raw.trimStart().length <= baseIndent) break
  const m = raw.trim().match(/^secret:\s*(.+)$/)
  if (m) { secret = m[1].trim().replace(/^["']|["']$/g, ''); break }
}
if (secret === null) throw new Error('没解析到 secret')

const b64url = (buf) => Buffer.from(buf).toString('base64url')
const name = `dsh-auth-${b64url(createHash('sha256').update(AUTHORITY).digest())}`
const issuedAt = Date.now()
const body = b64url(Buffer.from(JSON.stringify({
  version: 1, authority: AUTHORITY, issuedAt, expiresAt: issuedAt + 29 * 24 * 3600 * 1000,
})))
const sig = b64url(createHmac('sha256', Buffer.from(secret, 'base64url')).update(body).digest())
const value = `v1.${body}.${sig}`

const response = await fetch(`http://${AUTHORITY}/`, { headers: { cookie: `${name}=${value}` } })
const html = await response.text()
console.log('HTTP', response.status, 'bytes', html.length)
console.log('页面是 401 文案页:', html.includes('authentication required'))
console.log('含 __DSH_BOOT__:', html.includes('__DSH_BOOT__'))
console.log('boot graph 含 dsh-balance:', html.includes('dsh-balance'))

// boot graph 里已注册的全部第三方/自有插件名,便于确认比对基准
const names = [...html.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1])
console.log('boot entry ids:', JSON.stringify([...new Set(names)].slice(0, 40), null, 0))

// 顺带确认客户端 bundle 是否可被宿主取到(路径由 boot graph 决定,取不到属正常)
const script = /<script[^>]+src="([^"]*dsh-balance[^"]*)"/.exec(html)
if (script !== null) {
  const r2 = await fetch(`http://${AUTHORITY}${script[1]}`, { headers: { cookie: `${name}=${value}` } })
  console.log('client bundle', script[1], '->', r2.status, (await r2.text()).length, 'bytes')
} else {
  console.log('client bundle: 页面里没有指向 dsh-balance 的 script 标签')
}
