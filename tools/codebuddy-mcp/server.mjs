#!/usr/bin/env node
// ============================================================
// codebuddy-mcp —— 把腾讯 CodeBuddy CN CLI 包装成 MCP 工具服务器
//
// 目的：让 DeepSeek Harness（dsh）的 agent 能通过官方 `dsh-mcp-client`
// 把重活外包给 CodeBuddy CLI，从而消费 CodeBuddy 的免费额度 / 订阅额度。
//
// 设计取舍（重要）：
//  1. **零依赖**。MCP stdio 传输就是"换行分隔的 JSON-RPC"
//     （见 @modelcontextprotocol/sdk dist/esm/shared/stdio.js：
//      serializeMessage = JSON.stringify(msg) + '\n'，按首个 '\n' 切分）。
//     因此不引入 @modelcontextprotocol/sdk，避免在用户机器上再拉一棵依赖树。
//  2. **不做 token 搬运**。鉴权完全交给 codebuddy CLI 自己（凭据在 ~/.codebuddy），
//     本进程不接触、不转发任何密钥。
//  3. **stdout 只出 JSON-RPC**。任何日志一律走 stderr，否则会污染协议流。
//
// 工具：
//  · codebuddy_task   —— 无头执行一个编码任务（codebuddy -p）
//  · codebuddy_status —— 自检：CLI 位置 / 版本 / 官方模型清单 / 默认模型
//
// 环境变量：
//  · CODEBUDDY_MCP_BIN               自定义 codebuddy 入口（默认自动探测）
//  · CODEBUDDY_MCP_DEFAULT_MODEL     默认模型（默认 deepseek-v4.1-flash）
//  · CODEBUDDY_MCP_DEFAULT_PERMISSION 默认权限模式（默认 acceptEdits）
//  · CODEBUDDY_MCP_MAX_OUTPUT_CHARS  回传给模型的输出上限（默认 40000）
//  · CODEBUDDY_MCP_TIMEOUT_MS        默认任务超时（默认 1800000 = 30 分钟）
// ============================================================

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// ------------------------------------------------------------
// 常量
// ------------------------------------------------------------

const SERVER_NAME = 'codebuddy-mcp';
const SERVER_VERSION = '0.1.0';

/** MCP 协议版本：客户端请求的版本若在此列表内则原样回显，否则回退到稳妥版本 */
const SUPPORTED_PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
];
const FALLBACK_PROTOCOL_VERSION = '2025-06-18';

/** 默认模型：必须显式传，否则会沿用 ~/.codebuddy/settings.json 里可能存在的第三方 provider */
const DEFAULT_MODEL = process.env.CODEBUDDY_MCP_DEFAULT_MODEL?.trim() || 'deepseek-v4.1-flash';

/** 默认权限模式：acceptEdits 只自动放行文件编辑，Bash 等仍受管控，比 bypassPermissions 安全 */
const DEFAULT_PERMISSION_MODE = process.env.CODEBUDDY_MCP_DEFAULT_PERMISSION?.trim() || 'acceptEdits';

const VALID_PERMISSION_MODES = ['acceptEdits', 'bypassPermissions', 'default', 'plan', 'dontAsk', 'auto'];

const DEFAULT_TIMEOUT_MS = Number(process.env.CODEBUDDY_MCP_TIMEOUT_MS) || 30 * 60 * 1000;

/**
 * 超时硬上限（2 小时）。调用方可以调大 timeoutMs，但不能无限大——
 * 否则一个超大值就能让 CodeBuddy 子进程近乎永挂，把进程和额度都占住。
 */
const MAX_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const MIN_TIMEOUT_MS = 5_000;

const MAX_OUTPUT_CHARS = Number(process.env.CODEBUDDY_MCP_MAX_OUTPUT_CHARS) || 40_000;

/** 单次响应体上限：与 MCP SDK 默认 10MB 对齐，防止 CodeBuddy 吐出超长 transcript */
const MAX_STDOUT_BYTES = 16 * 1024 * 1024;

// ------------------------------------------------------------
// 日志（只走 stderr）
// ------------------------------------------------------------

function log(...parts) {
  try {
    process.stderr.write(`[${SERVER_NAME}] ${parts.map(String).join(' ')}\n`);
  } catch {
    /* stderr 已关闭：忽略 */
  }
}

// ------------------------------------------------------------
// codebuddy 可执行入口探测
// ------------------------------------------------------------

/**
 * 解析 codebuddy CLI 的启动方式。
 *
 * 优先级：
 *  1. CODEBUDDY_MCP_BIN 显式指定（相对/绝对路径，或裸命令名）
 *  2. %APPDATA%\npm\node_modules\@tencent-ai\codebuddy-code\bin\codebuddy
 *     —— npm 全局安装的真实 JS 入口，用 node 直接跑，不依赖 PATH/shim
 *  3. 裸命令 `codebuddy`（交给系统解析 PATH 上的 .cmd/.ps1 shim）
 *
 * @returns {{command: string, args: string[], label: string}}
 */
function resolveCodebuddy() {
  const explicit = process.env.CODEBUDDY_MCP_BIN?.trim();
  if (explicit) {
    // 显式给的是 .js/.mjs 时用 node 跑，否则当裸命令
    if (/\.(m?js|cjs)$/i.test(explicit)) {
      return { command: process.execPath, args: [explicit], label: explicit };
    }
    return { command: explicit, args: [], label: explicit };
  }

  const appData = process.env.APPDATA;
  if (appData) {
    const bin = path.join(
      appData,
      'npm',
      'node_modules',
      '@tencent-ai',
      'codebuddy-code',
      'bin',
      'codebuddy',
    );
    if (existsSync(bin)) {
      return { command: process.execPath, args: [bin], label: bin };
    }
  }

  return { command: 'codebuddy', args: [], label: 'codebuddy (PATH)' };
}

// ------------------------------------------------------------
// 子进程执行
// ------------------------------------------------------------

/** 正在运行的任务：requestId → { child, cancelled }，用于支持 MCP 取消 */
const running = new Map();

/**
 * 跑一次 codebuddy，收集 stdout/stderr 并按超时/取消终止。
 *
 * Windows 上 codebuddy 会派生孙进程（node-pty 等），child.kill() 杀不干净，
 * 因此超时后用 taskkill /T /F 杀整棵进程树。
 *
 * @param {string[]} args 传给 codebuddy 的参数
 * @param {{cwd?: string, timeoutMs: number, requestId: string|number|null}} opts
 * @returns {Promise<{code: number|null, signal: string|null, stdout: string, stderr: string, timedOut: boolean, cancelled: boolean}>}
 */
function runCodebuddy(args, opts) {
  const { command, args: pre, label } = resolveCodebuddy();
  const cwd = opts.cwd && existsSync(opts.cwd) ? opts.cwd : process.cwd();
  const argv = [...pre, ...args];

  log(`spawn: ${command} ${argv.join(' ')}  (cwd=${cwd})`);

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, argv, {
        cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });
    } catch (e) {
      resolve({
        code: null,
        signal: null,
        stdout: '',
        stderr: `spawn 失败（${label}）：${e instanceof Error ? e.message : String(e)}`,
        timedOut: false,
        cancelled: false,
      });
      return;
    }

    const state = { child, cancelled: false };
    if (opts.requestId !== null && opts.requestId !== undefined) running.set(opts.requestId, state);

    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let timedOut = false;
    let settled = false;

    const cleanup = () => {
      if (opts.requestId !== null && opts.requestId !== undefined) running.delete(opts.requestId);
      clearTimeout(timer);
    };

    /** 杀进程树：先 taskkill（Windows），失败再 child.kill */
    const killTree = () => {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          });
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        /* 进程可能已退出 */
      }
      try {
        child.kill();
      } catch {
        /* already dead */
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      log(`超时 ${opts.timeoutMs}ms，终止进程树 pid=${child.pid}`);
      killTree();
    }, opts.timeoutMs);
    timer.unref?.();

    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_STDOUT_BYTES) {
        if (!settled) {
          settled = true;
          cleanup();
          killTree();
          resolve({
            code: null,
            signal: null,
            stdout,
            stderr: `${stderr}\n[${SERVER_NAME}] stdout 超过 ${MAX_STDOUT_BYTES} 字节上限，已终止`,
            timedOut: false,
            cancelled: false,
          });
        }
        return;
      }
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      // stderr 只留尾部，避免超长日志挤爆内存
      stderr += chunk.toString('utf8');
      if (stderr.length > 20_000) stderr = stderr.slice(-10_000);
    });

    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        code: null,
        signal: null,
        stdout,
        stderr: `${stderr}\n[${SERVER_NAME}] ${label} 启动失败：${e.message}`,
        timedOut: false,
        cancelled: state.cancelled,
      });
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ code, signal, stdout, stderr, timedOut, cancelled: state.cancelled });
    });
  });
}

// ------------------------------------------------------------
// CodeBuddy 输出解析
// ------------------------------------------------------------

/**
 * 解析 `--output-format json` 的产物。
 *
 * 实测（codebuddy 2.143.0）：stdout 是一个 JSON **数组**，元素是完整 transcript，
 * 最后一个元素形如：
 *   { type:'result', subtype:'success', is_error:false, result:'<最终文本>',
 *     session_id, duration_ms, num_turns, total_cost_usd, usage{...},
 *     permission_denials:[...] }
 * 为兼容未来格式漂移，这里同时接受"数组"与"逐行 NDJSON"两种形态，
 * 并在拿不到 result 时回退到拼接 assistant 文本。
 *
 * @param {string} stdout
 * @returns {{result: string, subtype: string, isError: boolean, sessionId: string, numTurns: number|null, durationMs: number|null, costUsd: number|null, credit: number|null, permissionDenials: unknown[]}}
 */
function parseCodebuddyJson(stdout) {
  const empty = {
    result: '',
    subtype: '',
    isError: false,
    sessionId: '',
    numTurns: null,
    durationMs: null,
    costUsd: null,
    credit: null,
    permissionDenials: [],
  };

  const text = stdout.trim();
  if (!text) return empty;

  /** @type {any[]} */
  let items = [];
  try {
    const parsed = JSON.parse(text);
    items = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // 回退：逐行 NDJSON
    for (const line of text.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s === '[' || s === ']') continue;
      const body = s.endsWith(',') ? s.slice(0, -1) : s;
      try {
        items.push(JSON.parse(body));
      } catch {
        /* 跳过无法解析的行 */
      }
    }
  }

  const resultObj = [...items].reverse().find((it) => it && it.type === 'result');
  if (resultObj) {
    // credit 藏在 assistant message 的 providerData.rawUsage.credit 里
    let credit = null;
    for (const it of items) {
      const c = it?.providerData?.rawUsage?.credit;
      if (typeof c === 'number') credit = c;
    }
    return {
      result: typeof resultObj.result === 'string' ? resultObj.result : '',
      subtype: String(resultObj.subtype ?? ''),
      isError: Boolean(resultObj.is_error),
      sessionId: String(resultObj.session_id ?? ''),
      numTurns: typeof resultObj.num_turns === 'number' ? resultObj.num_turns : null,
      durationMs: typeof resultObj.duration_ms === 'number' ? resultObj.duration_ms : null,
      costUsd: typeof resultObj.total_cost_usd === 'number' ? resultObj.total_cost_usd : null,
      credit,
      permissionDenials: Array.isArray(resultObj.permission_denials) ? resultObj.permission_denials : [],
    };
  }

  // 没有 result 元素：拼接 assistant 文本
  const parts = [];
  for (const it of items) {
    if (it?.type !== 'message' || it?.role !== 'assistant') continue;
    for (const block of it.content ?? []) {
      if (block?.type === 'output_text' && typeof block.text === 'string') parts.push(block.text);
    }
    if (typeof it.content === 'string') parts.push(it.content);
  }
  return { ...empty, result: parts.join('\n\n') };
}

/** 截断过长输出，保留首尾 */
function truncate(s, max) {
  if (s.length <= max) return s;
  const head = Math.floor(max * 0.7);
  const tail = max - head;
  return `${s.slice(0, head)}\n\n…（已省略 ${s.length - max} 字符）…\n\n${s.slice(-tail)}`;
}

// ------------------------------------------------------------
// 工具定义
// ------------------------------------------------------------

const TOOLS = [
  {
    name: 'codebuddy_task',
    description:
      '把一个编码/调研任务交给腾讯 CodeBuddy CLI 无头执行，返回它的最终结论。' +
      '适合：需要独立长程跑一遍的编码任务、代码审查、跨文件重构、需要 CodeBuddy 独有模型能力的场景。' +
      '它会真实读写 cwd 下的文件（默认权限模式 acceptEdits 只自动放行文件编辑）。' +
      '注意：这是同步阻塞调用，长任务可能跑很多分钟；短问题请直接自己做，不要外包。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: '交给 CodeBuddy 的任务描述。应自包含：写清目标、约束、期望产出。',
        },
        cwd: {
          type: 'string',
          description: '任务的工作目录（绝对路径）。默认用 MCP server 自身的工作目录。',
        },
        model: {
          type: 'string',
          description: `CodeBuddy 模型 id，默认 ${DEFAULT_MODEL}。免费额度可用 hy3（credits=0）。`,
        },
        permissionMode: {
          type: 'string',
          enum: VALID_PERMISSION_MODES,
          description: '权限模式，默认 acceptEdits。需要 CodeBuddy 执行命令时用 bypassPermissions。',
        },
        maxTurns: {
          type: 'integer',
          description: '最大 agent 轮次上限（可选）。用于给长任务设一个刹车。',
        },
        timeoutMs: {
          type: 'integer',
          description: `超时毫秒数，默认 ${DEFAULT_TIMEOUT_MS}。超时会杀掉整棵进程树。`,
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'codebuddy_status',
    description:
      '自检 CodeBuddy CLI 的可用状态：入口路径、版本号、默认模型、以及 CLI 自报的官方模型清单。' +
      '在不确定 CodeBuddy 是否安装/登录、或想挑选免费模型时先调这个。不消耗模型额度。',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

// ------------------------------------------------------------
// 工具实现
// ------------------------------------------------------------

/** codebuddy_task 实现 */
async function toolCodebuddyTask(args, requestId) {
  const prompt = typeof args?.prompt === 'string' ? args.prompt.trim() : '';
  if (!prompt) {
    return { isError: true, text: 'codebuddy_task: 缺少必填参数 prompt' };
  }

  const model = typeof args?.model === 'string' && args.model.trim() ? args.model.trim() : DEFAULT_MODEL;
  const permissionMode =
    typeof args?.permissionMode === 'string' && VALID_PERMISSION_MODES.includes(args.permissionMode)
      ? args.permissionMode
      : DEFAULT_PERMISSION_MODE;
  const cwd = typeof args?.cwd === 'string' && args.cwd.trim() ? args.cwd.trim() : undefined;
  // 超时钳制在 [5s, 2h]：调用方可以调整，但不能传超大值让子进程永挂
  const timeoutMs = Number.isFinite(args?.timeoutMs)
    ? Math.min(Math.max(Number(args.timeoutMs), MIN_TIMEOUT_MS), MAX_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS;
  const maxTurns = Number.isFinite(args?.maxTurns) && args.maxTurns > 0 ? Math.floor(args.maxTurns) : null;

  // --model 必须显式传：否则会沿用 ~/.codebuddy/settings.json 里可能配置的第三方 provider，
  // 静默消耗用户自己的 key 而不是 CodeBuddy 额度。
  const argv = ['-p', prompt, '--output-format', 'json', '--model', model, '--permission-mode', permissionMode];
  if (maxTurns !== null) argv.push('--max-turns', String(maxTurns));
  if (cwd) argv.push('--add-dir', cwd);

  const t0 = Date.now();
  const r = await runCodebuddy(argv, { cwd, timeoutMs, requestId });
  const elapsed = Date.now() - t0;

  if (r.cancelled) {
    return { isError: true, text: 'codebuddy_task: 已被调用方取消' };
  }

  const parsed = parseCodebuddyJson(r.stdout);

  // 组装回给模型的可读摘要
  const meta = [
    `模型=${model}`,
    `权限=${permissionMode}`,
    parsed.numTurns !== null ? `轮次=${parsed.numTurns}` : null,
    `耗时=${(elapsed / 1000).toFixed(1)}s`,
    // 注：这是 CLI 在响应里上报的 credit 计数，语义未公开，只做展示、不做额度推断
    parsed.credit !== null ? `CLI 上报 credits=${parsed.credit}` : null,
    parsed.costUsd ? `cost_usd=${parsed.costUsd}` : null,
    parsed.sessionId ? `session=${parsed.sessionId}` : null,
  ]
    .filter(Boolean)
    .join('  ');

  if (r.timedOut) {
    return {
      isError: true,
      text: [
        `[CodeBuddy] ${meta}`,
        `任务超时（${timeoutMs}ms），已终止进程树。`,
        parsed.result ? `超时前已产出的内容：\n${truncate(parsed.result, MAX_OUTPUT_CHARS)}` : '',
        r.stderr ? `stderr 尾部：\n${truncate(r.stderr, 2000)}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    };
  }

  if (!parsed.result) {
    const detail = [
      r.code !== null ? `退出码=${r.code}` : null,
      r.signal ? `信号=${r.signal}` : null,
      r.stderr ? `stderr：\n${truncate(r.stderr, 4000)}` : null,
      r.stdout ? `stdout 头部：\n${truncate(r.stdout, 2000)}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    return {
      isError: true,
      text: `[CodeBuddy] ${meta}\n未能解析出结果。\n${detail || '（无任何输出）'}`,
    };
  }

  const denials = parsed.permissionDenials.length
    ? `\n\n⚠ 被权限拒绝的操作 ${parsed.permissionDenials.length} 项（可改用 permissionMode=bypassPermissions 重试）：\n` +
      truncate(JSON.stringify(parsed.permissionDenials, null, 2), 4000)
    : '';

  const failed = parsed.isError || (parsed.subtype && parsed.subtype !== 'success');
  return {
    isError: failed,
    text: `[CodeBuddy] ${meta}${failed ? `  subtype=${parsed.subtype}` : ''}\n\n${truncate(parsed.result, MAX_OUTPUT_CHARS)}${denials}`,
  };
}

/** codebuddy_status 实现 */
async function toolCodebuddyStatus() {
  const { command, args: pre, label } = resolveCodebuddy();

  const versionRun = await runCodebuddy(['--version'], { timeoutMs: 30_000, requestId: null });
  const version = (versionRun.stdout || versionRun.stderr || '').trim().split(/\r?\n/)[0] || '';

  // 从 --help 的 --model 选项说明里抽取官方模型清单（CLI 自报，非逆向）
  const helpRun = await runCodebuddy(['--help'], { timeoutMs: 30_000, requestId: null });
  const help = `${helpRun.stdout}\n${helpRun.stderr}`;
  let models = [];
  const m = help.match(/--model <model>[\s\S]*?Currently supported:\s*\(([^)]*)\)/);
  if (m) {
    models = m[1]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('custom-local:'));
  }

  const lines = [
    `入口：${label}`,
    `启动命令：${command}${pre.length ? ` ${pre.join(' ')}` : ''}`,
    `版本：${version || '（探测失败）'}`,
    `默认模型：${DEFAULT_MODEL}`,
    `默认权限模式：${DEFAULT_PERMISSION_MODE}`,
    `官方模型（CLI 自报，${models.length} 个）：${models.length ? models.join(', ') : '（解析失败）'}`,
    '',
    '说明：额度消耗取决于所选模型；hy3 在 CLI 缓存的目录中标记为 credits=0.00。',
  ];

  return {
    isError: !version,
    text: lines.join('\n'),
  };
}

/**
 * codebuddy_task 串行闸门。
 *
 * 协议层是并发的（见 stdin 处理注释），但真正跑 CodeBuddy 的任务必须互斥：
 * 多个 codebuddy_task 同时起飞会各自拉起一个 CodeBuddy agent，抢 CPU，也让
 * "先派谁"变得不可预测。这里用一条 promise 链把任务排队，后来的等前面的结束。
 *
 * 只包 codebuddy_task——codebuddy_status 是只读自检，没必要排队。
 */
let taskChain = Promise.resolve();
function withTaskSlot(fn) {
  const run = taskChain.then(fn, fn);
  // 吞掉异常，避免一次失败把后续排队任务全部带崩
  taskChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** 工具名 → 实现 */
const HANDLERS = {
  codebuddy_task: (args, requestId) => withTaskSlot(() => toolCodebuddyTask(args, requestId)),
  codebuddy_status: toolCodebuddyStatus,
};

// ------------------------------------------------------------
// JSON-RPC / MCP 协议层
// ------------------------------------------------------------

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

/** 处理一条已解析的 JSON-RPC 消息 */
async function handleMessage(msg) {
  const { id, method, params } = msg ?? {};
  const isNotification = id === undefined || id === null;
  log(`← ${method}${isNotification ? ' (notification)' : ` (id=${id})`}`);

  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : FALLBACK_PROTOCOL_VERSION;
      log(`initialize: 客户端请求 ${requested} → 协商 ${protocolVersion}`);
      sendResult(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
      return;
    }

    case 'notifications/initialized':
      log('客户端 initialized');
      return;

    case 'ping':
      sendResult(id, {});
      return;

    case 'tools/list':
      sendResult(id, { tools: TOOLS });
      return;

    case 'tools/call': {
      const name = params?.name;
      const args = params?.arguments ?? {};
      const handler = HANDLERS[name];
      if (!handler) {
        sendResult(id, {
          content: [{ type: 'text', text: `未知工具：${name}` }],
          isError: true,
        });
        return;
      }
      try {
        const out = await handler(args, id);
        sendResult(id, {
          content: [{ type: 'text', text: out.text }],
          isError: Boolean(out.isError),
        });
      } catch (e) {
        const message = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
        log(`tools/call ${name} 抛异常：`, message);
        sendResult(id, {
          content: [{ type: 'text', text: `codebuddy-mcp 内部错误：${message}` }],
          isError: true,
        });
      }
      return;
    }

    // MCP 取消通知：杀掉对应任务
    case 'notifications/cancelled': {
      const target = params?.requestId;
      const state = running.get(target);
      if (state) {
        log(`收到取消请求 requestId=${target}，终止进程树`);
        state.cancelled = true;
        try {
          if (process.platform === 'win32') {
            spawn('taskkill', ['/PID', String(state.child.pid), '/T', '/F'], {
              windowsHide: true,
              stdio: 'ignore',
            });
          } else {
            state.child.kill('SIGKILL');
          }
        } catch {
          /* ignore */
        }
        try {
          state.child.kill();
        } catch {
          /* ignore */
        }
      }
      return;
    }

    default:
      if (!isNotification) sendError(id, -32601, `Method not found: ${method}`);
      else log(`忽略未知通知：${method}`);
  }
}

// ------------------------------------------------------------
// stdin 读取：换行分隔 JSON（与 MCP SDK ReadBuffer 同语义）
// ------------------------------------------------------------

let buffer = '';

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  // 防止半条超大消息把内存吃满
  if (buffer.length > MAX_STDOUT_BYTES) {
    log('stdin 缓冲超限，丢弃');
    buffer = '';
    return;
  }
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).replace(/\r$/, '');
    buffer = buffer.slice(idx + 1);
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (e) {
      log('无法解析的 JSON-RPC 行：', e instanceof Error ? e.message : String(e));
      continue;
    }
    // 并发处理：JSON-RPC 靠 id 关联请求与响应，不依赖到达顺序。
    // 这一点是刻意的——`tools/call`（codebuddy_task）可能跑几分钟，
    // 若把它排进串行队列，紧随其后的 `notifications/cancelled` 会被堵在后面，
    // 取消功能就失效了。codebuddy_task 之间的互斥由 taskQueue 单独保证。
    void handleMessage(msg).catch((e) => {
      log('handleMessage 异常：', e instanceof Error ? e.message : String(e));
    });
  }
});

process.stdin.on('end', () => {
  log('stdin 关闭，退出');
  process.exit(0);
});

process.on('uncaughtException', (e) => {
  log('uncaughtException：', e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
});
process.on('unhandledRejection', (e) => {
  log('unhandledRejection：', e instanceof Error ? e.message : String(e));
});

log(`已启动（零依赖），默认模型=${DEFAULT_MODEL}，权限=${DEFAULT_PERMISSION_MODE}`);
