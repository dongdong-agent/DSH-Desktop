import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  build: {
    // 性能优化：把重量级第三方链拆成独立 chunk，减小首屏解析/执行量。
    // - markdown 渲染体系（react-markdown/remark/rehype/hast/unified/lowlight）
    // - react/lucide vendor 固定 chunk，业务代码改动时命中缓存
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          const p = (id.split("node_modules")[1] ?? "").replace(/^[/\\]/, "");
          if (
            p.startsWith("react-markdown") || p.startsWith("remark-") ||
            p.startsWith("rehype-") || p.startsWith("hast-util-") ||
            p.startsWith("unified") || p.startsWith("micromark") ||
            p.startsWith("mdast-") || p.startsWith("unist-") ||
            p.startsWith("lowlight") || p.startsWith("highlight.js") ||
            p.startsWith("parse5") || p.startsWith("property-information") ||
            p.startsWith("character-entities") || p.startsWith("trim-lines") ||
            p.startsWith("ccount") || p.startsWith("comma-separated-tokens") ||
            p.startsWith("decode-named-character-reference") ||
            p.startsWith("html-void-elements") || p.startsWith("string-width") ||
            p.startsWith("is-plain-obj") || p.startsWith("extend") ||
            p.startsWith("zwitch") || p.startsWith("vfile") ||
            p.startsWith("@types/") || p.startsWith("devlop") ||
            p.startsWith("web-namespaces") || p.startsWith("space-separated-tokens") ||
            p.startsWith("markdown-table") || p.startsWith("longest-streak") ||
            p.startsWith("bail") || p.startsWith("trough") ||
            p.startsWith("is-buffer")
          ) return "markdown-render";
          if (p.startsWith("lucide-react")) return "icons";
          if (p.startsWith("react") || p.startsWith("scheduler") || p.startsWith("use-sync-external-store")) return "react-vendor";
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 1200,
  },
  server: {
    // 注意：1420 常被其他 Tauri dev server 占用，本项目用 1422
    port: 1422,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1423,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
