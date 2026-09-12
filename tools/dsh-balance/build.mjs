// 社区规范:源码仓库 + 构建脚本生成 lib/。esbuild 不检查类型。
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'

mkdirSync('lib', { recursive: true })

// host 侧:Node ESM,依赖由宿主 cordis 树解析,@deepseek-ai/* 一律 external。
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['@deepseek-ai/*'],
  sourcemap: true,
})

// client 侧:窗口加载器通过 window.__ModuleLoader__.load({ id, factory }) 注册插件
// client 模块;factory 内为 CommonJS 风格,require 由宿主 client-modules 提供
// (可 require 'react' 等引擎内置依赖)。id 必须等于包名(= boot graph 的 entry 名)。
await build({
  entryPoints: ['src/client.ts'],
  outfile: 'lib/client.js',
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  external: ['react'],
  banner: { js: `window.__ModuleLoader__.load({ id: "dsh-balance", factory: (require) => { var module = { exports: {} }; var exports = module.exports; Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });` },
  footer: { js: `return module.exports; } });` },
})

console.log('built dsh-balance (lib/index.js + lib/client.js)')
