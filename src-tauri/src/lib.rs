use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::PageLoadEvent,
    Emitter, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl,
};

/// 把窗口内的子 webview 提到 z-order 顶层。
///
/// wry 创建的子 webview 默认位于主 webview **之下**，而壳页面（tauri.localhost）
/// 内容区是不透明背景，会把子 webview 整个遮住——表现就是"标题栏/状态栏都在，
/// 但内容区一片黑"。这里直接调 user32 的 SetWindowPos 把它提到 HWND_TOP。
#[cfg(windows)]
fn bring_webview_to_front(hwnd: isize) {
    #[link(name = "user32")]
    extern "system" {
        fn SetWindowPos(
            hwnd: isize,
            insert_after: isize,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            flags: u32,
        ) -> i32;
    }
    const HWND_TOP: isize = 0;
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_SHOWWINDOW: u32 = 0x0040;
    unsafe {
        SetWindowPos(
            hwnd,
            HWND_TOP,
            0,
            0,
            0,
            0,
            SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
    }
}

#[cfg(not(windows))]
fn bring_webview_to_front(_hwnd: isize) {}

/// 把某个 webview 提到窗口内 z-order 顶层。
/// `Webview` 自身没有公开 `hwnd()`（只有 `WebviewWindow` 有），
/// 所以经 `with_webview` 拿到 WebView2 controller 再取 `ParentWindow()`。
#[cfg(windows)]
fn raise_webview<R: tauri::Runtime>(view: &tauri::Webview<R>) {
    let _ = view.with_webview(|pw| {
        let controller = pw.controller();
        // webview2-com 0.38 的 COM 方法是 out-param 风格：ParentWindow(&mut HWND) -> Result<()>
        let mut hwnd = unsafe { std::mem::zeroed() };
        if unsafe { controller.ParentWindow(&mut hwnd) }.is_ok() {
            bring_webview_to_front(hwnd.0 as isize);
        }
    });
}

#[cfg(not(windows))]
fn raise_webview<R: tauri::Runtime>(_view: &tauri::Webview<R>) {}

/// 承载引擎（dsh web）页面的子 webview label。
/// 必须是**子 webview** 而不是 iframe：壳页面自身站点是 tauri.localhost，
/// iframe 里加载 http://127.0.0.1:<port> 属于跨站上下文，引擎下发的
/// SameSite=Strict 会话 Cookie 不会被发送（实测：303 换完 Cookie 的下一个请求即 401）。
/// 子 webview 是独立的顶层文档，站点即 127.0.0.1，Cookie 正常生效。
const ENGINE_VIEW_LABEL: &str = "engine";

/// 串行化引擎子 webview 的创建 / 销毁 / 定位。
///
/// 为什么必须加锁：React StrictMode（开发模式默认开启）会让挂载 effect 连续执行
/// 两次，于是两个 `mount_engine_view` 会并发抵达。两者都读到「尚无 engine webview」
/// 便各自 `add_child` 同一个 label，后创建的把前一个挤掉，被挤掉那个的 dispatcher
/// 通道随即断开 —— 实测表现为 `bounds=Err(FailedToReceiveMessage)`，紧接着窗口与
/// 事件循环一起终止（进程 exit code 1，用户侧看到的是应用闪退/黑屏）。
/// 串行化后第二次调用自然落入 reuse 分支，只同步位置与尺寸。
static ENGINE_VIEW_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 挂载（或更新）承载引擎页面的子 webview，铺在内容区。
///
/// `auth_js` 由前端注入：内容 = 「若本地无会话 Cookie 则写入自签 Cookie 并重载」。
/// 每次页面加载完成都会执行一次（幂等），因此 Cookie 过期后可自动重建。
///
/// 必须是 async：`Window::add_child` 内部通过 `run_on_main_thread` 投递闭包并阻塞
/// 等待其完成，若本命令在主线程同步执行（Tauri 同步 command 的默认行为），
/// 就会自己等自己 → 死锁（表现为 invoke 永不返回、窗口一片黑）。
#[tauri::command]
async fn mount_engine_view(
    app: tauri::AppHandle,
    url: String,
    auth_js: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    // 本函数内没有 .await，持锁期间不会让出线程，因此 std Mutex 是安全的。
    let _guard = ENGINE_VIEW_LOCK
        .lock()
        .map_err(|_| "engine view lock poisoned".to_string())?;

    let pos = LogicalPosition::new(x, y);
    let size = LogicalSize::new(width.max(1.0), height.max(1.0));

    // 已存在则复用：只同步位置/尺寸并导航（避免重建导致闪白）
    if let Some(view) = app.get_webview(ENGINE_VIEW_LABEL) {
        println!("[engine-view] reuse x={x} y={y} w={width} h={height}");
        view.set_position(pos).map_err(|e| e.to_string())?;
        view.set_size(size).map_err(|e| e.to_string())?;
        raise_webview(&view);
        let parsed: tauri::Url = url.parse().map_err(|e| format!("invalid engine url: {e}"))?;
        view.navigate(parsed).map_err(|e| e.to_string())?;
        return Ok(());
    }

    let window = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let parsed: tauri::Url = url.parse().map_err(|e| format!("invalid engine url: {e}"))?;
    let builder = WebviewBuilder::new(ENGINE_VIEW_LABEL, WebviewUrl::External(parsed)).on_page_load(
        move |webview, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let _ = webview.eval(auth_js.clone());
            }
        },
    );
    let scale = window.scale_factor().unwrap_or(1.0);
    println!("[engine-view] mount x={x} y={y} w={width} h={height} scale={scale}");
    let view = match window.add_child(builder, pos, size) {
        Ok(view) => view,
        Err(e) => {
            println!("[engine-view] add_child FAILED: {e}");
            return Err(format!("mount engine view failed: {e}"));
        }
    };
    raise_webview(&view);
    println!("[engine-view] child created at top of z-order");
    Ok(())
}

/// 仅同步子 webview 的位置/尺寸（窗口缩放、沉浸模式切换、缩放变更）。
#[tauri::command]
async fn set_engine_view_bounds(
    app: tauri::AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    // 与 mount 共用同一把锁：卸载/重挂期间不允许插入定位调用
    let _guard = ENGINE_VIEW_LOCK
        .lock()
        .map_err(|_| "engine view lock poisoned".to_string())?;
    if let Some(view) = app.get_webview(ENGINE_VIEW_LABEL) {
        view.set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        view.set_size(LogicalSize::new(width.max(1.0), height.max(1.0)))
            .map_err(|e| e.to_string())?;
        // 尺寸同步后重新确认置顶（窗口显隐/布局变化都可能改变 z-order）
        raise_webview(&view);
    }
    Ok(())
}

/// 卸载子 webview（引擎停止 / 回到启动器页面）。
#[tauri::command]
async fn unmount_engine_view(app: tauri::AppHandle) -> Result<(), String> {
    let _guard = ENGINE_VIEW_LOCK
        .lock()
        .map_err(|_| "engine view lock poisoned".to_string())?;
    if let Some(view) = app.get_webview(ENGINE_VIEW_LABEL) {
        view.close().map_err(|e| e.to_string())?;
    }
    Ok(())
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
        .invoke_handler(tauri::generate_handler![
            open_devtools,
            close_devtools,
            mount_engine_view,
            set_engine_view_bounds,
            unmount_engine_view
        ])
        .setup(|app| {
            // 系统托盘：最小化到托盘后可从这里恢复窗口 / 退出
            let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出并停止引擎", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

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
                    // 引擎子进程由前端 shell 持有，先 emit 给前端停引擎再销毁窗口
                    "quit" => {
                        let _ = app.emit("tray-quit", ());
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
