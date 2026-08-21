use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

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
        .invoke_handler(tauri::generate_handler![open_devtools, close_devtools])
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
