// 与 tools/dsh-balance 同一工程形态：esbuild 产出 lib/，不检查类型。
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'

mkdirSync('lib', { recursive: true })

// host 侧：Node ESM，@deepseek-ai/* 一律 external（由宿主 cordis 树解析）。
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

// client 侧：window.__ModuleLoader__.load({ id, factory }) 注册；id 必须等于包名。
await build({
  entryPoints: ['src/client.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  external: ['react'],
  banner: { js: `window.__ModuleLoader__.load({ id: "dsh-tauri-dir-picker", factory: (require) => { var module = { exports: {} }; var exports = module.exports; Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });` },
  footer: { js: `return module.exports; } });` },
})

console.log('built dsh-tauri-dir-picker (lib/index.js + lib/client.js)')
