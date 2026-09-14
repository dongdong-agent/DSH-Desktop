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
struct EnginePort(Mutex<Option<u16>>);

/// 前端登记 / 清除当前引擎端口（None = 引擎未运行，避免误杀后续占用该端口的进程）。
#[tauri::command]
fn set_engine_port(port: Option<u16>, state: tauri::State<'_, EnginePort>) {
    if let Ok(mut p) = state.0.lock() {
        *p = port;
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
    let port = app.state::<EnginePort>().0.lock().ok().and_then(|p| *p);
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
    let mut landed = false;
    for _ in 0..50 {
        std::thread::sleep(std::time::Duration::from_millis(100));
        if let Ok(cur) = window.url() {
            if cur.host_str() == Some("127.0.0.1") {
                landed = true;
                break;
            }
        }
    }
    let _ = landed;
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
            set_engine_port
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
            let quit = MenuItem::with_id(app, "quit", "退出（不影响后台引擎）", true, None::<&str>)?;
            let quit_all_item =
                MenuItem::with_id(app, "quit-all", "完全退出（同时关闭引擎）", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &manage, &quit, &quit_all_item])?;

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
