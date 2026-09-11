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

DeepSeek Harness Desktop は、**公式 DeepSeek Harness WebUI を包む軽量なネイティブシェル**です。UI を再発明せず、公式 Web インターフェースを**子 webview**（オリジンが `127.0.0.1` であるトップレベル文書。クロスサイトの `iframe` ではない）でホストし、デスクトップアプリに必要な機能を補完します:

- **ワンクリックでエンジン起動** — ローカル環境（`node` + `dsh`）を自動検出し、空きポートを選んで正しい profile でエンジンを起動します。
- **既存インスタンスの再利用** — すでに dsh web インスタンスが起動していれば直接接続し、二重起動を防ぎます（`~/.dsh` セッションの競合を回避）。
- **環境チェック + ワンクリックインストール** — Node.js や `dsh` が無い場合は、起動ページで不足を明示し、その場でインストールできます。
- **フレームレスウィンドウ** — カスタムタイトルバー（ドラッグ / 最小化 / 最大化 / 閉じる）+ ステータスバー（エンジン状態・ポート・ズーム）。
- **エンジンセッション認証** — エンジン ≥ 0.1.5 は未認証リクエストを拒否し、`SameSite=Strict` のセッション Cookie を発行します。シェルは管理対象クレデンシャルの署名鍵でその Cookie を自署し、子 webview に注入するため、WebUI は 401 ではなく正常に読み込まれます。
- **ローカル永続化** — セッションはすべて `~/.dsh/sessions/` に保存され、アプリを閉じてもデータは失われません。

セッション、トレース、プラグイン、Agent プリセット、設定など、それ以外はすべて**公式 DeepSeek Harness WebUI** のフル機能をそのまま利用できます。

## 🚀 クイックスタート

1. [Releases](https://github.com/dongdong-agent/DSH-Desktop/releases) から最新インストーラ（`DSH Desktop_0.1.0_x64-setup.exe`、Windows x64）をダウンロード。またはポータブル版の `dsh-desktop.exe` を任意の場所にコピー。
2. **アプリを起動**。起動ページに環境チェック結果（Node.js / npx / dsh エンジン）が表示されます。
3. **Start Engine（エンジン起動）** をクリック。アプリがエンジン（`dsh --profile web`、`127.0.0.1:17800` または空きポート）を起動し、公式 WebUI を自動で読み込みます。
4. Web 版と同じように利用できます — セッション、プラグイン、トレース、すべて揃っています。

> 初回利用時: Node.js や `dsh` が無い場合は、起動ページの**ワンクリックインストール**ボタンを使ってください。

## 🖥 プラットフォーム対応

| プラットフォーム | 状態 | 利用方法 |
|---|---|---|
| **Windows x64** | ✅ **公式サポート** | [Releases](https://github.com/dongdong-agent/DSH-Desktop/releases) からダウンロード、またはポータブル版 exe を実行 |
| **macOS（Apple Silicon / Intel）** | 🚧 ソースからビルド | 下記参照 |
| **Linux（x64）** | 🚧 ソースからビルド | 下記参照 |

**Windows がメインプラットフォーム** — インストーラと CI ビルドはまず Windows 版を生成します。macOS と Linux は Tauri 2 でビルド・実行可能ですが、まだプレビルド成果物は公開していません。ソースからビルドしてください:

```bash
# 前提条件（全プラットフォーム共通）
# - Node.js ≥ 18（https://nodejs.org）— node と npx を提供
# - Rust stable ツールチェーン（https://rustup.rs）
# - Tauri のプラットフォーム依存:
#   macOS:  Xcode Command Line Tools
#   Linux:  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
#           libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# クローンしてビルド
git clone https://github.com/dongdong-agent/DSH-Desktop.git
cd DSH-Desktop
npm install
npm run tauri build     # .app（macOS）/ .deb、.AppImage（Linux）を src-tauri/target/release/bundle/ に生成
```

**クロスプラットフォームの注意点**:

- デスクトップシェル（Tauri 2）は完全クロスプラットフォーム。エンジンは公式 `@deepseek-ai/dsh` npm パッケージで、3 プラットフォームすべて Node.js で動作します。
- macOS/Linux ではエンジンは `node` + `npx` フォールバックチェーンで起動します（Windows 専用の `dsh.cmd` / ローカル `bin.js` パスは実行時にプローブされ、無ければ自動スキップ）。
- エンジンのセッションは全プラットフォームで `~/.dsh/` に保存 — セッション・プロファイル・認証情報は OS 間で移行可能です。
- macOS/Linux のプレビルド成果物が必要ですか？ [Issues](https://github.com/dongdong-agent/DSH-Desktop/issues) でリクエストしてください — CI ワークフローを拡張して公開できます。



## 🏗 アーキテクチャ

```
┌────────────────────────────────────────────────────┐
│  TitleBar（フレームレス + エンジン状態ドット）        │
├────────────────────────────────────────────────────┤
│  子 webview → 公式 DeepSeek Harness WebUI           │
│  セッション / トレース / プラグイン / 設定           │
│  127.0.0.1 のトップレベル文書として描画             │
├────────────────────────────────────────────────────┤
│  StatusBar（エンジン状態 · ポート · ズーム）         │
└────────────────────────────────────────────────────┘
```

- **フロントエンド**: React 19 + TypeScript + Vite 6 + Tailwind CSS 4 + Zustand
- **デスクトップシェル**: Tauri 2（Rust）、フレームレスウィンドウ + カスタムタイトルバー
- **エンジンライフサイクル**（`src/lib/dshEngine.ts`）: 既存インスタンスのスキャン → 空きポート選択 → spawn（`node` + ローカル `bin.js`、フォールバックは `npx` / `dsh` / `dsh.cmd`）→ ヘルスチェック → 停止
- **エンジンビュー**（`src-tauri/src/lib.rs`）: 子 webview（`mount_engine_view` / `set_engine_view_bounds` / `unmount_engine_view`）を内容領域に重ねて配置。シェルがホスト要素を計測し、ウィンドウリサイズやズームに追従させます
- **セッション認証**（`src/lib/engineAuth.ts`）: `~/.dsh/.credentials.yaml` のブラウザーセッション署名鍵を読み、エンジンが検証できる Cookie を生成してページ読み込み完了ごとに注入します
- **診断**: spawn の過程と失敗原因は `%TEMP%\dsh-spawn.log` に記録

## 🧰 技術スタック

| 層 | 選定 |
|---|---|
| デスクトップシェル | Tauri 2（Rust）、フレームレス + カスタムタイトルバー |
| フロントエンド | React 19 + TypeScript + Vite 6 |
| スタイル | Tailwind CSS 4 |
| 状態管理 | Zustand 5（`engine` ストアのみ。シェルは会話/セッション状態を持ちません） |
| 埋め込み UI | 公式 DeepSeek Harness WebUI（Tauri **子 webview**） |

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
├── App.tsx                 # シェルレイアウト: TitleBar + 子 webview ホスト + StatusBar
├── lib/
│   ├── dshEngine.ts        # ★ エンジンライフサイクル / spawn フォールバックチェーン / 診断ログ
│   ├── engineAuth.ts       # エンジンセッション Cookie の自署（管理対象クレデンシャル）
│   ├── updater.ts          # カーネルのバージョン確認 / インストール / ロールバック
│   └── types.ts            # 共有型（EngineHealth）
├── stores/                 # zustand ストア（engine）
└── components/
    ├── TitleBar.tsx        # カスタムタイトルバー
    ├── StatusBar.tsx       # エンジン状態・カーネル版 / ロールバック・ズーム
    ├── EngineLauncher.tsx  # 起動ページ: 環境チェック + インストール + 起動
    ├── CloseDialog.tsx     # 終了 / トレイに最小化 / エンジン停止して終了
    └── KeyManagerDialog.tsx# 管理対象 API キー / クレデンシャル管理
src-tauri/
├── capabilities/default.json  # ★ 権限（shell spawn scope、ウィンドウ操作）
├── tauri.conf.json            # ウィンドウ / バンドル設定
└── src/lib.rs                 # 子 webview（mount/bounds/unmount）+ プラグイン登録
```

## 🔍 トラブルシューティング

- **タイトルバーのボタンやドラッグが効かない** — `src-tauri/capabilities/default.json` に `core:window:*` 権限（`allow-minimize` / `allow-toggle-maximize` / `allow-close` / `allow-start-dragging`）が必要です。capabilities はバイナリにコンパイルされるため、変更後は再ビルドしてください。
- **エンジン起動に失敗** — `%TEMP%\dsh-spawn.log` を確認。主な原因: `shell:allow-spawn` の欠落、scope のプログラムホワイトリスト欠落、scope エントリに `cmd` フィールドが無い（非 sidecar は必須）。ログに正確なエラーが記録されます。
- **WebUI が真っ白 / 「authentication required」** — エンジン ≥ 0.1.5 はセッション Cookie を要求し、それを `SameSite=Strict` として発行します。シェルページ（`tauri.localhost`）内の `iframe` はクロスサイト文脈になるため Cookie が送信されません。だからこそエンジン UI は**子 webview** でホストしています。401 ページが出る場合は、`~/.dsh/.credentials.yaml` に `client-connection/browser-session` が残っているか確認してください（署名鍵が無いと Cookie を生成できません）。
- **ズーム後にエンジンビューがずれる** — シェルは `set_engine_view_bounds` を呼ぶ前に、現在のズーム率で CSS ピクセルを論理ピクセルへ換算します。レイアウトを変更する場合は、ホスト要素の寸法とズーム換算を揃えてください。

## 📄 ライセンス

[MIT](LICENSE) © 2026 dongdong-agent
