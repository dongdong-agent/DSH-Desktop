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

DeepSeek Harness Desktop ist eine **schlanke native Hülle** um die offizielle DeepSeek Harness WebUI. Statt die Benutzeroberfläche neu zu erfinden, hostet sie die offizielle Weboberfläche in einem **Kind-Webview** — einem echten Top-Level-Dokument, dessen Origin *127.0.0.1* ist, nicht einem Cross-Site-`iframe` — und ergänzt, was eine Desktop-App ausmacht:

- **Engine-Start mit einem Klick** — erkennt Ihre lokale Umgebung (`node` + `dsh`), wählt einen freien Port und startet die Engine mit dem richtigen Profil.
- **Vorhandene Instanzen wiederverwenden** — läuft bereits eine DeepSeek-Harness-Webinstanz auf Ihrem Rechner, verbindet sich die App direkt, statt eine zweite zu starten (kein Streit mehr um den `~/.dsh`-Sitzungsspeicher).
- **Umgebungscheck + Installation mit einem Klick** — fehlen Node.js oder die `dsh`-Engine? Der Launcher sagt Ihnen genau, was fehlt, und kann es für Sie installieren.
- **Rahmenloses Fenster** — benutzerdefinierte Titelleiste (ziehen / minimieren / maximieren / schließen) und eine Statusleiste mit Engine-Zustand, Port und Zoomstufe.
- **Authentifizierte Engine-Sitzungen** — Engines ≥ 0.1.5 lehnen unauthentifizierte Anfragen ab und setzen ein `SameSite=Strict`-Sitzungscookie. Die Hülle signiert dieses Cookie selbst mit dem Schlüssel aus dem verwalteten Credential-Store und injiziert es in das Kind-Webview, sodass die WebUI lädt statt eine 401-Seite zu zeigen.
- **Lokale Persistenz** — alle Sitzungen liegen auf der Festplatte unter `~/.dsh/sessions/`; das Schließen der App verliert also nie Ihre Arbeit.

Alles andere — Sitzungen, Trajektorien, Plugins, Agent-Voreinstellungen — ist die **offizielle DeepSeek Harness WebUI** in voller Fidelity, denn die App hostet sie lediglich.

## 🚀 Schnellstart

1. **Laden Sie** den neuesten Installer von [Releases](https://github.com/dongdong-agent/DSH-Desktop/releases) herunter (`DSH Desktop_0.1.0_x64-setup.exe`, Windows x64) oder kopieren Sie die portable `dsh-desktop.exe` an einen beliebigen Ort.
2. **Starten Sie die App**. Die Launcher-Seite zeigt den Zustand Ihrer Umgebung (Node.js / npx / dsh-Engine).
3. Klicken Sie auf **启动引擎 (Engine starten)**. Die App startet die Engine (`dsh --profile web` auf `127.0.0.1:17800` oder einem anderen freien Port) und lädt automatisch die offizielle WebUI.
4. Nutzen Sie sie wie die Web-Version — Sitzungen, Plugins, Trajektorien, alles ist da.

> Erster Start: Fehlen Node.js oder `dsh`, nutzen Sie die **Ein-Klick-Installation** auf der Launcher-Seite.

## 🖥 Plattformunterstützung

| Plattform | Status | Verwendung |
|---|---|---|
| **Windows x64** | ✅ **Offiziell unterstützt** | Von [Releases](https://github.com/dongdong-agent/DSH-Desktop/releases) herunterladen oder portable exe ausführen |
| **macOS (Apple Silicon / Intel)** | 🚧 Aus Quellcode bauen | Siehe unten |
| **Linux (x64)** | 🚧 Aus Quellcode bauen | Siehe unten |

**Windows ist die Hauptplattform** — Installer und CI-Builds zielen zuerst auf Windows. macOS und Linux funktionieren mit Tauri 2, werden aber noch nicht als fertige Artefakte ausgeliefert; baue sie aus dem Quellcode:

```bash
# Voraussetzungen (alle Plattformen)
# - Node.js ≥ 18 (https://nodejs.org) — liefert node und npx
# - Rust stable Toolchain (https://rustup.rs)
# - Plattformabhängige Systempakete für Tauri:
#   macOS:  Xcode Command Line Tools
#   Linux:  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
#           libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# Klonen und bauen
git clone https://github.com/dongdong-agent/DSH-Desktop.git
cd DSH-Desktop
npm install
npm run tauri build     # erzeugt .app (macOS) / .deb/.AppImage (Linux) in src-tauri/target/release/bundle/
```

**Cross-Platform-Hinweise**:

- Die Desktop-Shell (Tauri 2) ist vollständig plattformübergreifend. Die Engine ist das offizielle `@deepseek-ai/dsh` npm-Paket und läuft auf allen drei Plattformen über Node.js.
- Auf macOS/Linux wird die Engine über die `node` + `npx` Fallback-Kette gestartet (die Windows-spezifischen `dsh.cmd` / lokale `bin.js`-Pfade werden zur Laufzeit geprüft und übersprungen, wenn sie fehlen).
- Engine-Sitzungen liegen auf allen Plattformen in `~/.dsh/` — Sitzungen, Profile und Anmeldedaten sind zwischen den Betriebssystemen übertragbar.
- Vorgefertigte macOS/Linux-Artefakte gewünscht? Eröffne ein [Issue](https://github.com/dongdong-agent/DSH-Desktop/issues) — der CI-Workflow kann erweitert werden, um sie zu veröffentlichen.



## 🏗 Architektur

```
┌────────────────────────────────────────────────────┐
│  TitleBar (rahmenlos + Engine-Statuspunkt)         │
├────────────────────────────────────────────────────┤
│  Kind-Webview → offizielle DeepSeek Harness WebUI  │
│  Sitzungen / Trajektorien / Plugins / Einstellungen│
│  als Top-Level-Dokument unter 127.0.0.1 gerendert  │
├────────────────────────────────────────────────────┤
│  StatusBar (Engine-Zustand · Port · Zoom)          │
└────────────────────────────────────────────────────┘
```

- **Frontend**: React 19 + TypeScript + Vite 6 + Tailwind CSS 4 + Zustand
- **Desktop-Hülle**: Tauri 2 (Rust), rahmenloses Fenster mit benutzerdefinierter Titelleiste
- **Engine-Lebenszyklus** (`src/lib/dshEngine.ts`): vorhandene Instanzen suchen → freien Port wählen → starten (`node` + lokales `bin.js`, Fallbacks `npx` / `dsh` / `dsh.cmd`) → Healthcheck → stoppen
- **Engine-Ansicht** (`src-tauri/src/lib.rs`): Ein Kind-Webview (`mount_engine_view` / `set_engine_view_bounds` / `unmount_engine_view`) wird über dem Inhaltsbereich positioniert; die Hülle misst das Host-Element und hält die Ansicht bei Fenstergrößen- und Zoomänderungen synchron
- **Sitzungs-Authentifizierung** (`src/lib/engineAuth.ts`): liest den Signaturschlüssel der Browser-Sitzung aus `~/.dsh/.credentials.yaml`, erzeugt ein von der Engine prüfbares Cookie und injiziert es bei jedem abgeschlossenen Seitenaufbau
- **Diagnose**: Startversuche und Fehler werden in `%TEMP%\dsh-spawn.log` protokolliert

## 🧰 Tech-Stack

| Ebene | Wahl |
|---|---|
| Desktop-Hülle | Tauri 2 (Rust), rahmenlos + benutzerdefinierte Titelleiste |
| Frontend | React 19 + TypeScript + Vite 6 |
| Styling | Tailwind CSS 4 |
| State | Zustand 5 (nur ein `engine`-Store — die Hülle hält keinen Chat-/Sitzungszustand) |
| Eingebettete UI | Offizielle DeepSeek Harness WebUI (Tauri-**Kind-Webview**) |

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
├── App.tsx                 # Hüllen-Layout: TitleBar + Kind-Webview-Host + StatusBar
├── lib/
│   ├── dshEngine.ts        # ★ Engine-Lebenszyklus / Start-Fallback-Kette / Log
│   ├── engineAuth.ts       # selbst signiertes Engine-Sitzungscookie (verwaltete Credentials)
│   ├── updater.ts          # Kernel-Versionsprüfung / Installation / Rollback
│   └── types.ts            # gemeinsame Typen (EngineHealth)
├── stores/                 # Zustand-Store (engine)
└── components/
    ├── TitleBar.tsx        # benutzerdefinierte Titelleiste
    ├── StatusBar.tsx       # Engine-Zustand · Kernel-Version / Rollback · Zoom
    ├── EngineLauncher.tsx  # Launcher: Check + Installation + Start
    ├── CloseDialog.tsx     # Schließen / ins Tray minimieren / Engine stoppen und beenden
    └── KeyManagerDialog.tsx# Verwaltung von API-Keys / Credentials
src-tauri/
├── capabilities/default.json  # ★ Berechtigungen (shell-spawn-Scope, Fenstersteuerung)
├── tauri.conf.json            # Fenster-/Bundle-Konfiguration
└── src/lib.rs                 # Kind-Webview (mount/bounds/unmount) + Plugin-Registrierung
```

## 🔍 Fehlerbehebung

- **Titelleisten-Buttons oder Ziehen funktionieren nicht** — die Berechtigungen `core:window:*` (`allow-minimize` / `allow-toggle-maximize` / `allow-close` / `allow-start-dragging`) müssen in `src-tauri/capabilities/default.json` stehen. Capabilities werden ins Binary kompiliert: nach Änderung neu bauen.
- **Engine startet nicht** — `%TEMP%\dsh-spawn.log` prüfen. Häufige Ursachen: fehlendes `shell:allow-spawn`, fehlende Programm-Whitelist im Scope, oder Scope-Einträge ohne das Feld `cmd` (für Nicht-Sidecar-Einträge Pflicht).
- **WebUI bleibt weiß / „authentication required"** — Engines ≥ 0.1.5 verlangen ein Sitzungscookie und setzen es auf `SameSite=Strict`. Ein `iframe` innerhalb der Hüllen-Seite (`tauri.localhost`) ist ein Cross-Site-Kontext, in dem das Cookie nie gesendet würde — genau deshalb wird die Engine-UI in einem **Kind-Webview** gehostet. Erscheint eine 401-Seite, prüfen Sie, ob `~/.dsh/.credentials.yaml` noch `client-connection/browser-session` enthält; ohne diesen Signaturschlüssel lässt sich kein Cookie erzeugen.
- **Engine-Ansicht nach Zoom verschoben** — die Hülle rechnet CSS-Pixel vor dem Aufruf von `set_engine_view_bounds` über den aktuellen Zoomfaktor in logische Pixel um. Bei Layoutänderungen Bounds des Host-Elements und Zoom-Umrechnung synchron halten.

## 📄 Lizenz

[MIT](LICENSE) © 2026 dongdong-agent
