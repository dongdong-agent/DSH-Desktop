#!/usr/bin/env node
// ============================================================
// codebuddy-mcp 冒烟测试客户端（P0 验证用）
//
// 直接以子进程方式启动 server.mjs，按 MCP stdio 协议走一遍：
//   initialize → notifications/initialized → tools/list → tools/call
// 用来在接入 dsh 之前确认协议层与 CLI 调用链都是通的。
//
// 用法：
//   node test-client.mjs               # 只测 status（不烧额度）
//   node test-client.mjs --with-task   # 额外跑一次真实 codebuddy_task
//   node test-client.mjs --with-task --model hy3
// ============================================================

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, 'server.mjs');

const argv = process.argv.slice(2);
const withTask = argv.includes('--with-task');
const modelIdx = argv.indexOf('--model');
const model = modelIdx >= 0 ? argv[modelIdx + 1] : undefined;

const child = spawn(process.execPath, [SERVER], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});

const pending = new Map();
let nextId = 1;
let buffer = '';

child.stderr.on('data', (c) => process.stderr.write(`[server] ${c}`));

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let i;
  while ((i = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.log(`<< 非 JSON 输出: ${line.slice(0, 200)}`);
      continue;
    }
    const waiter = pending.get(msg.id);
    if (waiter) {
      pending.delete(msg.id);
      waiter(msg);
    } else {
      console.log(`<< 未关联响应: ${JSON.stringify(msg).slice(0, 200)}`);
    }
  }
});

function call(method, params, timeoutMs = 300_000) {
  const id = nextId++;
  const msg = { jsonrpc: '2.0', id, method, params };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} 超时（${timeoutMs}ms）`));
    }, timeoutMs);
    pending.set(id, (m) => {
      clearTimeout(timer);
      resolve(m);
    });
    child.stdin.write(`${JSON.stringify(msg)}\n`);
  });
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

function assert(cond, label) {
  console.log(`${cond ? '  ✅' : '  ❌'} ${label}`);
  if (!cond) process.exitCode = 1;
}

function textOf(res) {
  return (res?.result?.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

try {
  console.log('\n[1] initialize');
  const init = await call('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'codebuddy-mcp-test', version: '0.1.0' },
  });
  console.log(`  → protocolVersion=${init.result?.protocolVersion} serverInfo=${JSON.stringify(init.result?.serverInfo)}`);
  assert(!!init.result?.protocolVersion, '协商到协议版本');
  assert(init.result?.capabilities?.tools !== undefined, '声明了 tools 能力');

  notify('notifications/initialized', {});

  console.log('\n[2] tools/list');
  const list = await call('tools/list', {}, 30_000);
  const names = (list.result?.tools ?? []).map((t) => t.name);
  console.log(`  → ${names.join(', ')}`);
  assert(names.includes('codebuddy_task'), '有 codebuddy_task');
  assert(names.includes('codebuddy_status'), '有 codebuddy_status');

  console.log('\n[3] tools/call codebuddy_status');
  const status = await call('tools/call', { name: 'codebuddy_status', arguments: {} }, 120_000);
  console.log(textOf(status).split('\n').map((l) => `  | ${l}`).join('\n'));
  assert(status.result?.isError !== true, 'status 调用未报错');

  if (withTask) {
    console.log(`\n[4] tools/call codebuddy_task${model ? ` (model=${model})` : ''}`);
    const args = { prompt: '只回复两个字：可用。不要读写任何文件。' };
    if (model) args.model = model;
    const t0 = Date.now();
    const task = await call('tools/call', { name: 'codebuddy_task', arguments: args }, 600_000);
    console.log(`  （耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
    console.log(textOf(task).split('\n').map((l) => `  | ${l}`).join('\n'));
    assert(task.result?.isError !== true, 'task 调用未报错');
  } else {
    console.log('\n[4] 跳过 codebuddy_task（加 --with-task 才会真实调用）');
  }

  console.log(`\n结果：${process.exitCode ? '有失败项 ❌' : '全部通过 ✅'}\n`);
} finally {
  child.stdin.end();
  setTimeout(() => child.kill(), 500).unref();
}
