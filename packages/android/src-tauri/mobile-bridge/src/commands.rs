use tauri::{command, AppHandle, Runtime};

use crate::{MobileBridgeExt, Result};

#[command]
pub(crate) async fn is_whisper_ready<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value> {
    app.mobile_bridge().is_whisper_ready()
}

#[command]
pub(crate) async fn start_recording<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value> {
    app.mobile_bridge().start_recording()
}

#[command]
pub(crate) async fn stop_recording<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value> {
    app.mobile_bridge().stop_recording()
}

#[command]
pub(crate) async fn scan_network<R: Runtime>(app: AppHandle<R>) -> Result<Vec<crate::ScanResult>> {
    app.mobile_bridge().scan_network()
}

#[command]
pub(crate) async fn cancel_scan<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.mobile_bridge().cancel_scan()
}

#[command]
pub(crate) async fn share<R: Runtime>(
    app: AppHandle<R>,
    text: Option<String>,
    url: Option<String>,
) -> Result<bool> {
    app.mobile_bridge().share(text, url)
}
