/**
 * dsh-tauri-dir-picker client：工作区「添加/选择目录」流程的占用方。
 *
 * 桌面壳（Tauri WebView，remote capability 放行后页面有 __TAURI__）：
 *   每次 open 上升沿直接弹**原生文件夹选择框**（plugin:dialog|open）。
 *   它是主窗口的 owned dialog，天然置顶、居中——这正是引擎自带原生后端
 *   （Show(null) 无 owner 窗口）做不到、因而当初被迫换 browse 的点。
 *
 * 外部浏览器 / IPC 未放行（无 __TAURI__ 或 invoke 抛错）：
 *   回落为应用内轻量浏览对话框（单栏 + 路径输入 + 面包屑 + 新建文件夹），
 *   数据仍走 browse 宿主后端的 directoryPicker/list|createDirectory。
 *
 * 契约与官方 -browse / -native 客户端半一致：属主给 open/busy/onPicked/
 * onCancel/onError 会话，每次打开恰好上报一个结果。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-tauri-dir-picker'
export const inject = ['slots', 'uiWorkspace']

/** 上次成功选择的目录（原生对话框下次从这里打开）。 */
const LAST_PATH_KEY = 'dsh-tauri-dir-picker:lastPath'

interface DirectoryEntry {
  name: string
  path: string
  hidden: boolean
}

interface DirectoryListing {
  path: string
  home: string
  crumbs: DirectoryEntry[]
  entries: DirectoryEntry[]
  truncated?: boolean
}

/** 属主会话 + 注入面（与官方 browse 占用方同形）。 */
interface FlowProps {
  open: boolean
  busy: boolean
  onPicked: (path: string) => void
  onCancel: () => void
  onError: (error: unknown) => void
  listDirectory: (path?: string, signal?: AbortSignal) => Promise<DirectoryListing>
  createDirectory: (path: string, name: string) => Promise<string>
}

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

/** 取 Tauri IPC 入口；非桌面壳（外部浏览器）返回 null。 */
function tauriInvoke(): Invoke | null {
  const t = (window as unknown as { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__
  return typeof t?.core?.invoke === 'function' ? t.core.invoke : null
}

/** 弹一次系统原生文件夹选择框；取消解析为 null。 */
async function nativePick(invoke: Invoke): Promise<string | null> {
  let defaultPath: string | undefined
  try {
    defaultPath = localStorage.getItem(LAST_PATH_KEY) ?? undefined
  } catch {
    defaultPath = undefined
  }
  const picked = await invoke('plugin:dialog|open', {
    options: { directory: true, multiple: false, title: '选择工作区目录', defaultPath },
  })
  return typeof picked === 'string' && picked !== '' ? picked : null
}

/**
 * 流程占用方：open 上升沿先试原生选择框；无 Tauri 或 IPC 被拒时切换到
 * 回落浏览对话框（armed 模式与官方 -native 一致：每次打开只发一次结果，
 * busy 期间的重渲染不会再弹一个选择框）。
 */
function TauriDirectoryFlow(props: FlowProps) {
  const [fallbackReason, setFallbackReason] = useState<string | null>(null)
  const armed = useRef(false)
  const outcome = useRef(props)
  outcome.current = props
  const alive = useRef(true)

  useEffect(() => () => { alive.current = false }, [])

  useEffect(() => {
    if (!props.open) {
      armed.current = false
      setFallbackReason(null)
      return
    }
    if (armed.current) return
    armed.current = true
    const invoke = tauriInvoke()
    if (invoke === null) {
      setFallbackReason('')
      return
    }
    nativePick(invoke).then(
      (path) => {
        if (!alive.current) return
        if (path === null) {
          outcome.current.onCancel()
          return
        }
        try {
          localStorage.setItem(LAST_PATH_KEY, path)
        } catch { /* 隐私模式下 localStorage 会抛，忽略即可 */ }
        outcome.current.onPicked(path)
      },
      (reason) => {
        if (alive.current) setFallbackReason(String((reason as Error)?.message ?? reason))
      },
    )
  }, [props.open])

  if (!props.open || fallbackReason === null) return null
  return <FallbackBrowser {...props} tauriError={fallbackReason} />
}

// ============================================================
// 回落对话框：外部浏览器场景的轻量浏览选择器
// ============================================================

const OVERLAY_STYLE: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0,0,0,.45)',
}

const CARD_STYLE: React.CSSProperties = {
  width: 560,
  maxWidth: '92vw',
  maxHeight: '80dvh',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '16px 18px',
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-2, #fff)',
  color: 'var(--dsw-alias-label-primary, #111)',
  boxShadow: '0 12px 48px rgba(0,0,0,.35)',
  fontSize: 13,
}

const LIST_STYLE: React.CSSProperties = {
  flex: 1,
  minHeight: 120,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
}

const ROW_STYLE: React.CSSProperties = {
  textAlign: 'left',
  border: 'none',
  borderRadius: 6,
  padding: '5px 8px',
  cursor: 'pointer',
  background: 'transparent',
  color: 'inherit',
  fontSize: 13,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const INPUT_STYLE: React.CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  height: 28,
  padding: '0 8px',
  borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-l2, #bbb)',
  background: 'transparent',
  color: 'inherit',
  fontSize: 13,
}

function FallbackBrowser(props: FlowProps & { tauriError: string }) {
  const { open, busy, onPicked, onCancel, listDirectory, createDirectory, tauriError } = props
  const [level, setLevel] = useState<DirectoryListing | null>(null)
  const [selected, setSelected] = useState<DirectoryEntry | null>(null)
  const [error, setError] = useState<string | null>(tauriError || null)
  const [loading, setLoading] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [folderName, setFolderName] = useState<string | null>(null)
  const [pathDraft, setPathDraft] = useState<string | null>(null)
  const seq = useRef(0)

  const navigate = useCallback((path?: string) => {
    const my = ++seq.current
    setLoading(true)
    listDirectory(path).then(
      (next) => {
        if (my !== seq.current) return
        setLevel(next)
        setSelected(null)
        setPathDraft(null)
        setLoading(false)
        setError(null)
      },
      (reason) => {
        if (my !== seq.current) return
        setLoading(false)
        setError(String((reason as Error)?.message ?? reason))
      },
    )
  }, [listDirectory])

  useEffect(() => {
    if (open) navigate(undefined)
    else seq.current++
  }, [open, navigate])

  if (!open) return null

  const targetPath = selected?.path ?? level?.path ?? null
  const entries = (level?.entries ?? []).filter((e) => showHidden || !e.hidden)

  const confirmCreate = () => {
    const parent = selected?.path ?? level?.path
    const name = (folderName ?? '').trim()
    if (parent === undefined || name === '' || busy) return
    createDirectory(parent, name).then(
      () => { setFolderName(null); navigate(parent) },
      (reason) => setError(String((reason as Error)?.message ?? reason)),
    )
  }

  return (
    <div style={OVERLAY_STYLE} role="dialog" aria-label="选择工作区目录">
      <div style={CARD_STYLE}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>选择工作区目录</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ flexShrink: 0 }}>路径</span>
          <input
            style={INPUT_STYLE}
            value={pathDraft ?? selected?.path ?? level?.path ?? ''}
            disabled={busy}
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === 'Enter') navigate((e.target as HTMLInputElement).value.trim() || undefined)
            }}
            onChange={(e) => setPathDraft(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {(level?.crumbs ?? []).map((crumb) => (
            <button
              key={crumb.path}
              type="button"
              style={{ ...ROW_STYLE, width: 'auto', padding: '2px 6px' }}
              disabled={busy}
              onClick={() => navigate(crumb.path)}
            >
              {crumb.name}
            </button>
          ))}
        </div>
        <div style={LIST_STYLE} role="list">
          {entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              role="listitem"
              style={{
                ...ROW_STYLE,
                background: entry.path === selected?.path ? 'var(--dsw-alias-interactive-bg-active, #e0e7ff)' : 'transparent',
              }}
              disabled={busy}
              onClick={() => setSelected(entry)}
              onDoubleClick={() => navigate(entry.path)}
              title={entry.path}
            >
              📁 {entry.name}
            </button>
          ))}
          {!loading && entries.length === 0 && <div style={{ padding: 8, opacity: .6 }}>（没有子目录）</div>}
          {loading && <div style={{ padding: 8, opacity: .6 }}>加载中…</div>}
          {level?.truncated === true && <div style={{ padding: '4px 8px', opacity: .6 }}>文件夹过多，仅显示开头部分。</div>}
        </div>
        {error !== null && <div style={{ color: 'var(--dsw-alias-state-error-primary, #c00)' }}>{error}</div>}
        {folderName !== null && (
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              style={INPUT_STYLE}
              autoFocus
              placeholder="新文件夹名称"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmCreate(); if (e.key === 'Escape') setFolderName(null) }}
            />
            <button type="button" style={{ ...ROW_STYLE, width: 'auto' }} disabled={busy || folderName.trim() === ''} onClick={confirmCreate}>创建</button>
            <button type="button" style={{ ...ROW_STYLE, width: 'auto' }} onClick={() => setFolderName(null)}>取消</button>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" style={{ ...ROW_STYLE, width: 'auto' }} disabled={busy || level === null} onClick={() => setFolderName('')}>新建文件夹</button>
          <button type="button" style={{ ...ROW_STYLE, width: 'auto' }} disabled={busy} aria-pressed={showHidden} onClick={() => setShowHidden((v) => !v)}>
            显示隐藏文件{showHidden ? ' ✓' : ''}
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" style={{ ...ROW_STYLE, width: 'auto' }} disabled={busy} onClick={onCancel}>取消</button>
          <button
            type="button"
            style={{ ...ROW_STYLE, width: 'auto', background: 'var(--dsw-alias-button-info-fill, #35f)', color: '#fff' }}
            disabled={busy || loading || targetPath === null}
            onClick={() => { if (targetPath !== null) onPicked(targetPath) }}
          >
            打开
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 注册：填满两个 directoryFlow 洞（与官方客户端半同一姿势）
// ============================================================

function apply(ctx: Context): void {
  const injected = () => ({
    listDirectory: (path?: string, signal?: AbortSignal) =>
      (ctx.uiWorkspace as unknown as { listDirectory: (p?: string, s?: AbortSignal) => Promise<DirectoryListing> }).listDirectory(path, signal),
    createDirectory: (path: string, name: string) =>
      (ctx.uiWorkspace as unknown as { createDirectory: (p: string, n: string) => Promise<string> }).createDirectory(path, name),
  })
  ctx.slots.inject('conversation.hero.workspace.directoryFlow', () =>
    ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
      yield ctx.slots.register({ name: 'conversation.hero.workspace.directoryFlow', inject: injected }, TauriDirectoryFlow)
      yield ctx.slots.register({ name: 'sidebar.workspaces.directoryFlow', inject: injected }, TauriDirectoryFlow)
    }))
}

export { apply }
