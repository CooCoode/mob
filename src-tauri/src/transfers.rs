use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

const CHUNK: usize = 4 * 1024 * 1024;

fn valid_id(id: &str) -> bool {
    (32..=36).contains(&id.len()) && id.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-')
}

fn path(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("Invalid transfer ID".into());
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("transfers");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    Ok(dir.join(id))
}

fn digest(file: &Path) -> std::io::Result<String> {
    let mut file = File::open(file)?;
    let mut hash = Sha256::new();
    let mut buf = vec![0; 256 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

#[derive(Serialize)]
pub struct ImportedFile {
    id: String,
    name: String,
    size: u64,
    sha256: String,
}

#[tauri::command]
pub async fn transfer_import(app: tauri::AppHandle) -> Result<Option<ImportedFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(selected) = app
            .dialog()
            .file()
            .set_title("Upload a file")
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let source = selected.into_path().map_err(|e| e.to_string())?;
        let before = fs::metadata(&source).map_err(|e| e.to_string())?;
        if !before.is_file() || before.len() > 20 * 1024 * 1024 * 1024 {
            return Err("Choose a regular file up to 20 GiB".into());
        }
        let id: String = rand::random::<[u8; 16]>()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        let dest = path(&app, &id)?;
        let result = (|| {
            fs::copy(&source, &dest).map_err(|e| e.to_string())?;
            let after = fs::metadata(&source).map_err(|e| e.to_string())?;
            if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
                return Err("File changed while preparing the upload; select it again".into());
            }
            let sha256 = digest(&dest).map_err(|e| e.to_string())?;
            Ok(Some(ImportedFile {
                id,
                name: source
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into(),
                size: before.len(),
                sha256,
            }))
        })();
        if result.is_err() {
            let _ = fs::remove_file(dest);
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn transfer_read(
    app: tauri::AppHandle,
    id: String,
    offset: u64,
    length: usize,
) -> Result<tauri::ipc::Response, String> {
    if length > CHUNK {
        return Err("Chunk too large".into());
    }
    let mut file = File::open(path(&app, &id)?).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| e.to_string())?;
    let mut data = vec![0; length];
    file.read_exact(&mut data).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(data))
}

#[tauri::command]
pub async fn transfer_size(app: tauri::AppHandle, id: String) -> Result<u64, String> {
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path(&app, &id)?)
        .map_err(|e| e.to_string())?;
    file.metadata().map(|m| m.len()).map_err(|e| e.to_string())
}

fn append(path: &Path, offset: u64, data: &[u8]) -> Result<(), String> {
    if data.len() > CHUNK {
        return Err("Chunk too large".into());
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() != offset {
        return Err("Local download offset changed".into());
    }
    file.write_all(data)
        .and_then(|_| file.sync_data())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn transfer_append(
    app: tauri::AppHandle,
    id: String,
    offset: u64,
    data: Vec<u8>,
) -> Result<(), String> {
    append(&path(&app, &id)?, offset, &data)
}

#[tauri::command]
pub async fn transfer_digest(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let file = path(&app, &id)?;
    tauri::async_runtime::spawn_blocking(move || digest(&file).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn transfer_discard(app: tauri::AppHandle, id: String) -> Result<(), String> {
    match fs::remove_file(path(&app, &id)?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn transfer_export(
    app: tauri::AppHandle,
    id: String,
    name: String,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = path(&app, &id)?;
        let Some(selected) = app
            .dialog()
            .file()
            .set_title("Save downloaded file")
            .set_file_name(&name)
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let dest = selected.into_path().map_err(|e| e.to_string())?;
        let temp = dest.with_file_name(format!(".mob-download-{id}.tmp"));
        let mut created = false;
        let result = (|| {
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)?;
            created = true;
            std::io::copy(&mut File::open(source)?, &mut output)?;
            output.sync_all()?;
            fs::rename(&temp, &dest)
        })();
        if result.is_err() && created {
            let _ = fs::remove_file(temp);
        }
        result.map(|_| true).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resumable_disk_writes_do_not_append_at_a_stale_offset() {
        let path =
            std::env::temp_dir().join(format!("mob-transfer-test-{}", rand::random::<u64>()));
        append(&path, 0, b"ab").unwrap();
        assert!(append(&path, 0, b"bad").is_err());
        append(&path, 2, b"c").unwrap();
        assert_eq!(
            digest(&path).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        fs::remove_file(path).unwrap();
        assert!(!valid_id("../settings.json"));
    }
}
