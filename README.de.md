# DeepSeek Harness Desktop

> **DSH Desktop** — Ein nativer Desktop-Client für [DeepSeek Harness](https://www.deepseek.com/harness/), gebaut mit Tauri 2 + React 19. Er bettet die offizielle DeepSeek Harness WebUI ein und übernimmt die Verwaltung der lokalen Engine für Sie.

<p align="center">
  <img alt="Plattform: Windows" src="https://img.shields.io/badge/platform-Windows%20x64-0078D6?logo=windows&logoColor=white"/>
  <img alt="Version" src="https://img.shields.io/badge/version-0.1.0-purple"/>
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2.0-24C8D8?logo=tauri&logoColor=white"/>
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white"/>
  <img alt="Lizenz: MIT" src="https://img.shields.io/badge/license-MIT-green"/>
</p>

**In anderen Sprachen lesen:** [English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md)

---

## ✨ Was ist das?

DeepSeek Harness Desktop ist eine **schlanke native Hülle** um die offizielle DeepSeek Harness WebUI. Statt die Benutzeroberfläche neu zu erfinden, bettet sie die offizielle Weboberfläche in einem `iframe` ein und ergänzt, was eine Desktop-App ausmacht:

- **Engine-Start mit einem Klick** — erkennt Ihre lokale Umgebung (`node` + `dsh`), wählt einen freien Port und startet die Engine mit dem richtigen Profil.
- **Vorhandene Instanzen wiederverwenden** — läuft bereits eine DeepSeek-Harness-Webinstanz auf Ihrem Rechner, verbindet sich die App direkt, statt eine zweite zu starten (kein Streit mehr um den `~/.dsh`-Sitzungsspeicher).
- **Umgebungscheck + Installation mit einem Klick** — fehlen Node.js oder die `dsh`-Engine? Der Launcher sagt Ihnen genau, was fehlt, und kann es für Sie installieren.
- **Rahmenloses Fenster** — benutzerdefinierte Titelleiste (ziehen / minimieren / maximieren / schließen) und eine Statusleiste mit Engine-Zustand, Port und Sitzungsanzahl.
- **Lokale Persistenz** — alle Sitzungen liegen auf der Festplatte unter `~/.dsh/sessions/`; das Schließen der App verliert also nie Ihre Arbeit.

Alles andere — Sitzungen, Trajektorien, Plugins, Agent-Voreinstellungen — ist die **offizielle DeepSeek Harness WebUI** in voller Fidelity, denn die App hostet sie lediglich.

## 🚀 Schnellstart

1. **Laden Sie** den neuesten Installer von [Releases](https://github.com/dongdong-agent/DSH-Desktop/releases) herunter (`DSH Desktop_0.1.0_x64-setup.exe`, Windows x64) oder kopieren Sie die portable `dsh-desktop.exe` an einen beliebigen Ort.
2. **Starten Sie die App**. Die Launcher-Seite zeigt den Zustand Ihrer Umgebung (Node.js / npx / dsh-Engine).
3. Klicken Sie auf **启动引擎 (Engine starten)**. Die App startet die Engine (`dsh --profile web` auf `127.0.0.1:17800` oder einem anderen freien Port) und lädt automatisch die offizielle WebUI.
4. Nutzen Sie sie wie die Web-Version — Sitzungen, Plugins, Trajektorien, alles ist da.

> Erster Start: Fehlen Node.js oder `dsh`, nutzen Sie die **Ein-Klick-Installation** auf der Launcher-Seite.

## 🏗 Architektur

```
┌────────────────────────────────────────────────────┐
│  TitleBar (rahmenlos + Engine-Statuspunkt)         │
├────────────────────────────────────────────────────┤
│  iframe (Vollbild) → offizielle DeepSeek Harness   │
│  WebUI — Sitzungen / Trajektorien / Plugins /      │
│  Einstellungen                                     │
├────────────────────────────────────────────────────┤
│  StatusBar (Engine-Zustand · Port · Sitzungen)     │
└────────────────────────────────────────────────────┘
```

- **Frontend**: React 19 + TypeScript + Vite 6 + Tailwind CSS 4 + Zustand
- **Desktop-Hülle**: Tauri 2 (Rust), rahmenloses Fenster mit benutzerdefinierter Titelleiste
- **Engine-Lebenszyklus** (`src/lib/dshEngine.ts`): vorhandene Instanzen suchen → freien Port wählen → starten (`node` + lokales `bin.js`, Fallbacks `npx` / `dsh` / `dsh.cmd`) → Healthcheck → stoppen
- **Netzwerk**: HTTP-RPC (`POST /api/<method>`) + WebSocket-Ereignisströme über `@tauri-apps/plugin-http` (umgeht WebView2-CORS vollständig)
- **Diagnose**: Startversuche und Fehler werden in `%TEMP%\dsh-spawn.log` protokolliert

## 🧰 Tech-Stack

| Ebene | Wahl |
|---|---|
| Desktop-Hülle | Tauri 2 (Rust), rahmenlos + benutzerdefinierte Titelleiste |
| Frontend | React 19 + TypeScript + Vite 6 |
| Styling | Tailwind CSS 4 |
| State | Zustand 5 (engine / session / chat / ui Stores) |
| Eingebettete UI | Offizielle DeepSeek Harness WebUI (iframe) |

## 🛠 Entwicklung

```bash
npm install
npm run tauri dev          # Entwicklungsmodus (Vite auf Port 1422)
```

## 📦 Build

```bash
npm run build              # tsc + vite build
npm run tauri build        # Produktionspaket (NSIS-Installer + portable exe)
```

Ausgabe: `src-tauri/target/release/bundle/nsis/DSH Desktop_0.1.0_x64-setup.exe`

## 📁 Projektstruktur

```
src/
├── App.tsx                 # Hüllen-Layout: TitleBar + iframe(offizielle UI) + StatusBar
├── lib/
│   ├── dshEngine.ts        # ★ Engine-Lebenszyklus / Start-Fallback-Kette / Log
│   └── api.ts              # HTTP-RPC + WS-Ereignisströme
├── stores/                 # Zustand-Stores (engine / ui / session / chat)
└── components/
    ├── TitleBar.tsx        # benutzerdefinierte Titelleiste
    ├── StatusBar.tsx       # Engine-Zustand · Port · Sitzungen
    └── EngineLauncher.tsx  # Launcher: Check + Installation + Start
src-tauri/
├── capabilities/default.json  # ★ Berechtigungen (shell-spawn-Scope, Fenstersteuerung)
├── tauri.conf.json            # Fenster-/Bundle-Konfiguration
└── src/lib.rs                 # Plugin-Registrierung
```

## 🔍 Fehlerbehebung

- **Titelleisten-Buttons oder Ziehen funktionieren nicht** — die Berechtigungen `core:window:*` (`allow-minimize` / `allow-toggle-maximize` / `allow-close` / `allow-start-dragging`) müssen in `src-tauri/capabilities/default.json` stehen. Capabilities werden ins Binary kompiliert: nach Änderung neu bauen.
- **Engine startet nicht** — `%TEMP%\dsh-spawn.log` prüfen. Häufige Ursachen: fehlendes `shell:allow-spawn`, fehlende Programm-Whitelist im Scope, oder Scope-Einträge ohne das Feld `cmd` (für Nicht-Sidecar-Einträge Pflicht).
- **WebUI bleibt weiß** — die App nutzt für alle Anfragen `@tauri-apps/plugin-http`, weil WebView2 Cross-Origin-Fetch (CORS) blockiert. Nicht durch natives `fetch` ersetzen.

## 📄 Lizenz

[MIT](LICENSE) © 2026 dongdong-agent
