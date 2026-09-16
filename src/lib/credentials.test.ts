// ============================================================
// credentials.ts 单元测试：结构化读写 ~/.dsh/.credentials.yaml
//
// 回归重点（2026-09-12 实测事故）：早期实现把整份文档按 `KEY: value` 平铺重写，
// 会把 version 1 文档（version/refs/records 嵌套）压平成引擎解析器直接拒绝的
// 形状 —— 重复顶层 version → DUPLICATE_KEY，引擎下次启动
// 「plugin tree failed to load」，壳也再读不到 browser-session 密钥。
// 因此这里逐条钉住：records 段必须逐字节保留、布局无法确证时必须大声报错。
// ============================================================
import { describe, it, expect, vi, beforeEach } from "vitest";

const fsMocks = vi.hoisted(() => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));
const pathMocks = vi.hoisted(() => ({ homeDir: vi.fn(), appDataDir: vi.fn() }));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: fsMocks.readTextFile,
  writeTextFile: fsMocks.writeTextFile,
}));
vi.mock("@tauri-apps/api/path", () => ({
  homeDir: pathMocks.homeDir,
  appDataDir: pathMocks.appDataDir,
}));

import { readCredentials, writeCredential } from "./credentials";

const CRED_PATH = "C:\\Users\\demo\\.dsh\\.credentials.yaml";

/** 一份真实的 version 1 文档：refs + browser-session 记录（记录里还嵌着一个 version） */
const CANONICAL = [
  "version: 1",
  "refs:",
  "  DEEPSEEK_API_KEY: sk-aaaa",
  "  OPENCODE_GO_API_KEY: sk-bbbb",
  "records:",
  "  client-connection/browser-session:",
  "    kind: grant",
  "    payload:",
  "      version: 1",
  "      secret: c2VjcmV0LXZhbHVl",
  "",
].join("\n");

beforeEach(() => {
  vi.clearAllMocks();
  pathMocks.homeDir.mockResolvedValue("C:\\Users\\demo\\");
  pathMocks.appDataDir.mockResolvedValue("C:\\Users\\demo\\AppData\\Roaming\\com.dsh.desktop\\");
  fsMocks.readTextFile.mockResolvedValue(CANONICAL);
  fsMocks.writeTextFile.mockResolvedValue(undefined);
});

describe("readCredentials（结构化读取）", () => {
  it("只返回 refs 段里的凭据引用，不把 records/version 当条目", async () => {
    const entries = await readCredentials();
    expect(entries).toEqual([
      { key: "DEEPSEEK_API_KEY", value: "sk-aaaa" },
      { key: "OPENCODE_GO_API_KEY", value: "sk-bbbb" },
    ]);
  });

  it("homeDir 不带尾分隔符时仍拼出正确路径（回归：曾拼成 C:\\Users\\demo.dsh\\...）", async () => {
    // 真实 Tauri v2 环境的行为：homeDir() 返回 "C:\Users\demo"（无尾分隔符）。
    // 旧实现直接 `${home}.dsh\...`，会拼出 C:\Users\demo.dsh\... —— 路径不存在且
    // 落在 fs scope 之外，readTextFile 抛错被静默吞掉，凭据全空（MCP 因此拿不到 key）。
    pathMocks.homeDir.mockResolvedValue("C:\\Users\\demo");
    await readCredentials();
    expect(fsMocks.readTextFile).toHaveBeenCalledWith(CRED_PATH);
  });

  it("homeDir 带尾分隔符时同样只拼一个分隔符（不会出现双反斜杠）", async () => {
    pathMocks.homeDir.mockResolvedValue("C:\\Users\\demo\\");
    await readCredentials();
    expect(fsMocks.readTextFile).toHaveBeenCalledWith(CRED_PATH);
  });

  it("文件不存在时返回空列表", async () => {
    fsMocks.readTextFile.mockRejectedValue(new Error("No such file or directory (os error 2)"));
    expect(await readCredentials()).toEqual([]);
  });

  it("兼容预发布平铺布局（无 version）", async () => {
    fsMocks.readTextFile.mockResolvedValue("DEEPSEEK_API_KEY: sk-aaaa\nAGNES_API_KEY: sk-cccc\n");
    expect(await readCredentials()).toEqual([
      { key: "DEEPSEEK_API_KEY", value: "sk-aaaa" },
      { key: "AGNES_API_KEY", value: "sk-cccc" },
    ]);
  });

  it("文档结构无法确证时返回空列表（读取不炸面板）", async () => {
    fsMocks.readTextFile.mockResolvedValue("version: 1\nrefs:\n  A: b\nSECRET: oops\n");
    expect(await readCredentials()).toEqual([]);
  });
});

describe("writeCredential（结构化写回）", () => {
  it("覆盖已有引用时，records 段与注释逐字节保留", async () => {
    await writeCredential("OPENCODE_GO_API_KEY", "sk-newvalue");
    const written = fsMocks.writeTextFile.mock.calls[0][1] as string;
    expect(written).toBe(CANONICAL.replace("sk-bbbb", "sk-newvalue"));
    expect(written).toContain("    payload:\n      version: 1\n      secret: c2VjcmV0LXZhbHVl");
  });

  it("新增引用追加在 refs 段末尾，不落到 records 段里", async () => {
    await writeCredential("AGNES_API_KEY", "sk-cccc");
    const written = fsMocks.writeTextFile.mock.calls[0][1] as string;
    expect(written.split("\n").slice(0, 6)).toEqual([
      "version: 1",
      "refs:",
      "  DEEPSEEK_API_KEY: sk-aaaa",
      "  OPENCODE_GO_API_KEY: sk-bbbb",
      "  AGNES_API_KEY: sk-cccc",
      "records:",
    ]);
    expect(written).toContain("client-connection/browser-session");
  });

  it("写入路径是 ~/.dsh/.credentials.yaml", async () => {
    await writeCredential("DEEPSEEK_API_KEY", "sk-aaaa");
    expect(fsMocks.writeTextFile.mock.calls[0][0]).toBe(CRED_PATH);
  });

  it("预发布平铺布局会被迁移成 version 1 + refs（值不变）", async () => {
    fsMocks.readTextFile.mockResolvedValue("DEEPSEEK_API_KEY: sk-aaaa\n");
    await writeCredential("AGNES_API_KEY", "sk-cccc");
    expect(fsMocks.writeTextFile.mock.calls[0][1]).toBe(
      "version: 1\nrefs:\n  DEEPSEEK_API_KEY: sk-aaaa\n  AGNES_API_KEY: sk-cccc\n",
    );
  });

  it("空文件/文件不存在时写出合法的 version 1 骨架", async () => {
    fsMocks.readTextFile.mockRejectedValue(new Error("No such file or directory (os error 2)"));
    await writeCredential("DEEPSEEK_API_KEY", "sk-aaaa");
    expect(fsMocks.writeTextFile.mock.calls[0][1]).toBe("version: 1\nrefs:\n  DEEPSEEK_API_KEY: sk-aaaa\n");
  });

  it("被压平的损坏文档必须报错而不是继续重写（事故根因回归）", async () => {
    const flattened = [
      "version: 1",
      "refs: ",
      "DEEPSEEK_API_KEY: sk-aaaa",
      "records: ",
      "client-connection/browser-session: ",
      "kind: grant",
      "payload: ",
      "version: 1",
      "secret: c2VjcmV0",
      "",
    ].join("\n");
    fsMocks.readTextFile.mockResolvedValue(flattened);
    await expect(writeCredential("AGNES_API_KEY", "sk-cccc")).rejects.toThrow(/unknown top-level key/);
    expect(fsMocks.writeTextFile).not.toHaveBeenCalled();
  });

  it("文档读不动（非 ENOENT）时上抛，绝不覆盖", async () => {
    fsMocks.readTextFile.mockRejectedValue(new Error("EACCES: permission denied"));
    await expect(writeCredential("DEEPSEEK_API_KEY", "sk-aaaa")).rejects.toThrow(/EACCES/);
    expect(fsMocks.writeTextFile).not.toHaveBeenCalled();
  });

  it("拒绝非法引用名与空值", async () => {
    await expect(writeCredential("bad-name", "v")).rejects.toThrow(TypeError);
    await expect(writeCredential("DEEPSEEK_API_KEY", "")).rejects.toThrow(TypeError);
  });

  it("同名重复条目写入时收敛成一条（重复键会让引擎整体拒绝文档）", async () => {
    fsMocks.readTextFile.mockResolvedValue(
      "version: 1\nrefs:\n  A_KEY: first\n  B_KEY: keep\n  A_KEY: second\n",
    );
    await writeCredential("A_KEY", "third");
    const written = fsMocks.writeTextFile.mock.calls[0][1] as string;
    expect(written).toBe("version: 1\nrefs:\n  A_KEY: third\n  B_KEY: keep\n");
  });

  it("读取时同名条目按后出现者为准", async () => {
    fsMocks.readTextFile.mockResolvedValue("version: 1\nrefs:\n  A_KEY: first\n  A_KEY: second\n");
    expect(await readCredentials()).toEqual([{ key: "A_KEY", value: "second" }]);
  });

  it("值里含冒号等特殊字符时加引号，仍能被读回", async () => {
    fsMocks.readTextFile.mockResolvedValue("version: 1\nrefs:\n  A_KEY: old\n");
    await writeCredential("A_KEY", "sk-a:b#c");
    const written = fsMocks.writeTextFile.mock.calls[0][1] as string;
    expect(written).toContain('  A_KEY: "sk-a:b#c"');
    fsMocks.readTextFile.mockResolvedValue(written);
    expect(await readCredentials()).toEqual([{ key: "A_KEY", value: "sk-a:b#c" }]);
  });
});
