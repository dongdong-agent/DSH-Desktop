import { useEffect, useState } from "react";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { ShieldCheck, Trash2 } from "lucide-react";
import { useEngineStore } from "../stores/engineStore";
import { useSessionStore } from "../stores/sessionStore";
import { useChatStore } from "../stores/chatStore";
import {
  getDshVersion,
  restartEngine,
  isVerifiedVersion,
  pinEngineVersion,
  rollbackVersion,
  addVerifiedVersion,
} from "../lib/dshEngine";
import {
  installKernel,
  clearLatestVersionCache,
  listInstalledKernels,
  removeKernel,
  normalizeDshVersion,
} from "../lib/updater";

/** 底部状态栏：引擎状态 / 模型 / 会话数 / 缩放级别 */
export function StatusBar({
  zoom = 1,
  onZoomChange,
}: {
  zoom?: number;
  onZoomChange?: (next: number) => void;
}) {
  const health = useEngineStore((s) => s.health);
  const sessions = useSessionStore((s) => s.sessions);
  const generating = useChatStore((s) => s.generating);
  const [version, setVersion] = useState("");
  const [rolling, setRolling] = useState(false);
  const [marking, setMarking] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  // 标记已验证后强制重渲染（isVerifiedVersion 读模块级缓存，组件需要感知变化）
  const [verifiedTick, setVerifiedTick] = useState(0);

  const refreshVersion = () => void getDshVersion().then(setVersion);
  useEffect(refreshVersion, []);
  // 引擎重启（升级/回滚后）→ health 重新变为 running → 重新探测版本号。
  // 不这么做的话，升级后状态栏会一直显示旧版本（getDshVersion 的缓存已被 pinEngineVersion 清除）
  useEffect(() => {
    if (health.status === "running") refreshVersion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health.status]);

  // "unknown"（版本探测失败）不是新内核，不显示未验证警告——避免误导用户去回滚。
  // verifiedTick 作为「标记已验证」后的重渲染依赖（isVerifiedVersion 读模块级缓存，
  // 标记后缓存已更新，组件重渲染即解除警告；>= 0 恒真，仅用于让 TS 感知依赖）
  const newKernel = version !== "" && version !== "unknown" && !isVerifiedVersion(version) && verifiedTick >= 0;
  const rollback = rollbackVersion();

  // 标记当前版本为已验证：写入白名单配置文件（无需改代码重新打包），未验证警告消失
  const handleMarkVerified = async () => {
    if (!version || version === "unknown" || marking) return;
    setMarking(true);
    try {
      await addVerifiedVersion(version);
      setVerifiedTick((t) => t + 1);
      await message(`已将 dsh ${normalizeDshVersion(version)} 标记为已验证，兼容性提示已解除。`, {
        title: "标记完成",
        kind: "info",
      });
    } catch (e) {
      await message(`标记失败：${e instanceof Error ? e.message : String(e)}`, {
        title: "标记失败",
        kind: "error",
      });
    } finally {
      setMarking(false);
    }
  };

  // 清理旧内核版本：只删「非当前版本、非回滚目标」的目录（版本并存是回滚的根基，不误删）
  const handleCleanKernels = async () => {
    if (cleaning) return;
    setCleaning(true);
    try {
      const installed = await listInstalledKernels();
      const current = version && version !== "unknown" ? normalizeDshVersion(version) : "";
      const keep = new Set([current, rollback ?? ""].filter(Boolean));
      const removable = installed.filter((v) => !keep.has(v));
      if (removable.length === 0) {
        await message("没有可清理的旧内核版本（当前版本与回滚目标已保留）。", {
          title: "清理旧内核",
          kind: "info",
        });
        return;
      }
      const ok = await confirm(
        `可清理的旧内核版本（共 ${removable.length} 个，约 ${removable.length * 248}MB）：\n\n` +
          removable.map((v) => `  · dsh ${v}`).join("\n") +
          `\n\n删除后这些版本将不可再回滚。当前版本与回滚目标（dsh ${rollback ?? "-"}）会保留。`,
        { title: "清理旧内核", kind: "warning", okLabel: "删除", cancelLabel: "取消" },
      );
      if (!ok) return;
      let failed = 0;
      for (const v of removable) {
        const r = await removeKernel(v);
        if (!r.ok) failed++;
      }
      await message(
        failed === 0
          ? `已清理 ${removable.length} 个旧内核版本 ✅（释放约 ${removable.length * 248}MB）`
          : `已清理 ${removable.length - failed} 个，${failed} 个失败（文件可能被占用）`,
        { title: "清理完成", kind: failed === 0 ? "info" : "warning" },
      );
    } catch (e) {
      await message(`清理失败：${e instanceof Error ? e.message : String(e)}`, {
        title: "清理失败",
        kind: "error",
      });
    } finally {
      setCleaning(false);
    }
  };

  // 回滚到已验证版本：先把目标版本装进 GUI 内核目录（幂等，未装则自动下载，
  // 装过则秒切）→ pin 版本 → 重启引擎（新 process 用固定版本启动，真正生效）
  const handleRollback = async () => {
    if (!rollback || rolling) return;
    setRolling(true);
    try {
      const installed = await installKernel(rollback);
      if (!installed.ok) {
        await message(`回滚版本准备失败：${installed.error ?? "未知错误"}`, {
          title: "回滚失败",
          kind: "error",
        });
        return;
      }
      pinEngineVersion(rollback);
      try {
        await restartEngine();
      } catch {
        await message("已切换到回滚版本，但引擎重启失败（错误已显示在状态栏）。可手动点击「重启引擎」按钮重试。", {
          title: "回滚失败",
          kind: "warning",
        });
        return;
      }
      clearLatestVersionCache();
      setVersion(rollback);
      await message(`已回滚到 dsh ${rollback}。旧版本内核目录保留，可随时再升级。`, {
        title: "回滚完成",
        kind: "info",
      });
    } catch (e) {
      await message(`回滚失败：${e instanceof Error ? e.message : String(e)}`, {
        title: "回滚失败",
        kind: "error",
      });
    } finally {
      setRolling(false);
    }
  };

  const statusText =
    health.status === "running"
      ? `dsh ${version || ""} · :${health.port}`
      : health.status === "starting"
        ? "引擎启动中…"
        : health.status === "error"
          ? "引擎错误"
          : "引擎未启动";

  const dot =
    health.status === "running"
      ? "bg-emerald-400"
      : health.status === "starting"
        ? "bg-amber-400 animate-pulse"
        : health.status === "error"
          ? "bg-red-400"
          : "bg-gray-600";

  return (
    <div className="flex h-6 shrink-0 items-center gap-3 border-t border-white/[0.06] bg-[rgb(13_13_16)] px-3 text-[10.5px] text-gray-500">
      <span className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {statusText}
        <button
          onClick={() => void handleCleanKernels()}
          disabled={cleaning}
          title="清理旧内核版本（保留当前版本与回滚目标）"
          className={`rounded p-0.5 text-gray-600 transition-colors ${
            cleaning ? "cursor-wait" : "hover:bg-white/[0.08] hover:text-gray-300"
          }`}
        >
          <Trash2 size={10} className={cleaning ? "animate-pulse" : ""} />
        </button>
      </span>
      {newKernel && (
        <>
          <span className="text-gray-700">|</span>
          <span className="flex items-center gap-1.5 text-amber-300" title="官方发布了新引擎内核，此版本尚未验证兼容性；如遇插件/功能异常可一键回滚">
            ⚠ 新内核未验证
            <button
              onClick={() => void handleMarkVerified()}
              disabled={marking}
              title="确认此版本兼容，加入已验证白名单（写入配置文件，无需重新打包）"
              className={`flex items-center gap-0.5 rounded border border-emerald-500/40 px-1.5 py-0.5 text-[10px] text-emerald-300 transition-colors ${
                marking ? "cursor-wait opacity-60" : "hover:bg-emerald-500/15"
              }`}
            >
              <ShieldCheck size={10} />
              {marking ? "标记中…" : "标记已验证"}
            </button>
            {rollback && (
              <button
                onClick={() => void handleRollback()}
                disabled={rolling}
                className={`rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] text-amber-300 transition-colors ${
                  rolling ? "cursor-wait opacity-60" : "hover:bg-amber-500/15"
                }`}
              >
                {rolling ? "回滚中…" : `回滚到 ${rollback}`}
              </button>
            )}
          </span>
        </>
      )}
      <span className="text-gray-700">|</span>
      <span>{sessions.length} 个会话</span>
      {generating && (
        <>
          <span className="text-gray-700">|</span>
          <span className="text-purple-400">● 生成中</span>
        </>
      )}
      <div className="flex-1" />
      {onZoomChange && (
        <>
          <button
            onClick={() => onZoomChange(Math.round((zoom - 0.1) * 10) / 10)}
            title="缩小 (Ctrl+-)"
            className="rounded px-1.5 text-gray-500 hover:bg-white/[0.08] hover:text-gray-200"
          >
            −
          </button>
          <button
            onClick={() => onZoomChange(1)}
            title="重置 100% (Ctrl+0)"
            className={`rounded px-1.5 hover:bg-white/[0.08] ${zoom !== 1 ? "text-gray-500 hover:text-gray-200" : "text-gray-300"}`}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={() => onZoomChange(Math.round((zoom + 0.1) * 10) / 10)}
            title="放大 (Ctrl++)"
            className="rounded px-1.5 text-gray-500 hover:bg-white/[0.08] hover:text-gray-200"
          >
            +
          </button>
          <span className="text-gray-700">|</span>
        </>
      )}
      <span className="text-gray-600">DeepSeek Harness Desktop</span>
    </div>
  );
}
