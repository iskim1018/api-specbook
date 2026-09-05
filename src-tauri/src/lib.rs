use tauri::{Emitter, Manager};

mod mac_dialog;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![mac_dialog::mac_save_dialog])
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .setup(|app| {
      #[cfg(desktop)]
      {
        app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
        app.handle().plugin(tauri_plugin_process::init())?;
      }
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      #[cfg(target_os = "macos")]
      setup_macos_menu(app)?;
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while running tauri application")
    .run(|app, event| {
      // 창이 살아 있는데 종료 요청(code 없음)이 오면 보류하고 프론트엔드에 미저장 확인을 맡긴다.
      // 프론트엔드가 확인 후 exit(0) 로 다시 요청하면 code 가 Some 이므로 통과한다.
      // 마지막 창이 이미 닫혀 창이 없으면 그대로 종료한다.
      if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
        if code.is_none() && !app.webview_windows().is_empty() {
          api.prevent_exit();
          let _ = app.emit("app-quit-requested", ());
        }
      }
    });
}

// macOS 기본 메뉴의 '종료'(Cmd+Q) 는 NSApp terminate: 로 바로 프로세스를 끝내 버려
// ExitRequested 를 거치지 않는다. 종료 항목만 우리 것으로 바꿔 이벤트를 보내고,
// 실제 종료는 프론트엔드가 미저장 확인을 마친 뒤 exit() 로 한다.
// 편집 메뉴는 웹뷰에서 Cmd+C/V/Z 등이 동작하도록 그대로 둔다.
#[cfg(target_os = "macos")]
fn setup_macos_menu(app: &mut tauri::App) -> tauri::Result<()> {
  use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder};

  let quit = MenuItemBuilder::with_id("quit", "API Specbook 종료")
    .accelerator("CmdOrCtrl+Q")
    .build(app)?;
  let check_update = MenuItemBuilder::with_id("check-update", "업데이트 확인…").build(app)?;
  let app_menu = SubmenuBuilder::new(app, "API Specbook")
    .about(Some(AboutMetadata::default()))
    .item(&check_update)
    .separator()
    .services()
    .separator()
    .hide()
    .hide_others()
    .show_all()
    .separator()
    .item(&quit)
    .build()?;
  let edit_menu = SubmenuBuilder::new(app, "편집")
    .undo()
    .redo()
    .separator()
    .cut()
    .copy()
    .paste()
    .select_all()
    .build()?;
  // macOS 는 메뉴 단축키가 웹뷰보다 먼저 키를 가져가므로, 패널 토글도 메뉴 항목으로 둔다.
  // (Windows/Linux 는 메뉴 없이 main.js 의 keydown 이 처리한다)
  let toggle_tree = MenuItemBuilder::with_id("toggle-tree", "탐색기 토글")
    .accelerator("CmdOrCtrl+B")
    .build(app)?;
  let toggle_editor = MenuItemBuilder::with_id("toggle-editor", "에디터 토글")
    .accelerator("CmdOrCtrl+Shift+E")
    .build(app)?;
  let toggle_viewer = MenuItemBuilder::with_id("toggle-viewer", "미리보기 토글")
    .accelerator("CmdOrCtrl+Shift+V")
    .build(app)?;
  let view_menu = SubmenuBuilder::new(app, "보기")
    .item(&toggle_tree)
    .item(&toggle_editor)
    .item(&toggle_viewer)
    .build()?;
  // 기본 '창 닫기'(Cmd+W) 는 창을 닫아 앱이 종료되므로, Cmd+W 는 '탭 닫기' 로 쓴다.
  let close_tab = MenuItemBuilder::with_id("close-tab", "탭 닫기")
    .accelerator("CmdOrCtrl+W")
    .build(app)?;
  let window_menu = SubmenuBuilder::new(app, "윈도우")
    .minimize()
    .maximize()
    .separator()
    .item(&close_tab)
    .build()?;
  let menu = MenuBuilder::new(app)
    .items(&[&app_menu, &edit_menu, &view_menu, &window_menu])
    .build()?;
  app.set_menu(menu)?;
  app.on_menu_event(|app, event| {
    match event.id().as_ref() {
      "quit" => { let _ = app.emit("app-quit-requested", ()); }
      "close-tab" => { let _ = app.emit("app-close-tab-requested", ()); }
      "check-update" => { let _ = app.emit("app-check-update", ()); }
      "toggle-tree" => { let _ = app.emit("app-toggle-panel", "tree"); }
      "toggle-editor" => { let _ = app.emit("app-toggle-panel", "editor"); }
      "toggle-viewer" => { let _ = app.emit("app-toggle-panel", "viewer"); }
      _ => {}
    }
  });
  Ok(())
}
