// macOS 저장 패널.
// Tauri dialog 플러그인(rfd)은 NSSavePanel 의 extensionHidden 을 건드리지 않는데,
// macOS 기본값이 "확장자 숨김" 이라 이름칸에 확장자가 보이지 않는다(파일엔 붙음).
// 사용자가 무엇으로 저장되는지 알 수 있도록 확장자를 항상 보이게 한 패널을 직접 띄운다.

/// 저장 패널을 띄우고 선택한 경로를 돌려준다. 취소하면 None.
#[tauri::command]
pub async fn mac_save_dialog(
  app: tauri::AppHandle,
  default_name: String,
  extensions: Vec<String>,
) -> Result<Option<String>, String> {
  #[cfg(not(target_os = "macos"))]
  {
    let _ = (app, default_name, extensions);
    Err("macOS 에서만 지원합니다".into())
  }
  #[cfg(target_os = "macos")]
  {
    let (tx, rx) = std::sync::mpsc::channel();
    app
      .run_on_main_thread(move || {
        let _ = tx.send(show_save_panel(&default_name, &extensions));
      })
      .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || rx.recv().map_err(|e| e.to_string()))
      .await
      .map_err(|e| e.to_string())?
  }
}

#[cfg(target_os = "macos")]
fn show_save_panel(default_name: &str, extensions: &[String]) -> Option<String> {
  use objc2::MainThreadMarker;
  use objc2_app_kit::{NSModalResponseOK, NSSavePanel};
  use objc2_foundation::{NSArray, NSString};

  let mtm = MainThreadMarker::new().expect("save panel must run on the main thread");
  {
    let panel = NSSavePanel::savePanel(mtm);
    // 핵심: 확장자 숨김 해제 + 사용자가 토글할 수 있는 체크박스 노출
    panel.setCanSelectHiddenExtension(true);
    panel.setExtensionHidden(false);
    panel.setCanCreateDirectories(true);
    if !extensions.is_empty() {
      let types: Vec<_> = extensions.iter().map(|e| NSString::from_str(e)).collect();
      #[allow(deprecated)]
      panel.setAllowedFileTypes(Some(&NSArray::from_retained_slice(&types)));
    }
    panel.setNameFieldStringValue(&NSString::from_str(default_name));
    if panel.runModal() != NSModalResponseOK {
      return None;
    }
    panel.URL().and_then(|u| u.path()).map(|p| p.to_string())
  }
}
