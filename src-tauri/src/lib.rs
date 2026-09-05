use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
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
  let app_menu = SubmenuBuilder::new(app, "API Specbook")
    .about(Some(AboutMetadata::default()))
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
  let window_menu = SubmenuBuilder::new(app, "윈도우")
    .minimize()
    .maximize()
    .separator()
    .close_window()
    .build()?;
  let menu = MenuBuilder::new(app)
    .items(&[&app_menu, &edit_menu, &window_menu])
    .build()?;
  app.set_menu(menu)?;
  app.on_menu_event(|app, event| {
    if event.id() == "quit" {
      let _ = app.emit("app-quit-requested", ());
    }
  });
  Ok(())
}
