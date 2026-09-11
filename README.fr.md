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

DeepSeek Harness Desktop est une **coquille native légère** autour de la WebUI officielle de DeepSeek Harness. Plutôt que de réinventer l'interface, elle héberge l'interface web officielle dans une **webview enfant** — un document de premier niveau dont l'origine *est* `127.0.0.1`, et non un `iframe` inter-sites — et ajoute ce qu'une application de bureau devrait avoir :

- **Démarrage du moteur en un clic** — détecte votre environnement local (`node` + `dsh`), choisit un port libre et lance le moteur avec le bon profil.
- **Réutilisation des instances existantes** — si une instance web DeepSeek Harness tourne déjà sur votre machine, l'application s'y connecte directement au lieu d'en démarrer une copie (plus de conflits sur le stockage des sessions `~/.dsh`).
- **Vérification de l'environnement + installation en un clic** — Node.js ou le moteur `dsh` manquant ? Le lanceur vous indique exactement ce qui manque et peut l'installer pour vous.
- **Fenêtre sans bordure** — barre de titre personnalisée (glisser / réduire / agrandir / fermer) et barre d'état indiquant l'état du moteur, le port et le niveau de zoom.
- **Sessions moteur authentifiées** — les moteurs ≥ 0.1.5 refusent les requêtes non authentifiées et émettent un cookie de session `SameSite=Strict`. La coquille signe elle-même ce cookie avec la clé du magasin d'identifiants géré et l'injecte dans la webview enfant : la WebUI se charge au lieu d'afficher une page 401.
- **Persistance locale** — toutes les sessions sont stockées sur disque dans `~/.dsh/sessions/` : fermer l'application ne perd jamais votre travail.

Tout le reste — sessions, trajectoires, plugins, préréglages d'agents — est la **WebUI officielle de DeepSeek Harness** dans toute sa fidélité, puisque l'application se contente de l'héberger.

## 🚀 Démarrage rapide

1. **Téléchargez** le dernier installeur depuis [Releases](https://github.com/dongdong-agent/DSH-Desktop/releases) (`DSH Desktop_0.1.0_x64-setup.exe`, Windows x64), ou copiez l'exécutable portable `dsh-desktop.exe` où vous voulez.
2. **Lancez l'application**. La page de lancement affiche l'état de votre environnement (Node.js / npx / moteur dsh).
3. Cliquez sur **启动引擎 (Démarrer le moteur)**. L'application lance le moteur (`dsh --profile web` sur `127.0.0.1:17800` ou un autre port libre) et charge automatiquement la WebUI officielle.
4. Utilisez-la comme la version web — sessions, plugins, trajectoires, tout y est.

> Première utilisation : si Node.js ou `dsh` manque, utilisez les boutons **d'installation en un clic** de la page de lancement.

## 🖥 Prise en charge des plateformes

| Plateforme | Statut | Utilisation |
|---|---|---|
| **Windows x64** | ✅ **Officiellement pris en charge** | Télécharger depuis [Releases](https://github.com/dongdong-agent/DSH-Desktop/releases) ou exécuter l'exe portable |
| **macOS (Apple Silicon / Intel)** | 🚧 Compilation depuis les sources | Voir ci-dessous |
| **Linux (x64)** | 🚧 Compilation depuis les sources | Voir ci-dessous |

**Windows est la plateforme principale** — les installateurs et les builds CI ciblent Windows en premier. macOS et Linux fonctionnent avec Tauri 2 mais ne sont pas encore publiés en artefacts précompilés ; compilez-les depuis les sources :

```bash
# Prérequis (toute plateforme)
# - Node.js ≥ 18 (https://nodejs.org) — fournit node et npx
# - Chaîne d'outils Rust stable (https://rustup.rs)
# - Dépendances système pour Tauri :
#   macOS :  Xcode Command Line Tools
#   Linux :  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
#            libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# Cloner et compiler
git clone https://github.com/dongdong-agent/DSH-Desktop.git
cd DSH-Desktop
npm install
npm run tauri build     # produit .app (macOS) / .deb/.AppImage (Linux) dans src-tauri/target/release/bundle/
```

**Remarques multiplateformes** :

- La coque de bureau (Tauri 2) est entièrement multiplateforme. Le moteur est le paquet npm officiel `@deepseek-ai/dsh`, qui fonctionne sur les trois plateformes via Node.js.
- Sur macOS/Linux, le moteur est lancé via la chaîne de secours `node` + `npx` (les chemins spécifiques à Windows `dsh.cmd` / `bin.js` local sont détectés à l'exécution et ignorés s'ils sont absents).
- Les sessions du moteur vivent dans `~/.dsh/` sur toutes les plateformes — sessions, profils et identifiants sont portables entre les OS.
- Vous voulez des artefacts précompilés macOS/Linux ? Ouvrez une [issue](https://github.com/dongdong-agent/DSH-Desktop/issues) — le workflow CI peut être étendu pour les publier.



## 🏗 Architecture

```
┌────────────────────────────────────────────────────┐
│  TitleBar (barre de titre sans bordure + point)    │
├────────────────────────────────────────────────────┤
│  webview enfant → WebUI officielle DeepSeek Harness│
│  — sessions / trajectoires / plugins / réglages    │
│  document de premier niveau sur 127.0.0.1          │
├────────────────────────────────────────────────────┤
│  StatusBar (état du moteur · port · zoom)          │
└────────────────────────────────────────────────────┘
```

- **Frontend** : React 19 + TypeScript + Vite 6 + Tailwind CSS 4 + Zustand
- **Coquille de bureau** : Tauri 2 (Rust), fenêtre sans bordure avec barre de titre personnalisée
- **Cycle de vie du moteur** (`src/lib/dshEngine.ts`) : recherche d'instances existantes → choix d'un port libre → lancement (`node` + `bin.js` local, avec replis `npx` / `dsh` / `dsh.cmd`) → contrôle de santé → arrêt
- **Vue moteur** (`src-tauri/src/lib.rs`) : lorsque le moteur tourne, le webview de la fenêtre principale navigue vers la page du moteur (document de premier niveau) ; un cookie de session auto-signé est injecté au premier chargement (voir `src/lib/engineAuth.ts`)
- **Authentification de session** (`src/lib/engineAuth.ts`) : lit la clé de signature de session du navigateur dans `~/.dsh/.credentials.yaml`, génère un cookie vérifiable par le moteur et l'injecte à chaque fin de chargement de page
- **Diagnostic** : les tentatives et échecs de lancement sont consignés dans `%TEMP%\dsh-spawn.log`

## 🧰 Pile technique

| Couche | Choix |
|---|---|
| Coquille de bureau | Tauri 2 (Rust), sans bordure + barre personnalisée |
| Frontend | React 19 + TypeScript + Vite 6 |
| Styles | Tailwind CSS 4 |
| État | Zustand 5 (un seul store `engine` — la coquille ne conserve aucun état de chat/session) |
| UI intégrée | WebUI officielle DeepSeek Harness (Tauri **webview enfant**) |

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
├── App.tsx                 # coquille : TitleBar + hôte de la webview enfant + StatusBar
├── lib/
│   ├── dshEngine.ts        # ★ cycle de vie du moteur / chaîne de lancement / journal
│   ├── engineAuth.ts       # cookie de session moteur auto-signé (identifiants gérés)
│   ├── updater.ts          # vérification de version du noyau / installation / rollback
│   └── types.ts            # types partagés (EngineHealth)
├── stores/                 # store zustand (engine)
└── components/
    ├── TitleBar.tsx        # barre de titre personnalisée
    ├── StatusBar.tsx       # état du moteur · version du noyau / rollback · zoom
    ├── EngineLauncher.tsx  # lanceur : vérification + installation + démarrage
    ├── CloseDialog.tsx     # fermer / réduire dans la barre / arrêter le moteur et quitter
    └── KeyManagerDialog.tsx# gestion des clés API / identifiants
src-tauri/
├── capabilities/default.json  # ★ permissions (scope shell spawn, contrôles fenêtre)
├── tauri.conf.json            # configuration fenêtre / paquet
└── src/lib.rs                 # webview enfant (mount/bounds/unmount) + enregistrement des plugins
```

## 🔍 Dépannage

- **Les boutons ou le glissement de la barre de titre ne fonctionnent pas** — les permissions `core:window:*` (`allow-minimize` / `allow-toggle-maximize` / `allow-close` / `allow-start-dragging`) doivent figurer dans `src-tauri/capabilities/default.json`. Les capabilities sont compilées dans le binaire : recompilez après modification.
- **Le moteur ne démarre pas** — consultez `%TEMP%\dsh-spawn.log`. Causes courantes : absence de `shell:allow-spawn`, liste blanche de programmes du scope absente, ou entrées de scope sans le champ `cmd` (obligatoire pour les entrées non sidecar).
- **WebUI blanche / « authentication required »** — les moteurs ≥ 0.1.5 exigent un cookie de session et le marquent `SameSite=Strict`. Un `iframe` dans la page de la coquille (`tauri.localhost`) est un contexte inter-sites : le cookie n'y serait jamais envoyé — c'est précisément pourquoi l'UI du moteur est hébergée dans une **webview enfant**. Si une page 401 apparaît, vérifiez que `~/.dsh/.credentials.yaml` contient toujours `client-connection/browser-session` ; sans cette clé de signature, aucun cookie ne peut être généré.
- **Vue moteur décalée après un zoom** — la coquille convertit les pixels CSS en pixels logiques via le facteur de zoom courant avant d'appeler `set_engine_view_bounds`. En cas de changement de mise en page, gardez synchronisés les bornes de l'élément hôte et la conversion de zoom.

## 📄 Licence

[MIT](LICENSE) © 2026 dongdong-agent
