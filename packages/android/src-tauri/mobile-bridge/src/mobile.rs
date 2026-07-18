use serde::{de::DeserializeOwned, Serialize};
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::ScanResult;

const PLUGIN_IDENTIFIER: &str = "ai.opencode.mobilebridge";

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<MobileBridge<R>> {
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "MobileBridgePlugin")?;
    Ok(MobileBridge(handle))
}

pub struct MobileBridge<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> MobileBridge<R> {
    pub fn scan_network(&self) -> crate::Result<Vec<ScanResult>> {
        self.0
            .run_mobile_plugin("scanNetwork", ())
            .map_err(Into::into)
    }

    pub fn cancel_scan(&self) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("cancelScan", ())
            .map_err(Into::into)
    }

    pub fn share(&self, text: Option<String>, url: Option<String>) -> crate::Result<bool> {
        self.0
            .run_mobile_plugin("share", SharePayload { text, url })
            .map_err(Into::into)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SharePayload {
    text: Option<String>,
    url: Option<String>,
}
