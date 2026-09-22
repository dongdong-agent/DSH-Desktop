/**
 * dsh-tauri-dir-picker host：纯挂载点。
 *
 * 目录列举/创建的数据面由 cordis.patch.yml 插入的 browse 宿主后端承担，
 * 原生选择框走的是桌面壳（Tauri）的 IPC，不经过引擎宿主。本包宿主半
 * 没有需要注册的服务，存在的意义是让 bundle 的 main 入口合法。
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-tauri-dir-picker'

export function apply(_ctx: Context): void {}
