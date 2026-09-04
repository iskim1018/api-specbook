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
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while running tauri application")
    .run(|app, event| {
      // macOS Cmd+Q / 앱 메뉴 '종료' 는 창 close-requested 를 거치지 않고 바로 종료 요청이 온다.
      // 창이 아직 살아 있으면 종료를 보류하고 프론트엔드에 맡겨 미저장 확인을 거치게 한다.
      // (code 가 Some 이면 프론트엔드가 확인 후 exit() 로 다시 요청한 것이므로 통과)
      // 마지막 창이 이미 닫혀 창이 없으면 그대로 종료한다.
      if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
        if code.is_none() && !app.webview_windows().is_empty() {
          api.prevent_exit();
          let _ = app.emit("app-quit-requested", ());
        }
      }
    });
}
