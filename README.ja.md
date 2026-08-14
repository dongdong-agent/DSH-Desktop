# DeepSeek Harness Desktop

> **DSH Desktop** — [DeepSeek Harness](https://www.deepseek.com/harness/) 用のネイティブデスクトップクライアント。Tauri 2 + React 19 で構築し、公式 DeepSeek Harness WebUI を埋め込み、ローカルエンジンの起動も代行します。

<p align="center">
  <img alt="Platform: Windows" src="https://img.shields.io/badge/platform-Windows%20x64-0078D6?logo=windows&logoColor=white"/>
  <img alt="Version" src="https://img.shields.io/badge/version-0.1.0-purple"/>
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2.0-24C8D8?logo=tauri&logoColor=white"/>
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white"/>
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green"/>
</p>

**他の言語で読む:** [English](README.md) · [简体中文](README.zh-CN.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md)

---

## ✨ これは何？

DeepSeek Harness Desktop は、**公式 DeepSeek Harness WebUI を包む軽量なネイティブシェル**です。UI を再発明せず、`iframe` で公式 Web インターフェースを埋め込み、デスクトップアプリに必要な機能を補完します:

- **ワンクリックでエンジン起動** — ローカル環境（`node` + `dsh`）を自動検出し、空きポートを選んで正しい profile でエンジンを起動します。
- **既存インスタンスの再利用** — すでに dsh web インスタンスが起動していれば直接接続し、二重起動を防ぎます（`~/.dsh` セッションの競合を回避）。
- **環境チェック + ワンクリックインストール** — Node.js や `dsh` が無い場合は、起動ページで不足を明示し、その場でインストールできます。
- **フレームレスウィンドウ** — カスタムタイトルバー（ドラッグ / 最小化 / 最大化 / 閉じる）+ ステータスバー（エンジン状態・ポート・セッション数）。
- **ローカル永続化** — セッションはすべて `~/.dsh/sessions/` に保存され、アプリを閉じてもデータは失われません。

セッション、トレース、プラグイン、Agent プリセット、設定など、それ以外はすべて**公式 DeepSeek Harness WebUI** のフル機能をそのまま利用できます。

## 🚀 クイックスタート

1. [Releases](https://github.com/dongdong-agent/DSH-Desktop/releases) から最新インストーラ（`DSH Desktop_0.1.0_x64-setup.exe`、Windows x64）をダウンロード。またはポータブル版の `dsh-desktop.exe` を任意の場所にコピー。
2. **アプリを起動**。起動ページに環境チェック結果（Node.js / npx / dsh エンジン）が表示されます。
3. **Start Engine（エンジン起動）** をクリック。アプリがエンジン（`dsh --profile web`、`127.0.0.1:17800` または空きポート）を起動し、公式 WebUI を自動で読み込みます。
4. Web 版と同じように利用できます — セッション、プラグイン、トレース、すべて揃っています。

> 初回利用時: Node.js や `dsh` が無い場合は、起動ページの**ワンクリックインストール**ボタンを使ってください。

## 🏗 アーキテクチャ

```
┌────────────────────────────────────────────────────┐
│  TitleBar（フレームレス + エンジン状態ドット）        │
├────────────────────────────────────────────────────┤
│  iframe 全画面 → 公式 DeepSeek Harness WebUI        │
│  セッション / トレース / プラグイン / 設定           │
├────────────────────────────────────────────────────┤
│  StatusBar（エンジン状態 · ポート · セッション数）    │
└────────────────────────────────────────────────────┘
```

- **フロントエンド**: React 19 + TypeScript + Vite 6 + Tailwind CSS 4 + Zustand
- **デスクトップシェル**: Tauri 2（Rust）、フレームレスウィンドウ + カスタムタイトルバー
- **エンジンライフサイクル**（`src/lib/dshEngine.ts`）: 既存インスタンスのスキャン → 空きポート選択 → spawn（`node` + ローカル `bin.js`、フォールバックは `npx` / `dsh` / `dsh.cmd`）→ ヘルスチェック → 停止
- **ネットワーク**: HTTP RPC（`POST /api/<method>`）+ WebSocket イベントストリーム（`@tauri-apps/plugin-http` 使用で CORS を完全回避）
- **診断**: spawn の過程と失敗原因は `%TEMP%\dsh-spawn.log` に記録

## 🧰 技術スタック

| 層 | 選定 |
|---|---|
| デスクトップシェル | Tauri 2（Rust）、フレームレス + カスタムタイトルバー |
| フロントエンド | React 19 + TypeScript + Vite 6 |
| スタイル | Tailwind CSS 4 |
| 状態管理 | Zustand 5（engine / session / chat / ui） |
| 埋め込み UI | 公式 DeepSeek Harness WebUI（iframe） |

## 🛠 開発

```bash
npm install
npm run tauri dev          # 開発モード（Vite ポート 1422）
```

## 📦 ビルド

```bash
npm run build              # tsc + vite build
npm run tauri build        # プロダクションビルド（NSIS インストーラ + ポータブル exe）
```

出力: `src-tauri/target/release/bundle/nsis/DSH Desktop_0.1.0_x64-setup.exe`

## 📁 プロジェクト構成

```
src/
├── App.tsx                 # シェルレイアウト: TitleBar + iframe(公式UI) + StatusBar
├── lib/
│   ├── dshEngine.ts        # ★ エンジンライフサイクル / spawn フォールバックチェーン / 診断ログ
│   └── api.ts              # HTTP RPC + WS イベントストリーム
├── stores/                 # zustand stores（engine / ui / session / chat）
└── components/
    ├── TitleBar.tsx        # カスタムタイトルバー
    ├── StatusBar.tsx       # エンジン状態・ポート・セッション数
    └── EngineLauncher.tsx  # 起動ページ: 環境チェック + インストール + 起動
src-tauri/
├── capabilities/default.json  # ★ 権限（shell spawn scope、ウィンドウ操作）
├── tauri.conf.json            # ウィンドウ / バンドル設定
└── src/lib.rs                 # プラグイン登録
```

## 🔍 トラブルシューティング

- **タイトルバーのボタンやドラッグが効かない** — `src-tauri/capabilities/default.json` に `core:window:*` 権限（`allow-minimize` / `allow-toggle-maximize` / `allow-close` / `allow-start-dragging`）が必要です。capabilities はバイナリにコンパイルされるため、変更後は再ビルドしてください。
- **エンジン起動に失敗** — `%TEMP%\dsh-spawn.log` を確認。主な原因: `shell:allow-spawn` の欠落、scope のプログラムホワイトリスト欠落、scope エントリに `cmd` フィールドが無い（非 sidecar は必須）。ログに正確なエラーが記録されます。
- **WebUI が真っ白** — 全リクエストは `@tauri-apps/plugin-http` 経由です（WebView2 はクロスオリジン fetch を CORS でブロック）。ネイティブ fetch に置き換えないでください。

## 📄 ライセンス

[MIT](LICENSE) © 2026 dongdong-agent
