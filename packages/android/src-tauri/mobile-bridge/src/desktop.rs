use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::{error::Error, models::ScanResult};

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<MobileBridge<R>> {
    Ok(MobileBridge(std::marker::PhantomData))
}

pub struct MobileBridge<R: Runtime>(pub std::marker::PhantomData<fn() -> R>);

impl<R: Runtime> MobileBridge<R> {
    pub fn is_whisper_ready(&self) -> crate::Result<serde_json::Value> {
        Err(Error::Message(
            "Mobile bridge is unavailable on this platform".to_string(),
        ))
    }

    pub fn start_recording(&self) -> crate::Result<serde_json::Value> {
        Err(Error::Message(
            "Mobile bridge is unavailable on this platform".to_string(),
        ))
    }

    pub fn stop_recording(&self) -> crate::Result<serde_json::Value> {
        Err(Error::Message(
            "Mobile bridge is unavailable on this platform".to_string(),
        ))
    }

    pub fn scan_network(&self) -> crate::Result<Vec<ScanResult>> {
        Err(Error::Message(
            "Mobile bridge is unavailable on this platform".to_string(),
        ))
    }

    pub fn cancel_scan(&self) -> crate::Result<()> {
        Err(Error::Message(
            "Mobile bridge is unavailable on this platform".to_string(),
        ))
    }

    pub fn share(&self, _text: Option<String>, _url: Option<String>) -> crate::Result<bool> {
        Err(Error::Message(
            "Mobile bridge is unavailable on this platform".to_string(),
        ))
    }
}
