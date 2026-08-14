# DeepSeek Harness Desktop

> **DSH Desktop** — Un client de bureau natif pour [DeepSeek Harness](https://www.deepseek.com/harness/), construit avec Tauri 2 + React 19. Il intègre la WebUI officielle de DeepSeek Harness et gère le moteur local à votre place.

<p align="center">
  <img alt="Plateforme : Windows" src="https://img.shields.io/badge/platform-Windows%20x64-0078D6?logo=windows&logoColor=white"/>
  <img alt="Version" src="https://img.shields.io/badge/version-0.1.0-purple"/>
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2.0-24C8D8?logo=tauri&logoColor=white"/>
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white"/>
  <img alt="Licence : MIT" src="https://img.shields.io/badge/license-MIT-green"/>
</p>

**Lire dans d'autres langues :** [English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Deutsch](README.de.md)

---

## ✨ Qu'est-ce que c'est ?

DeepSeek Harness Desktop est une **coquille native légère** autour de la WebUI officielle de DeepSeek Harness. Plutôt que de réinventer l'interface, il intègre l'interface web officielle dans un `iframe` et ajoute ce qu'une application de bureau devrait avoir :

- **Démarrage du moteur en un clic** — détecte votre environnement local (`node` + `dsh`), choisit un port libre et lance le moteur avec le bon profil.
- **Réutilisation des instances existantes** — si une instance web DeepSeek Harness tourne déjà sur votre machine, l'application s'y connecte directement au lieu d'en démarrer une copie (plus de conflits sur le stockage des sessions `~/.dsh`).
- **Vérification de l'environnement + installation en un clic** — Node.js ou le moteur `dsh` manquant ? Le lanceur vous indique exactement ce qui manque et peut l'installer pour vous.
- **Fenêtre sans bordure** — barre de titre personnalisée (glisser / réduire / agrandir / fermer) et barre d'état indiquant l'état du moteur, le port et le nombre de sessions.
- **Persistance locale** — toutes les sessions sont stockées sur disque dans `~/.dsh/sessions/` : fermer l'application ne perd jamais votre travail.

Tout le reste — sessions, trajectoires, plugins, préréglages d'agents — est la **WebUI officielle de DeepSeek Harness** dans toute sa fidélité, puisque l'application se contente de l'héberger.

## 🚀 Démarrage rapide

1. **Téléchargez** le dernier installeur depuis [Releases](https://github.com/dongdong-agent/DSH-Desktop/releases) (`DSH Desktop_0.1.0_x64-setup.exe`, Windows x64), ou copiez l'exécutable portable `dsh-desktop.exe` où vous voulez.
2. **Lancez l'application**. La page de lancement affiche l'état de votre environnement (Node.js / npx / moteur dsh).
3. Cliquez sur **启动引擎 (Démarrer le moteur)**. L'application lance le moteur (`dsh --profile web` sur `127.0.0.1:17800` ou un autre port libre) et charge automatiquement la WebUI officielle.
4. Utilisez-la comme la version web — sessions, plugins, trajectoires, tout y est.

> Première utilisation : si Node.js ou `dsh` manque, utilisez les boutons **d'installation en un clic** de la page de lancement.

## 🏗 Architecture

```
┌────────────────────────────────────────────────────┐
│  TitleBar (barre de titre sans bordure + point)    │
├────────────────────────────────────────────────────┤
│  iframe plein écran → WebUI officielle DeepSeek    │
│  Harness — sessions / trajectoires / plugins /     │
│  réglages                                          │
├────────────────────────────────────────────────────┤
│  StatusBar (état du moteur · port · sessions)      │
└────────────────────────────────────────────────────┘
```

- **Frontend** : React 19 + TypeScript + Vite 6 + Tailwind CSS 4 + Zustand
- **Coquille de bureau** : Tauri 2 (Rust), fenêtre sans bordure avec barre de titre personnalisée
- **Cycle de vie du moteur** (`src/lib/dshEngine.ts`) : recherche d'instances existantes → choix d'un port libre → lancement (`node` + `bin.js` local, avec replis `npx` / `dsh` / `dsh.cmd`) → contrôle de santé → arrêt
- **Réseau** : RPC HTTP (`POST /api/<method>`) + flux d'événements WebSocket via `@tauri-apps/plugin-http` (évite totalement le CORS de WebView2)
- **Diagnostic** : les tentatives et échecs de lancement sont consignés dans `%TEMP%\dsh-spawn.log`

## 🧰 Pile technique

| Couche | Choix |
|---|---|
| Coquille de bureau | Tauri 2 (Rust), sans bordure + barre personnalisée |
| Frontend | React 19 + TypeScript + Vite 6 |
| Styles | Tailwind CSS 4 |
| État | Zustand 5 (stores engine / session / chat / ui) |
| UI intégrée | WebUI officielle DeepSeek Harness (iframe) |

## 🛠 Développement

```bash
npm install
npm run tauri dev          # mode développement (Vite sur le port 1422)
```

## 📦 Compilation

```bash
npm run build              # tsc + vite build
npm run tauri build        # paquet de production (installeur NSIS + exe portable)
```

Sortie : `src-tauri/target/release/bundle/nsis/DSH Desktop_0.1.0_x64-setup.exe`

## 📁 Structure du projet

```
src/
├── App.tsx                 # coquille : TitleBar + iframe(UI officielle) + StatusBar
├── lib/
│   ├── dshEngine.ts        # ★ cycle de vie du moteur / chaîne de lancement / journal
│   └── api.ts              # RPC HTTP + flux WS
├── stores/                 # stores zustand (engine / ui / session / chat)
└── components/
    ├── TitleBar.tsx        # barre de titre personnalisée
    ├── StatusBar.tsx       # état du moteur · port · sessions
    └── EngineLauncher.tsx  # lanceur : vérification + installation + démarrage
src-tauri/
├── capabilities/default.json  # ★ permissions (scope shell spawn, contrôles fenêtre)
├── tauri.conf.json            # configuration fenêtre / paquet
└── src/lib.rs                 # enregistrement des plugins
```

## 🔍 Dépannage

- **Les boutons ou le glissement de la barre de titre ne fonctionnent pas** — les permissions `core:window:*` (`allow-minimize` / `allow-toggle-maximize` / `allow-close` / `allow-start-dragging`) doivent figurer dans `src-tauri/capabilities/default.json`. Les capabilities sont compilées dans le binaire : recompilez après modification.
- **Le moteur ne démarre pas** — consultez `%TEMP%\dsh-spawn.log`. Causes courantes : absence de `shell:allow-spawn`, liste blanche de programmes du scope absente, ou entrées de scope sans le champ `cmd` (obligatoire pour les entrées non sidecar).
- **WebUI blanche** — l'application utilise `@tauri-apps/plugin-http` pour toutes les requêtes car WebView2 bloque les fetch inter-origines (CORS). Ne le remplacez pas par `fetch` natif.

## 📄 Licence

[MIT](LICENSE) © 2026 dongdong-agent
