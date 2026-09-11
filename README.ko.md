# DeepSeek Harness Desktop

> **DSH Desktop** — [DeepSeek Harness](https://www.deepseek.com/harness/)를 위한 네이티브 데스크톱 클라이언트. Tauri 2 + React 19 기반으로, 공식 DeepSeek Harness WebUI를 내장하고 로컬 엔진 관리를 대신합니다.

<p align="center">
  <img alt="Platform: Windows" src="https://img.shields.io/badge/platform-Windows%20x64-0078D6?logo=windows&logoColor=white"/>
  <img alt="Version" src="https://img.shields.io/badge/version-0.1.0-purple"/>
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2.0-24C8D8?logo=tauri&logoColor=white"/>
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white"/>
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green"/>
</p>

**다른 언어로 읽기:** [English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md)

---

## ✨ 무엇인가요?

DeepSeek Harness Desktop은 **공식 DeepSeek Harness WebUI를 감싸는 가벼운 네이티브 셸**입니다. UI를 새로 만들지 않고 **자식 webview**(오리진이 `127.0.0.1`인 최상위 문서이며, 교차 사이트 `iframe`이 아님)로 공식 웹 인터페이스를 호스팅한 뒤, 데스크톱 앱이 갖춰야 할 기능을 더합니다:

- **원클릭 엔진 시작** — 로컬 환경(`node` + `dsh`)을 자동 감지하고, 빈 포트를 골라 올바른 profile로 엔진을 실행합니다.
- **기존 인스턴스 재사용** — 이미 dsh web 인스턴스가 실행 중이면 바로 연결합니다(이중 실행으로 `~/.dsh` 세션이 충돌하는 문제 방지).
- **환경 점검 + 원클릭 설치** — Node.js나 `dsh` 엔진이 없으면 시작 화면에서 무엇이 부족한지 알려주고 바로 설치할 수 있습니다.
- **프레임리스 창** — 커스텀 타이틀바(드래그 / 최소화 / 최대화 / 닫기) + 상태바(엔진 상태 · 포트 · 줌 배율).
- **엔진 세션 인증** — 엔진 ≥ 0.1.5는 인증되지 않은 요청을 거부하고 `SameSite=Strict` 세션 쿠키를 발급합니다. 셸은 관리 대상 자격 증명의 서명 키로 그 쿠키를 자체 서명해 자식 webview에 주입하므로, WebUI가 401 페이지 대신 정상적으로 로드됩니다.
- **로컬 영속화** — 모든 세션은 `~/.dsh/sessions/`에 저장되어, 앱을 닫아도 작업이 유실되지 않습니다.

세션, 트레이스, 플러그인, Agent 프리셋, 설정 등 나머지는 전부 **공식 DeepSeek Harness WebUI**의 원래 기능 그대로입니다.

## 🚀 빠른 시작

1. [Releases](https://github.com/dongdong-agent/DSH-Desktop/releases)에서 최신 설치 프로그램(`DSH Desktop_0.1.0_x64-setup.exe`, Windows x64)을 다운로드하거나, 포터블 버전 `dsh-desktop.exe`를 원하는 곳에 복사합니다.
2. **앱을 실행**합니다. 시작 화면에 환경 점검 결과(Node.js / npx / dsh 엔진)가 표시됩니다.
3. **엔진 시작(Start Engine)** 버튼을 클릭합니다. 앱이 엔진(`dsh --profile web`, `127.0.0.1:17800` 또는 빈 포트)을 실행하고 공식 WebUI를 자동으로 불러옵니다.
4. 웹 버전처럼 사용하세요 — 세션, 플러그인, 트레이스, 모두 지원됩니다.

> 첫 실행 시: Node.js나 `dsh`가 없으면 시작 화면의 **원클릭 설치** 버튼을 사용하세요.

## 🖥 플랫폼 지원

| 플랫폼 | 상태 | 사용 방법 |
|---|---|---|
| **Windows x64** | ✅ **공식 지원** | [Releases](https://github.com/dongdong-agent/DSH-Desktop/releases)에서 다운로드하거나 포터블 exe 실행 |
| **macOS (Apple Silicon / Intel)** | 🚧 소스에서 빌드 | 아래 참조 |
| **Linux (x64)** | 🚧 소스에서 빌드 | 아래 참조 |

**Windows가 주 플랫폼** — 설치 프로그램과 CI 빌드는 먼저 Windows 버전을 생성합니다. macOS와 Linux는 Tauri 2에서 빌드·실행 가능하지만 아직 사전 빌드 산출물을 배포하지 않습니다. 소스에서 빌드하세요:

```bash
# 사전 요구사항 (모든 플랫폼 공통)
# - Node.js ≥ 18 (https://nodejs.org) — node와 npx 제공
# - Rust 안정판 툴체인 (https://rustup.rs)
# - Tauri 플랫폼 시스템 의존성:
#   macOS:  Xcode Command Line Tools
#   Linux:  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
#           libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# 클론 및 빌드
git clone https://github.com/dongdong-agent/DSH-Desktop.git
cd DSH-Desktop
npm install
npm run tauri build     # .app(macOS) / .deb, .AppImage(Linux)를 src-tauri/target/release/bundle/에 생성
```

**크로스 플랫폼 참고 사항**:

- 데스크톱 셸(Tauri 2)은 완전히 크로스 플랫폼입니다. 엔진은 공식 `@deepseek-ai/dsh` npm 패키지로, 세 플랫폼 모두 Node.js로 실행됩니다.
- macOS/Linux에서는 엔진이 `node` + `npx` 폴백 체인으로 시작됩니다(Windows 전용 `dsh.cmd` / 로컬 `bin.js` 경로는 런타임에 프로브되어 없으면 자동으로 건너뜁니다).
- 엔진 세션은 모든 플랫폼에서 `~/.dsh/`에 저장 — 세션, 프로필, 자격 증명은 OS 간에 이식 가능합니다.
- macOS/Linux 사전 빌드 산출물이 필요하신가요? [Issues](https://github.com/dongdong-agent/DSH-Desktop/issues)에서 요청하세요 — CI 워크플로우를 확장해 게시할 수 있습니다.



## 🏗 아키텍처

```
┌────────────────────────────────────────────────────┐
│  TitleBar(프레임리스 + 엔진 상태 점)                 │
├────────────────────────────────────────────────────┤
│  자식 webview → 공식 DeepSeek Harness WebUI         │
│  세션 / 트레이스 / 플러그인 / 설정                   │
│  127.0.0.1을 오리진으로 하는 최상위 문서로 렌더링    │
├────────────────────────────────────────────────────┤
│  StatusBar(엔진 상태 · 포트 · 줌)                    │
└────────────────────────────────────────────────────┘
```

- **프론트엔드**: React 19 + TypeScript + Vite 6 + Tailwind CSS 4 + Zustand
- **데스크톱 셸**: Tauri 2(Rust), 프레임리스 + 커스텀 타이틀바
- **엔진 라이프사이클**(`src/lib/dshEngine.ts`): 기존 인스턴스 스캔 → 빈 포트 선택 → spawn(`node` + 로컬 `bin.js`, 대안 `npx` / `dsh` / `dsh.cmd`) → 헬스 체크 → 중지
- **엔진 뷰**(`src-tauri/src/lib.rs`): 엔진 실행 중에는 메인 윈도우의 webview가 엔진 페이지로 직접 이동합니다(최상위 문서). 첫 로드 시 자체 서명된 세션 쿠키를 주입합니다(`src/lib/engineAuth.ts` 참조)
- **세션 인증**(`src/lib/engineAuth.ts`): `~/.dsh/.credentials.yaml`에서 브라우저 세션 서명 키를 읽어 엔진이 검증할 수 있는 쿠키를 생성하고, 페이지 로드가 끝날 때마다 주입합니다
- **진단**: spawn 과정과 실패 원인은 `%TEMP%\dsh-spawn.log`에 기록

## 🧰 기술 스택

| 계층 | 선택 |
|---|---|
| 데스크톱 셸 | Tauri 2(Rust), 프레임리스 + 커스텀 타이틀바 |
| 프론트엔드 | React 19 + TypeScript + Vite 6 |
| 스타일 | Tailwind CSS 4 |
| 상태 관리 | Zustand 5(`engine` 스토어 하나만 — 셸은 대화/세션 상태를 보관하지 않음) |
| 내장 UI | 공식 DeepSeek Harness WebUI(Tauri **자식 webview**) |

## 🛠 개발

```bash
npm install
npm run tauri dev          # 개발 모드(Vite 포트 1422)
```

## 📦 빌드

```bash
npm run build              # tsc + vite build
npm run tauri build        # 프로덕션 빌드(NSIS 설치 프로그램 + 포터블 exe)
```

산출물: `src-tauri/target/release/bundle/nsis/DSH Desktop_0.1.0_x64-setup.exe`

## 📁 프로젝트 구조

```
src/
├── App.tsx                 # 셸 레이아웃: TitleBar + 자식 webview 호스트 + StatusBar
├── lib/
│   ├── dshEngine.ts        # ★ 엔진 라이프사이클 / spawn 대안 체인 / 진단 로그
│   ├── engineAuth.ts       # 엔진 세션 쿠키 자체 서명(관리 대상 자격 증명)
│   ├── updater.ts          # 커널 버전 확인 / 설치 / 롤백
│   └── types.ts            # 공유 타입(EngineHealth)
├── stores/                 # zustand 스토어(engine)
└── components/
    ├── TitleBar.tsx        # 커스텀 타이틀바
    ├── StatusBar.tsx       # 엔진 상태 · 커널 버전 / 롤백 · 줌
    ├── EngineLauncher.tsx  # 시작 화면: 환경 점검 + 설치 + 엔진 시작
    ├── CloseDialog.tsx     # 종료 / 트레이로 최소화 / 엔진 중지 후 종료
    └── KeyManagerDialog.tsx# 관리 대상 API 키 / 자격 증명 관리
src-tauri/
├── capabilities/default.json  # ★ 권한(shell spawn scope, 창 제어)
├── tauri.conf.json            # 창 / 번들 설정
└── src/lib.rs                 # 자식 webview(mount/bounds/unmount) + 플러그인 등록
```

## 🔍 문제 해결

- **타이틀바 버튼이나 드래그가 동작하지 않음** — `src-tauri/capabilities/default.json`에 `core:window:*` 권한(`allow-minimize` / `allow-toggle-maximize` / `allow-close` / `allow-start-dragging`)이 필요합니다. capabilities는 바이너리에 컴파일되므로 수정 후 반드시 다시 빌드하세요.
- **엔진 시작 실패** — `%TEMP%\dsh-spawn.log`를 확인하세요. 주요 원인: `shell:allow-spawn` 누락, scope 프로그램 화이트리스트 누락, scope 항목에 `cmd` 필드 없음(비 sidecar는 필수). 로그에 정확한 오류가 기록됩니다.
- **WebUI가 하얀 화면 / "authentication required"** — 엔진 ≥ 0.1.5는 세션 쿠키를 요구하며 이를 `SameSite=Strict`로 설정합니다. 셸 페이지(`tauri.localhost`) 안의 `iframe`은 교차 사이트 컨텍스트라 쿠키가 전송되지 않습니다. 그래서 엔진 UI를 **자식 webview**로 호스팅합니다. 401 페이지가 보이면 `~/.dsh/.credentials.yaml`에 `client-connection/browser-session`이 남아 있는지 확인하세요(서명 키가 없으면 쿠키를 생성할 수 없습니다).
- **줌 후 엔진 뷰가 어긋남** — 셸은 `set_engine_view_bounds` 호출 전에 현재 줌 배율로 CSS 픽셀을 논리 픽셀로 환산합니다. 레이아웃을 바꾼다면 호스트 요소의 크기와 줌 환산을 함께 맞춰야 합니다.

## 📄 라이선스

[MIT](LICENSE) © 2026 dongdong-agent
