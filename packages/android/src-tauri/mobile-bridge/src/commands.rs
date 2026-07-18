use tauri::{command, AppHandle, Runtime};

use crate::{MobileBridgeExt, Result};

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
