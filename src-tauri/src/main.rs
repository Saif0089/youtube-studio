// InfotainmentStu Studio — Tauri v2 desktop app.
// Wraps the existing local pipeline: generate (script->voice->images->render) and upload.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};

fn project_root() -> PathBuf {
    // src-tauri/ is CARGO_MANIFEST_DIR; the project root (with src/, .env, out/) is its parent.
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf()
}

fn stream_stderr(app: &AppHandle, child: &mut std::process::Child) {
    if let Some(err) = child.stderr.take() {
        let a = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(err).lines().flatten() {
                let _ = a.emit("progress", line);
            }
        });
    }
}

fn run_pipeline(app: AppHandle, words: String, voice: String, image_provider: String) -> Result<(), String> {
    // run via a login shell so the user's PATH (node/npx) is available even when launched from Finder
    let cmd = format!(
        "cd \"{}\" && VOICE_PROVIDER=edge SCRIPT_WORDS={} EDGE_VOICE={} IMAGE_PROVIDER={} npx tsx src/scripts/make-video.ts",
        project_root().display(), words, voice, image_provider
    );
    let mut child = Command::new("/bin/zsh")
        .args(["-lc", &cmd])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start shell: {e}"))?;
    stream_stderr(&app, &mut child);
    if let Some(out) = child.stdout.take() {
        for line in BufReader::new(out).lines().flatten() {
            let _ = app.emit("progress", line);
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    if status.success() { Ok(()) } else { Err(format!("generation failed (exit {:?})", status.code())) }
}

fn run_publish(app: AppHandle) -> Result<String, String> {
    let cmd = format!(
        "cd \"{}\" && PUBLISH_MODE=approval npx tsx src/scripts/publish.ts",
        project_root().display()
    );
    let mut child = Command::new("/bin/zsh")
        .args(["-lc", &cmd])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start shell: {e}"))?;
    stream_stderr(&app, &mut child);
    let mut url = String::new();
    if let Some(out) = child.stdout.take() {
        for line in BufReader::new(out).lines().flatten() {
            if let Some(i) = line.find("https://studio.youtube.com") {
                url = line[i..].split_whitespace().next().unwrap_or("").to_string();
            }
            let _ = app.emit("progress", line);
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() { return Err(format!("upload failed (exit {:?})", status.code())); }
    if url.is_empty() { Err("uploaded, but couldn't find the review link".into()) } else { Ok(url) }
}

#[tauri::command]
async fn generate(app: AppHandle, words: String, voice: String, image_provider: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || run_pipeline(app, words, voice, image_provider))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn upload(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || run_publish(app))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn open_preview() -> Result<(), String> {
    let path = project_root().join("out/story.mp4");
    if !path.exists() {
        return Err("no video yet — generate one first".into());
    }
    Command::new("open").arg(path).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    Command::new("open").arg(url).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![generate, upload, open_preview, open_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
