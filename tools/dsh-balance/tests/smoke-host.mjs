// 宿主侧冒烟:用真实凭证走一遍 lib/index.js 的路由处理器。
// 只打印余额载荷,绝不打印密钥。
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { BalanceReader, makeBalanceRoute } from '../lib/index.js'

const yaml = readFileSync(join(homedir(), '.dsh', '.credentials.yaml'), 'utf8')
const match = /^\s*DEEPSEEK_API_KEY\s*:\s*(\S+)\s*$/m.exec(yaml)
if (match === null) throw new Error('credentials 里没有 DEEPSEEK_API_KEY')
const key = match[1].replace(/^["']|["']$/g, '')

const ctx = {
  get: (name) => (name === 'credentials' ? { resolve: async () => ({ value: key }) } : undefined),
}
const reader = new BalanceReader(ctx)
const route = makeBalanceRoute(reader)

const ask = async (req) => {
  const seen = []
  const res = {
    writeHead: (status) => seen.push({ status }),
    end: (body) => seen.push({ body }),
  }
  await route.handler(req, res)
  return { status: seen[0]?.status, body: JSON.parse(seen[1]?.body ?? 'null') }
}

const sameOrigin = {
  method: 'GET',
  url: '/api/dsh/balance',
  headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin' },
}

console.log('1) 首次(真实上游):', JSON.stringify(await ask(sameOrigin)))

const t0 = Date.now()
console.log('2) 二次(应命中缓存):', JSON.stringify(await ask(sameOrigin)), `耗时 ${Date.now() - t0}ms`)

console.log('3) 跨站请求:', JSON.stringify(await ask({
  method: 'GET',
  url: '/api/dsh/balance',
  headers: { host: '127.0.0.1:3080', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
})))

console.log('4) 非 GET:', JSON.stringify(await ask({
  method: 'POST',
  url: '/api/dsh/balance',
  headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin' },
})))

// 无凭证:换一个既没有 credentials 服务的 ctx,并清掉环境变量回落。
const savedEnv = process.env.DEEPSEEK_API_KEY
delete process.env.DEEPSEEK_API_KEY
const blindRoute = makeBalanceRoute(new BalanceReader({ get: () => undefined }))
const blindSeen = []
await blindRoute.handler(sameOrigin, {
  writeHead: (status) => blindSeen.push({ status }),
  end: (body) => blindSeen.push({ body }),
})
console.log('5) 无凭证:', blindSeen[0]?.status, blindSeen[1]?.body)
if (savedEnv !== undefined) process.env.DEEPSEEK_API_KEY = savedEnv
