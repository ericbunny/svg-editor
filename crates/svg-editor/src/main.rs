#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

#[tauri::command]
fn write_svg(path: String, content: String) -> Result<(), String> {
    std::fs::write(path, content).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_svg(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn export_image(
    path: String,
    content: String,
    format: String,
    dpi: f32,
) -> Result<[u32; 2], String> {
    let format = svg_editor::ImageFormat::parse(&format)
        .ok_or_else(|| format!("unsupported image format: {format}"))?;
    let (width, height) = svg_editor::export_svg_image(&content, path, format, dpi)
        .map_err(|error| error.to_string())?;
    Ok([width, height])
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_svg, write_svg, export_image])
        .run(tauri::generate_context!())
        .expect("failed to run SVG editor");
}
