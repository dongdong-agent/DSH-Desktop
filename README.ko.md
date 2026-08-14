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

DeepSeek Harness Desktop은 **공식 DeepSeek Harness WebUI를 감싸는 가벼운 네이티브 셸**입니다. UI를 새로 만들지 않고 `iframe`으로 공식 웹 인터페이스를 내장한 뒤, 데스크톱 앱이 갖춰야 할 기능을 더합니다:

- **원클릭 엔진 시작** — 로컬 환경(`node` + `dsh`)을 자동 감지하고, 빈 포트를 골라 올바른 profile로 엔진을 실행합니다.
- **기존 인스턴스 재사용** — 이미 dsh web 인스턴스가 실행 중이면 바로 연결합니다(이중 실행으로 `~/.dsh` 세션이 충돌하는 문제 방지).
- **환경 점검 + 원클릭 설치** — Node.js나 `dsh` 엔진이 없으면 시작 화면에서 무엇이 부족한지 알려주고 바로 설치할 수 있습니다.
- **프레임리스 창** — 커스텀 타이틀바(드래그 / 최소화 / 최대화 / 닫기) + 상태바(엔진 상태 · 포트 · 세션 수).
- **로컬 영속화** — 모든 세션은 `~/.dsh/sessions/`에 저장되어, 앱을 닫아도 작업이 유실되지 않습니다.

세션, 트레이스, 플러그인, Agent 프리셋, 설정 등 나머지는 전부 **공식 DeepSeek Harness WebUI**의 원래 기능 그대로입니다.

## 🚀 빠른 시작

1. [Releases](https://github.com/dongdong-agent/DSH-Desktop/releases)에서 최신 설치 프로그램(`DSH Desktop_0.1.0_x64-setup.exe`, Windows x64)을 다운로드하거나, 포터블 버전 `dsh-desktop.exe`를 원하는 곳에 복사합니다.
2. **앱을 실행**합니다. 시작 화면에 환경 점검 결과(Node.js / npx / dsh 엔진)가 표시됩니다.
3. **엔진 시작(Start Engine)** 버튼을 클릭합니다. 앱이 엔진(`dsh --profile web`, `127.0.0.1:17800` 또는 빈 포트)을 실행하고 공식 WebUI를 자동으로 불러옵니다.
4. 웹 버전처럼 사용하세요 — 세션, 플러그인, 트레이스, 모두 지원됩니다.

> 첫 실행 시: Node.js나 `dsh`가 없으면 시작 화면의 **원클릭 설치** 버튼을 사용하세요.

## 🏗 아키텍처

```
┌────────────────────────────────────────────────────┐
│  TitleBar(프레임리스 + 엔진 상태 점)                 │
├────────────────────────────────────────────────────┤
│  iframe 전체화면 → 공식 DeepSeek Harness WebUI      │
│  세션 / 트레이스 / 플러그인 / 설정                   │
├────────────────────────────────────────────────────┤
│  StatusBar(엔진 상태 · 포트 · 세션 수)               │
└────────────────────────────────────────────────────┘
```

- **프론트엔드**: React 19 + TypeScript + Vite 6 + Tailwind CSS 4 + Zustand
- **데스크톱 셸**: Tauri 2(Rust), 프레임리스 + 커스텀 타이틀바
- **엔진 라이프사이클**(`src/lib/dshEngine.ts`): 기존 인스턴스 스캔 → 빈 포트 선택 → spawn(`node` + 로컬 `bin.js`, 대안 `npx` / `dsh` / `dsh.cmd`) → 헬스 체크 → 중지
- **네트워크**: HTTP RPC(`POST /api/<method>`) + WebSocket 이벤트 스트림(`@tauri-apps/plugin-http` 사용, CORS 완전 우회)
- **진단**: spawn 과정과 실패 원인은 `%TEMP%\dsh-spawn.log`에 기록

## 🧰 기술 스택

| 계층 | 선택 |
|---|---|
| 데스크톱 셸 | Tauri 2(Rust), 프레임리스 + 커스텀 타이틀바 |
| 프론트엔드 | React 19 + TypeScript + Vite 6 |
| 스타일 | Tailwind CSS 4 |
| 상태 관리 | Zustand 5(engine / session / chat / ui) |
| 내장 UI | 공식 DeepSeek Harness WebUI(iframe) |

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
├── App.tsx                 # 셸 레이아웃: TitleBar + iframe(공식 UI) + StatusBar
├── lib/
│   ├── dshEngine.ts        # ★ 엔진 라이프사이클 / spawn 대안 체인 / 진단 로그
│   └── api.ts              # HTTP RPC + WS 이벤트 스트림
├── stores/                 # zustand stores(engine / ui / session / chat)
└── components/
    ├── TitleBar.tsx        # 커스텀 타이틀바
    ├── StatusBar.tsx       # 엔진 상태 · 포트 · 세션 수
    └── EngineLauncher.tsx  # 시작 화면: 환경 점검 + 설치 + 엔진 시작
src-tauri/
├── capabilities/default.json  # ★ 권한(shell spawn scope, 창 제어)
├── tauri.conf.json            # 창 / 번들 설정
└── src/lib.rs                 # 플러그인 등록
```

## 🔍 문제 해결

- **타이틀바 버튼이나 드래그가 동작하지 않음** — `src-tauri/capabilities/default.json`에 `core:window:*` 권한(`allow-minimize` / `allow-toggle-maximize` / `allow-close` / `allow-start-dragging`)이 필요합니다. capabilities는 바이너리에 컴파일되므로 수정 후 반드시 다시 빌드하세요.
- **엔진 시작 실패** — `%TEMP%\dsh-spawn.log`를 확인하세요. 주요 원인: `shell:allow-spawn` 누락, scope 프로그램 화이트리스트 누락, scope 항목에 `cmd` 필드 없음(비 sidecar는 필수). 로그에 정확한 오류가 기록됩니다.
- **WebUI가 하얀 화면** — 모든 요청은 `@tauri-apps/plugin-http`를 사용합니다(WebView2는 교차 출처 fetch를 CORS로 차단). 네이티브 fetch로 바꾸지 마세요.

## 📄 라이선스

[MIT](LICENSE) © 2026 dongdong-agent
