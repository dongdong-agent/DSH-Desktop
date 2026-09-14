// ============================================================
// 回归契约：EngineLauncher 的「启动引擎」必须**复位 launchRequested**
// ------------------------------------------------------------
// 2026-09-14 实测事故：点一次、启动失败后，launchRequested 永久留在 true →
//   ① 按钮永久 disabled、文案停在「正在启动引擎…」，**用户无法重试**；
//   ② `App.tsx:286` 的 `!running && !launchRequested` 不成立 → 永远渲染
//      「引擎启动中…」（App.tsx:298），看起来就像卡在启动页。
// 当时只能重启应用才能再试一次。
//
// 本项目没有组件测试基建（无 @testing-library），而这是"少一行就复发"的缺陷，
// 因此用**源码契约**把它钉住：复位必须写在 finally 里（成功/失败/抛错三条路径都覆盖）。
// ============================================================
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(new URL("./EngineLauncher.tsx", import.meta.url), "utf8");

describe("EngineLauncher：launchRequested 必须复位（否则失败后无法重试）", () => {
  it("handleLaunch 在 finally 里复位", () => {
    const handleLaunch = /const handleLaunch = async \(\) => \{[\s\S]*?\n  \};/.exec(SOURCE)?.[0] ?? "";
    expect(handleLaunch, "找不到 handleLaunch 函数体").not.toBe("");
    expect(handleLaunch).toContain("setLaunchRequested(true)");
    // 关键：复位必须在 finally（而不是只在 try 尾部，否则抛错路径仍会卡死）
    expect(handleLaunch).toMatch(/finally\s*\{[\s\S]*setLaunchRequested\(false\)/);
  });

  it("置 true 与复位 false 成对出现（防止回退成只置不复位）", () => {
    const setTrue = SOURCE.match(/setLaunchRequested\(true\)/g) ?? [];
    const setFalse = SOURCE.match(/setLaunchRequested\(false\)/g) ?? [];
    expect(setTrue.length).toBeGreaterThan(0);
    expect(setFalse.length).toBe(setTrue.length);
  });
});
