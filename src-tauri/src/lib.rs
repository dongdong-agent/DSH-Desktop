use std::sync::Mutex;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

/// 当前引擎端口（前端登记，供托盘「完全退出」按端口强杀引擎进程）。
///
/// 引擎由前端（shell 插件）spawn，就绪后主窗口会**顶层导航**到引擎页，
/// 壳的 JS 上下文随之被替换——托盘事件再也回不到前端。因此杀引擎的动作
/// 必须放在 Rust 侧，前端只负责在健康状态变化时把端口登记进来。
#[derive(Default)]
struct EnginePort {
    /// 引擎**此刻**是否在跑（None = 未运行）；托盘「完全退出」据此判断要不要强杀
    current: Mutex<Option<u16>>,
    /// 最近一次已知端口：只在 Some 时更新、**永不因 None 清空**。
    /// 托盘「重启引擎」需要它——重启期间前端会先把端口置 null，
    /// 此时若只看到 None 就只能退回默认端口 17800，会在旧端口实例之外另起一个（双实例）。
    last: Mutex<Option<u16>>,
}

/// 前端登记 / 清除当前引擎端口（None = 引擎未运行，避免误杀后续占用该端口的进程）。
#[tauri::command]
fn set_engine_port(port: Option<u16>, state: tauri::State<'_, EnginePort>) {
    if let Ok(mut p) = state.current.lock() {
        *p = port;
    }
    if let Some(port) = port {
        if let Ok(mut l) = state.last.lock() {
            *l = Some(port);
        }
    }
}

/// netstat -ano 找 LISTENING 在该端口的 PID → taskkill /PID <pid> /T /F（连同子进程）。
/// Windows GUI 子系统下用 CREATE_NO_WINDOW 避免闪出控制台窗口。
#[cfg(windows)]
fn kill_port_owner(port: u16) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let Ok(out) = std::process::Command::new("netstat")
        .arg("-ano")
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    else {
        return;
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let suffix = format!(":{port}");
    for line in text.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        // 形如：TCP  127.0.0.1:17800  0.0.0.0:0  LISTENING  12345
        if cols.len() < 5 || cols[0] != "TCP" || cols[3] != "LISTENING" || !cols[1].ends_with(&suffix) {
            continue;
        }
        if let Ok(pid) = cols[4].parse::<u32>() {
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }
        return;
    }
}

/// 非 Windows 平台无 netstat / taskkill 语义，退化为只退出 GUI。
#[cfg(not(windows))]
fn kill_port_owner(_port: u16) {}

/// 托盘「完全退出」：先按登记的端口强杀引擎进程（含子进程），再退出 GUI。
/// 纯 Rust 实现，不依赖前端 JS，因此导航到引擎页后依然有效。
fn quit_all(app: &tauri::AppHandle) {
    // 只认「此刻在跑」的端口：引擎未运行时不动手，避免误杀后续占用同一端口的其他进程。
    let port = app.state::<EnginePort>().current.lock().ok().and_then(|p| *p);
    if let Some(port) = port {
        kill_port_owner(port);
    }
    app.exit(0);
}

/// 打开 / 聚焦 WebView 开发者调试器（F12）
#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) {
    let _ = window.open_devtools();
}

/// 关闭 WebView 开发者调试器
#[tauri::command]
fn close_devtools(window: tauri::WebviewWindow) {
    let _ = window.close_devtools();
}

/// 把主窗口的 webview 导航到引擎（dsh web）页面。
///
/// 历史结论（勿回退到 iframe / 同窗口子 webview，均已实测失败）：
/// - iframe：壳站点 tauri.localhost 加载 http://127.0.0.1:<port> 属跨站上下文，
///   引擎下发的 SameSite=Strict 会话 Cookie 不会被发送 → 永远 401；
/// - 同窗口子 webview（Tauri unstable 多 webview）：WebView2 多 controller
///   渲染不稳定（本机实测内容区整体黑屏，resize/置顶均无法恢复）。
/// 顶层导航没有这两个问题。
///
/// `auth_js` 是前端生成的幂等注入脚本（见 src/lib/engineAuth.ts）：
/// 页面落地到 401 文本页时写入自签会话 Cookie 并 location.replace 回根路径。
#[tauri::command]
async fn open_engine_in_main(
    window: tauri::WebviewWindow,
    url: String,
    auth_js: String,
) -> Result<(), String> {
    let target: tauri::Url = url
        .parse()
        .map_err(|e| format!("invalid engine url: {e}"))?;
    window.navigate(target).map_err(|e| e.to_string())?;

    // 等待导航落地：url 的 host 变成 127.0.0.1 即视为已进入引擎页（含 401 文本页）。
    //
    // 2026-09-16 修复（勿回退成 `let _ = landed;` + 无条件 eval）：
    // 旧实现丢弃了落地结果却**照样执行 `window.eval(auth_js)`**。`document.cookie` 只能写
    // **当前文档域**的 Cookie —— 冷启动导航慢（重启电脑后首次启动正是如此）时，脚本会作用在
    // 壳页面 `tauri.localhost` 上，把自签会话 Cookie 写到错误的域；而 auth_js 的幂等判据是
    // `document.cookie.indexOf(name)`，在壳页面上「已存在」于是不再重试 —— 结果引擎页永远 401，
    // 且此后刷新/重启都不会自愈。现在：**只有确认落到 127.0.0.1 才注入**；等到截止仍未落地
    // 就返回 Err（前端会把失败原因落盘到 %TEMP%\dsh-engine-view.log），把"静默永久 401"
    // 变成"一次可诊断的失败"。
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    let mut landed = false;
    while std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(100));
        if let Ok(cur) = window.url() {
            if cur.host_str() == Some("127.0.0.1") {
                landed = true;
                break;
            }
        }
    }
    if !landed {
        return Err(
            "engine page did not land on 127.0.0.1 within 20s; skipped auth injection to avoid writing the session cookie to the shell origin".into(),
        );
    }
    // 再留一点渲染时间；脚本幂等，执行偏早/偏晚都安全。
    std::thread::sleep(std::time::Duration::from_millis(400));
    window.eval(auth_js).map_err(|e| e.to_string())
}

/// 托盘菜单「退出」：直接退出 GUI。
/// 引擎是共享的 node 进程（可能同时服务 Electron 版等其他 GUI/浏览器），
/// 因此退出 GUI 不停引擎。
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// 引擎业务就绪探针的响应（status=0 表示连接/读写失败）。
#[derive(serde::Serialize)]
struct EngineProbeResult {
    status: u16,
    /// 引擎 RPC envelope 的 result.ok（body 无法解析时为 false）
    ok: bool,
    /// 响应体（截断，供前端诊断日志）
    body: String,
}

/// 引擎业务就绪探针（2026-09-16）：带自签会话 Cookie 调引擎 RPC `session/list`，
/// 由前端（dshEngine.probeEngineReady）在「导航进引擎页」之前判定业务是否就绪。
///
/// 为什么在 Rust 侧发（勿回退成前端 plugin-http 直发）：
/// 引擎的 trust 层按 Origin 白名单（自身 authority）放行 `/api` 请求，而壳页面 JS 经
/// tauri-plugin-http 发请求时 Origin 被固定为壳站点 tauri.localhost → 引擎一律
/// 403 forbidden；前端显式设置 Origin 头也会被插件覆盖（2026-09-16 两轮实测坐实）。
/// Rust 侧手写的 HTTP 不带 Origin —— 与「无 Origin 的客户端」同形态，
/// 实测可拿到 session/list 的 ok:true（会话索引就绪的直接证据）。
///
/// 手写 HTTP/1.1 而非引入 reqwest：单请求、无重定向、需精确控制头集合，
/// std::net::TcpStream 足够且不增加依赖。
#[tauri::command]
async fn probe_engine_ready(port: u16, cookie: String) -> Result<EngineProbeResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::{Read, Write};
        use std::net::TcpStream;
        use std::time::Duration;

        let addr = format!("127.0.0.1:{port}");
        let mut stream = TcpStream::connect(&addr).map_err(|e| format!("connect: {e}"))?;
        stream
            .set_read_timeout(Some(Duration::from_millis(1500)))
            .map_err(|e| format!("read-timeout: {e}"))?;
        stream
            .set_write_timeout(Some(Duration::from_millis(1500)))
            .map_err(|e| format!("write-timeout: {e}"))?;
        // Connection RPC 信封（引擎 ClientRequest；payload 须恰好包一层 args）
        let body = r#"{"type":"client-request","rpcId":"gui-ready-probe","method":"session/list","payload":{"args":{"_request":{}}}}"#;
        // HTTP/1.0：引擎（hyper）对 1.1 请求会以 chunked 编码回包（body 混入块长度行，
        // 前端 JSON.parse 必失败）；1.0 语义下回包带 Content-Length、无 chunk 标记。
        let request = format!(
            "POST /api/session/list HTTP/1.0\r\nHost: {addr}\r\nCookie: {cookie}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(request.as_bytes())
            .map_err(|e| format!("write: {e}"))?;
        let mut buf = Vec::new();
        // Connection: close → 读到 EOF；对端未就绪时读超时也会把已收到的部分带回来
        let _ = stream.read_to_end(&mut buf);
        let text = String::from_utf8_lossy(&buf).to_string();
        // 形如 "HTTP/1.0 200 OK" → 取第二段
        let status = text
            .split_whitespace()
            .nth(1)
            .and_then(|s| s.parse::<u16>().ok())
            .unwrap_or(0);
        // 注意不要截断：session/list 的响应可能超过数 KB，截断会让 serde 解析失败
        // → ok 被误判为 false（2026-09-16 真机实测踩过）。诊断展示的截断由前端负责。
        let body = text.split("\r\n\r\n").nth(1).unwrap_or("").to_string();
        // result.ok 由 Rust 侧解析（前端不再做 JSON.parse，避免再踩响应形态差异）
        let ok = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| {
                v.get("result")
                    .and_then(|r| r.get("ok"))
                    .and_then(|o| o.as_bool())
            })
            .unwrap_or(false);
        Ok(EngineProbeResult { status, ok, body })
    })
    .await
    .map_err(|e| format!("join: {e}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // 单实例：重复启动只聚焦已有窗口，避免开多个实例/窗口
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .manage(EnginePort::default())
        .invoke_handler(tauri::generate_handler![
            open_devtools,
            close_devtools,
            open_engine_in_main,
            quit_app,
            set_engine_port,
            probe_engine_ready
        ])
        .setup(|app| {
            // 系统托盘：最小化到托盘后可从这里恢复窗口 / 打开管理界面 / 退出
            let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let manage = MenuItem::with_id(
                app,
                "manage",
                "打开管理界面（引擎升级 / 密钥 / 状态栏）",
                true,
                None::<&str>,
            )?;
            // 重启引擎：引擎进程只在**启动时**读一次环境变量与配置（改 Key / 换内核后必须重启才生效）；
            // 引擎运行中窗口显示的是引擎页、壳自己的重启入口不可见，故在这条唯一常驻通道上提供。
            let restart_engine =
                MenuItem::with_id(app, "restart-engine", "重启引擎", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出（不影响后台引擎）", true, None::<&str>)?;
            let quit_all_item =
                MenuItem::with_id(app, "quit-all", "完全退出（同时关闭引擎）", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[&show, &manage, &restart_engine, &quit, &quit_all_item],
            )?;

            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("DeepSeek Harness Desktop")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    // 回到壳 UI（带 ?manage=1 标记，前端据此暂停自动跳转引擎页）：
                    // 引擎运行中窗口直接显示 WebUI，壳的升级/密钥/状态栏入口不可见，
                    // 托盘这里提供随时回到管理界面的通道。
                    "manage" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                            // dev 模式壳来自 vite dev server，生产才是 tauri.localhost
                            let base = if cfg!(debug_assertions) {
                                "http://localhost:1422/?manage=1"
                            } else {
                                "http://tauri.localhost/?manage=1"
                            };
                            if let Ok(u) = tauri::Url::parse(base) {
                                let _ = w.navigate(u);
                            }
                        }
                    }
                    // 重启引擎：导航回壳并带 `?restart=1&port=<当前端口>` 标记，由前端执行真正的重启。
                    //
                    // 为什么不在 Rust 侧直接杀端口 + 重启：引擎重启是一整条链路
                    // （清 `~/.dsh/profiles` 残留写锁 → 注入受管凭据 → 写覆盖层 → 候选命令回退），
                    // 这些能力只存在于前端 src/lib/dshEngine.ts；Rust 侧只能杀进程，杀完没有能力把它拉起来。
                    // 而引擎就绪后主窗口是**顶层导航**到引擎页的，壳的 JS 已不再运行，
                    // 托盘是该场景下唯一常驻入口 —— 所以这里只负责「把控制权交回壳」。
                    // 端口一并带上：前端冷加载后 currentPort 是默认值，
                    // 不带端口会在 17800 上另起一个实例（原端口实例被丢弃，等于换端口重启）。
                    // 取 last 而非 current：重启期间前端已把 current 置 null，
                    // 只有 last 记得住「该重启哪个端口」。
                    "restart-engine" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                            let port = app.state::<EnginePort>().last.lock().ok().and_then(|p| *p);
                            let query = match port {
                                Some(p) => format!("restart=1&port={p}"),
                                None => "restart=1".to_string(),
                            };
                            // dev 模式壳来自 vite dev server，生产才是 tauri.localhost
                            let base = if cfg!(debug_assertions) {
                                format!("http://localhost:1422/?{query}")
                            } else {
                                format!("http://tauri.localhost/?{query}")
                            };
                            if let Ok(u) = tauri::Url::parse(&base) {
                                let _ = w.navigate(u);
                            }
                        }
                    }
                    // 引擎是共享的 node 进程，退出 GUI 不停引擎
                    "quit" => {
                        app.exit(0);
                    }
                    // 完全退出：连同引擎一起关掉（Rust 侧按端口强杀，导航到引擎页后仍可用）
                    "quit-all" => {
                        quit_all(app);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // 左键单击恢复窗口
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running dsh-desktop");
}
