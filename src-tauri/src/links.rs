use std::path::{Path, PathBuf};
use tauri_plugin_opener::OpenerExt;

/// Resolve only absolute paths for this OS. Metadata failures distinguish missing files and permissions.
fn local_path(path: &str, reveal: bool) -> Result<PathBuf, String> {
    if path.is_empty()
        || path.chars().any(char::is_control)
        || path.starts_with("//")
        || path.starts_with("\\\\")
        || !Path::new(path).is_absolute()
    {
        return Err("This is not an absolute path on this device. The file may be on the office machine.".into());
    }
    let metadata = std::fs::metadata(path).map_err(|err| match err.kind() {
        std::io::ErrorKind::NotFound => "File not found on this device. It may only exist on the office machine.".to_string(),
        std::io::ErrorKind::PermissionDenied => "Permission denied. This device cannot access that file.".to_string(),
        _ => format!("Could not access this path on this device: {err}"),
    })?;
    if !reveal && !metadata.is_file() {
        return Err("This path is not a regular file. Use Show in file manager for a directory.".into());
    }
    Path::new(path).canonicalize().map_err(|err| format!("Could not resolve this path on this device: {err}"))
}

/// User-initiated file action; arbitrary custom URL schemes never reach the native opener.
#[tauri::command]
pub async fn open_local_path(app: tauri::AppHandle, path: String, reveal: bool) -> Result<(), String> {
    let path = local_path(&path, reveal)?;
    if reveal {
        app.opener().reveal_item_in_dir(path).map_err(|err| format!("Could not show this path in the file manager: {err}"))
    } else {
        app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|err| format!("Could not open this file on this device: {err}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn only_existing_local_regular_files_open_but_directories_can_be_revealed() {
        let dir = std::env::temp_dir().join(format!("mob-links-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("build 空格.log");
        fs::write(&file, "test log").unwrap();
        assert_eq!(local_path(file.to_str().unwrap(), false).unwrap(), file.canonicalize().unwrap());
        assert!(local_path(dir.to_str().unwrap(), true).is_ok());
        assert!(local_path(dir.to_str().unwrap(), false).unwrap_err().contains("not a regular file"));
        assert!(local_path(dir.join("missing.log").to_str().unwrap(), false).unwrap_err().contains("not found on this device"));
        assert!(local_path("relative/log", false).is_err());
        assert!(local_path("/tmp/log\n", true).is_err());
        #[cfg(not(target_os = "windows"))]
        assert!(local_path("C:\\Users\\log.txt", false).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
