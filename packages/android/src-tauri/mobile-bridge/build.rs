const COMMANDS: &[&str] = &[
    "register_listener",
    "remove_listener",
    "scan_network",
    "cancel_scan",
    "share",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .try_build()
        .unwrap();
}
