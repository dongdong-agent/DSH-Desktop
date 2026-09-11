# DeepSeek Harness Desktop

> **DSH Desktop** — Un cliente de escritorio nativo para [DeepSeek Harness](https://www.deepseek.com/harness/), construido con Tauri 2 + React 19. Incrusta la WebUI oficial de DeepSeek Harness y gestiona el motor local por ti.

<p align="center">
  <img alt="Plataforma: Windows" src="https://img.shields.io/badge/platform-Windows%20x64-0078D6?logo=windows&logoColor=white"/>
  <img alt="Versión" src="https://img.shields.io/badge/version-0.1.0-purple"/>
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2.0-24C8D8?logo=tauri&logoColor=white"/>
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white"/>
  <img alt="Licencia: MIT" src="https://img.shields.io/badge/license-MIT-green"/>
</p>

**Leer en otros idiomas:** [English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Deutsch](README.de.md)

---

## ✨ ¿Qué es?

DeepSeek Harness Desktop es un **envoltorio nativo ligero** alrededor de la WebUI oficial de DeepSeek Harness. En lugar de reinventar la interfaz, aloja la web oficial en una **webview hija** — un documento de nivel superior cuyo origen *es* `127.0.0.1`, no un `iframe` entre sitios — y añade lo que una aplicación de escritorio debería tener:

- **Arranque del motor con un clic** — detecta tu entorno local (`node` + `dsh`), elige un puerto libre y lanza el motor con el perfil correcto.
- **Reutiliza instancias existentes** — si ya hay una instancia web de DeepSeek Harness ejecutándose, la app se conecta directamente en lugar de duplicarla (sin peleas por el almacenamiento de sesiones en `~/.dsh`).
- **Autocomprobación del entorno + instalación con un clic** — ¿Faltan Node.js o el motor `dsh`? El lanzador te dice exactamente qué falta y puede instalarlo por ti.
- **Ventana sin bordes** — barra de título personalizada (arrastrar / minimizar / maximizar / cerrar) y una barra de estado con el estado del motor, el puerto y el nivel de zoom.
- **Sesiones de motor autenticadas** — los motores ≥ 0.1.5 rechazan las peticiones no autenticadas y emiten una cookie de sesión `SameSite=Strict`. El envoltorio firma esa cookie con la clave del almacén de credenciales gestionado y la inyecta en la webview hija, de modo que la WebUI carga en lugar de mostrar una página 401.
- **Persistencia local** — todas las sesiones viven en disco en `~/.dsh/sessions/`, así que cerrar la app nunca pierde tu trabajo.

Todo lo demás — sesiones, trayectorias, plugins, ajustes — es la **WebUI oficial de DeepSeek Harness** con toda su fidelidad, ya que la app simplemente la aloja.

## 🚀 Inicio rápido

1. **Descarga** el instalador más reciente desde [Releases](https://github.com/dongdong-agent/DSH-Desktop/releases) (`DSH Desktop_0.1.0_x64-setup.exe`, Windows x64), o copia el ejecutable portátil `dsh-desktop.exe` a cualquier carpeta.
2. **Lanza la app**. La página de inicio muestra el estado de tu entorno (Node.js / npx / motor dsh).
3. Haz clic en **启动引擎 (Iniciar motor)**. La app lanza el motor (`dsh --profile web` en `127.0.0.1:17800` u otro puerto libre) y carga automáticamente la WebUI oficial.
4. Úsala como la versión web — sesiones, plugins, trayectorias, todo está ahí.

> Primera ejecución: si faltan Node.js o `dsh`, usa los botones de **instalación con un clic** de la página de inicio.

## 🖥 Soporte de plataformas

| Plataforma | Estado | Cómo usar |
|---|---|---|
| **Windows x64** | ✅ **Oficialmente soportado** | Descargar desde [Releases](https://github.com/dongdong-agent/DSH-Desktop/releases) o ejecutar el exe portable |
| **macOS (Apple Silicon / Intel)** | 🚧 Compilar desde código | Ver abajo |
| **Linux (x64)** | 🚧 Compilar desde código | Ver abajo |

**Windows es la plataforma principal** — los instaladores y builds de CI se dirigen primero a Windows. macOS y Linux funcionan con Tauri 2 pero aún no se publican como artefactos precompilados; compílalos desde el código fuente:

```bash
# Requisitos (cualquier plataforma)
# - Node.js ≥ 18 (https://nodejs.org) — proporciona node y npx
# - Toolchain estable de Rust (https://rustup.rs)
# - Dependencias del sistema para Tauri:
#   macOS:  Xcode Command Line Tools
#   Linux:  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
#           libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# Clonar y compilar
git clone https://github.com/dongdong-agent/DSH-Desktop.git
cd DSH-Desktop
npm install
npm run tauri build     # genera .app (macOS) / .deb/.AppImage (Linux) en src-tauri/target/release/bundle/
```

**Notas multiplataforma**:

- La carcasa de escritorio (Tauri 2) es totalmente multiplataforma. El motor es el paquete npm oficial `@deepseek-ai/dsh`, que funciona en las tres plataformas vía Node.js.
- En macOS/Linux el motor se inicia mediante la cadena de respaldo `node` + `npx` (las rutas específicas de Windows `dsh.cmd` / `bin.js` local se detectan en tiempo de ejecución y se omiten si no existen).
- Las sesiones del motor viven en `~/.dsh/` en todas las plataformas — sesiones, perfiles y credenciales son portables entre sistemas operativos.
- ¿Quieres artefactos precompilados para macOS/Linux? Abre un [issue](https://github.com/dongdong-agent/DSH-Desktop/issues) — el flujo de CI se puede ampliar para publicarlos.



## 🏗 Arquitectura

```
┌────────────────────────────────────────────────────┐
│  TitleBar (barra de título personalizada + punto)  │
├────────────────────────────────────────────────────┤
│  webview hija → WebUI oficial DeepSeek Harness     │
│  (sesiones / trayectorias / plugins / ajustes)     │
│  como documento de nivel superior en 127.0.0.1     │
├────────────────────────────────────────────────────┤
│  StatusBar (estado del motor · puerto · zoom)      │
└────────────────────────────────────────────────────┘
```

- **Frontend**: React 19 + TypeScript + Vite 6 + Tailwind CSS 4 + Zustand
- **Cáscara de escritorio**: Tauri 2 (Rust), ventana sin bordes con barra de título personalizada
- **Ciclo de vida del motor** (`src/lib/dshEngine.ts`): escanear instancias existentes → elegir puerto libre → lanzar (`node` + `bin.js` local, con respaldos `npx` / `dsh` / `dsh.cmd`) → comprobar salud → detener
- **Vista del motor** (`src-tauri/src/lib.rs`): cuando el motor está en ejecución, el webview de la ventana principal navega a la página del motor como documento de nivel superior; en la primera carga se inyecta una cookie de sesión autofirmada (véase `src/lib/engineAuth.ts`)
- **Autenticación de sesión** (`src/lib/engineAuth.ts`): lee la clave de firma de la sesión del navegador desde `~/.dsh/.credentials.yaml`, genera una cookie verificable por el motor y la inyecta en cada carga de página completada
- **Diagnóstico**: los intentos y fallos de lanzamiento se registran en `%TEMP%\dsh-spawn.log`

## 🧰 Pila tecnológica

| Capa | Elección |
|---|---|
| Cáscara de escritorio | Tauri 2 (Rust), sin bordes + barra personalizada |
| Frontend | React 19 + TypeScript + Vite 6 |
| Estilos | Tailwind CSS 4 |
| Estado | Zustand 5 (un único store `engine` — el envoltorio no guarda estado de chat/sesiones) |
| UI incrustada | WebUI oficial de DeepSeek Harness (Tauri **webview hija**) |

## 🛠 Desarrollo

```bash
npm install
npm run tauri dev          # modo desarrollo (Vite en el puerto 1422)
```

## 📦 Compilación

```bash
npm run build              # tsc + vite build
npm run tauri build        # paquete de producción (instalador NSIS + exe portátil)
```

Salida: `src-tauri/target/release/bundle/nsis/DSH Desktop_0.1.0_x64-setup.exe`

## 📁 Estructura del proyecto

```
src/
├── App.tsx                 # diseño de la cáscara: TitleBar + host de la webview hija + StatusBar
├── lib/
│   ├── dshEngine.ts        # ★ ciclo de vida del motor / cadena de lanzamiento / log
│   ├── engineAuth.ts       # cookie de sesión del motor autofirmada (credenciales gestionadas)
│   ├── updater.ts          # comprobación de versión del kernel / instalación / rollback
│   └── types.ts            # tipos compartidos (EngineHealth)
├── stores/                 # store de zustand (engine)
└── components/
    ├── TitleBar.tsx        # barra de título personalizada
    ├── StatusBar.tsx       # estado del motor · versión del kernel / rollback · zoom
    ├── EngineLauncher.tsx  # lanzador: comprobación + instalación + inicio
    ├── CloseDialog.tsx     # cerrar / minimizar a bandeja / detener motor y salir
    └── KeyManagerDialog.tsx# gestión de API keys / credenciales
src-tauri/
├── capabilities/default.json  # ★ permisos (scope de shell spawn, controles de ventana)
├── tauri.conf.json            # configuración de ventana / paquete
└── src/lib.rs                 # webview hija (mount/bounds/unmount) + registro de plugins
```

## 🔍 Solución de problemas

- **Los botones o el arrastre de la barra de título no funcionan** — se necesitan permisos `core:window:*` (`allow-minimize` / `allow-toggle-maximize` / `allow-close` / `allow-start-dragging`) en `src-tauri/capabilities/default.json`. Las capabilities se compilan en el binario: recompila tras editarlas.
- **El motor no arranca** — revisa `%TEMP%\dsh-spawn.log`. Causas comunes: falta `shell:allow-spawn`, falta la lista blanca de programas en el scope, o entradas de scope sin el campo `cmd` (obligatorio para entradas no sidecar).
- **WebUI en blanco / «authentication required»** — los motores ≥ 0.1.5 exigen una cookie de sesión y la marcan como `SameSite=Strict`. Un `iframe` dentro de la página del envoltorio (`tauri.localhost`) es un contexto entre sitios, así que la cookie nunca se enviaría: por eso la UI del motor se aloja en una **webview hija**. Si aparece una página 401, comprueba que `~/.dsh/.credentials.yaml` siga conteniendo `client-connection/browser-session`; sin esa clave de firma no se puede generar la cookie.
- **Vista del motor desalineada tras hacer zoom** — el envoltorio convierte los píxeles CSS a píxeles lógicos con el factor de zoom actual antes de llamar a `set_engine_view_bounds`. Si cambias el diseño, mantén sincronizados los límites del elemento anfitrión y la conversión de zoom.

## 📄 Licencia

[MIT](LICENSE) © 2026 dongdong-agent
