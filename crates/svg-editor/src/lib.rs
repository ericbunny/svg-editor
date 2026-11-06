use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::{Deserialize, Serialize};
use std::{fs, io::BufWriter, path::Path};
use thiserror::Error;
use uuid::Uuid;

const SVG_DPI: f32 = 96.0;
const BUNDLED_FONT: &[u8] =
    include_bytes!("../assets/fonts/NotoSansSC-Variable.ttf");
const BUNDLED_FONT_FAMILY: &str = "Noto Sans SC";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageFormat {
    Png,
    Jpeg,
    Webp,
}

impl ImageFormat {
    pub fn parse(value: &str) -> Option<Self> {
        match value.to_ascii_lowercase().as_str() {
            "png" => Some(Self::Png),
            "jpg" | "jpeg" => Some(Self::Jpeg),
            "webp" => Some(Self::Webp),
            _ => None,
        }
    }
}

#[derive(Debug, Error)]
pub enum ImageExportError {
    #[error("DPI must be a finite number greater than zero")]
    InvalidDpi,
    #[error("SVG content is invalid: {0}")]
    InvalidSvg(String),
    #[error("output image dimensions are invalid or too large")]
    InvalidDimensions,
    #[error("failed to encode image: {0}")]
    Encode(#[from] image::ImageError),
    #[error("failed to encode PNG image: {0}")]
    EncodePng(#[from] png::EncodingError),
    #[error("failed to write image: {0}")]
    Write(#[source] std::io::Error),
}

pub fn export_svg_image(
    svg: &str,
    path: impl AsRef<Path>,
    format: ImageFormat,
    dpi: f32,
) -> Result<(u32, u32), ImageExportError> {
    if !dpi.is_finite() || dpi <= 0.0 {
        return Err(ImageExportError::InvalidDpi);
    }

    let mut options = resvg::usvg::Options::default();
    options.fontdb_mut().load_system_fonts();
    options
        .fontdb_mut()
        .load_font_data(BUNDLED_FONT.to_vec());
    options
        .fontdb_mut()
        .set_sans_serif_family(BUNDLED_FONT_FAMILY);
    options.font_family = BUNDLED_FONT_FAMILY.to_owned();
    let tree = resvg::usvg::Tree::from_str(svg, &options)
        .map_err(|error| ImageExportError::InvalidSvg(error.to_string()))?;
    let size = tree.size();
    let scale = dpi / SVG_DPI;
    let width = scaled_dimension(size.width(), scale)?;
    let height = scaled_dimension(size.height(), scale)?;
    let mut pixmap =
        resvg::tiny_skia::Pixmap::new(width, height).ok_or(ImageExportError::InvalidDimensions)?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );

    let mut rgba = unpremultiply_rgba(pixmap.data());
    if format == ImageFormat::Jpeg {
        flatten_transparency(&mut rgba);
    }
    match format {
        ImageFormat::Png => encode_png(path.as_ref(), width, height, &rgba, dpi)?,
        ImageFormat::Jpeg => encode_jpeg(path.as_ref(), width, height, &rgba, dpi)?,
        ImageFormat::Webp => {
            let image = image::RgbaImage::from_raw(width, height, rgba)
                .ok_or(ImageExportError::InvalidDimensions)?;
            image
                .save_with_format(path, image::ImageFormat::WebP)
                .map_err(map_image_error)?;
        }
    }
    Ok((width, height))
}

fn encode_png(
    path: &Path,
    width: u32,
    height: u32,
    rgba: &[u8],
    dpi: f32,
) -> Result<(), ImageExportError> {
    let file = fs::File::create(path).map_err(ImageExportError::Write)?;
    let mut encoder = png::Encoder::new(BufWriter::new(file), width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let pixels_per_meter = (dpi / 0.0254).round();
    if !pixels_per_meter.is_finite() || pixels_per_meter < 1.0 || pixels_per_meter > u32::MAX as f32
    {
        return Err(ImageExportError::InvalidDpi);
    }
    encoder.set_pixel_dims(Some(png::PixelDimensions {
        xppu: pixels_per_meter as u32,
        yppu: pixels_per_meter as u32,
        unit: png::Unit::Meter,
    }));
    encoder.write_header()?.write_image_data(rgba)?;
    Ok(())
}

fn encode_jpeg(
    path: &Path,
    width: u32,
    height: u32,
    rgba: &[u8],
    dpi: f32,
) -> Result<(), ImageExportError> {
    let density = dpi.round();
    if density < 1.0 || density > u16::MAX as f32 {
        return Err(ImageExportError::InvalidDpi);
    }
    let rgb: Vec<u8> = rgba
        .chunks_exact(4)
        .flat_map(|pixel| pixel[..3].iter().copied())
        .collect();
    let file = fs::File::create(path).map_err(ImageExportError::Write)?;
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(BufWriter::new(file), 90);
    encoder.set_pixel_density(image::codecs::jpeg::PixelDensity::dpi(density as u16));
    encoder
        .encode(&rgb, width, height, image::ExtendedColorType::Rgb8)
        .map_err(map_image_error)
}

fn map_image_error(error: image::ImageError) -> ImageExportError {
    match error {
        image::ImageError::IoError(error) => ImageExportError::Write(error),
        other => ImageExportError::Encode(other),
    }
}

fn scaled_dimension(value: f32, scale: f32) -> Result<u32, ImageExportError> {
    let scaled = (value * scale).round();
    if !scaled.is_finite() || scaled < 1.0 || scaled > u32::MAX as f32 {
        return Err(ImageExportError::InvalidDimensions);
    }
    Ok(scaled as u32)
}

fn unpremultiply_rgba(data: &[u8]) -> Vec<u8> {
    let mut output = data.to_vec();
    for pixel in output.chunks_exact_mut(4) {
        let alpha = pixel[3] as u16;
        if alpha > 0 && alpha < 255 {
            for channel in &mut pixel[..3] {
                *channel = ((*channel as u16 * 255 + alpha / 2) / alpha).min(255) as u8;
            }
        }
    }
    output
}

fn flatten_transparency(data: &mut [u8]) {
    for pixel in data.chunks_exact_mut(4) {
        let alpha = pixel[3] as u16;
        for channel in &mut pixel[..3] {
            *channel = ((*channel as u16 * alpha + 255 * (255 - alpha) + 127) / 255) as u8;
        }
        pixel[3] = 255;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Document {
    pub version: u32,
    pub name: String,
    pub width: f64,
    pub height: f64,
    pub background: String,
    pub shapes: Vec<Shape>,
    #[serde(default)]
    pub connections: Vec<Connection>,
}

impl Default for Document {
    fn default() -> Self {
        Self {
            version: 1,
            name: "未命名绘图".into(),
            width: 1280.0,
            height: 720.0,
            background: "#ffffff".into(),
            shapes: Vec::new(),
            connections: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: Uuid,
    pub from_id: Uuid,
    pub to_id: Uuid,
    pub stroke: String,
    pub stroke_width: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Shape {
    pub id: Uuid,
    pub kind: ShapeKind,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub rotation: f64,
    pub fill: String,
    pub stroke: String,
    pub stroke_width: f64,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub svg_content: Option<String>,
}

impl Shape {
    pub fn new(kind: ShapeKind, x: f64, y: f64) -> Self {
        Self {
            id: Uuid::new_v4(),
            kind,
            x,
            y,
            width: 140.0,
            height: 80.0,
            rotation: 0.0,
            fill: "#dbeafe".into(),
            stroke: "#2563eb".into(),
            stroke_width: 2.0,
            text: String::new(),
            svg_content: None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ShapeKind {
    Rectangle,
    Ellipse,
    Diamond,
    ImportedSvg,
}

#[derive(Debug, Error)]
pub enum DocumentError {
    #[error("读取文件失败: {0}")]
    Read(#[source] std::io::Error),
    #[error("写入文件失败: {0}")]
    Write(#[source] std::io::Error),
    #[error("工程文件格式无效: {0}")]
    Json(#[from] serde_json::Error),
    #[error("不支持的工程文件版本: {0}")]
    UnsupportedVersion(u32),
}

pub fn load_document(path: impl AsRef<Path>) -> Result<Document, DocumentError> {
    let content = fs::read_to_string(path).map_err(DocumentError::Read)?;
    let document: Document = serde_json::from_str(&content)?;
    if document.version != 1 {
        return Err(DocumentError::UnsupportedVersion(document.version));
    }
    Ok(document)
}

pub fn save_document(path: impl AsRef<Path>, document: &Document) -> Result<(), DocumentError> {
    let content = serde_json::to_string_pretty(document)?;
    fs::write(path, content).map_err(DocumentError::Write)
}

pub fn export_svg(document: &Document) -> String {
    let mut output = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{}" height="{}" viewBox="0 0 {} {}">\n<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker></defs>\n<rect width="100%" height="100%" fill="{}"/>\n"##,
        number(document.width),
        number(document.height),
        number(document.width),
        number(document.height),
        escape_xml(&document.background)
    );

    for connection in &document.connections {
        let Some(from) = document
            .shapes
            .iter()
            .find(|shape| shape.id == connection.from_id)
        else {
            continue;
        };
        let Some(to) = document
            .shapes
            .iter()
            .find(|shape| shape.id == connection.to_id)
        else {
            continue;
        };
        let ((x1, y1), (x2, y2)) = connection_points(from, to);
        output.push_str(&format!(
            r#"<line x1="{}" y1="{}" x2="{}" y2="{}" fill="none" stroke="{}" stroke-width="{}" marker-end="url(#arrow)"/>\n"#,
            number(x1), number(y1), number(x2), number(y2), escape_xml(&connection.stroke), number(connection.stroke_width)
        ));
    }

    for shape in &document.shapes {
        let transform = format!(
            "rotate({} {} {})",
            number(shape.rotation),
            number(shape.x + shape.width / 2.0),
            number(shape.y + shape.height / 2.0)
        );
        let style = format!(
            r#"fill="{}" stroke="{}" stroke-width="{}""#,
            escape_xml(&shape.fill),
            escape_xml(&shape.stroke),
            number(shape.stroke_width)
        );
        match shape.kind {
            ShapeKind::Rectangle => output.push_str(&format!(
                r#"<rect x="{}" y="{}" width="{}" height="{}" rx="8" {} transform="{}"/>\n"#,
                number(shape.x),
                number(shape.y),
                number(shape.width),
                number(shape.height),
                style,
                transform
            )),
            ShapeKind::Ellipse => output.push_str(&format!(
                r#"<ellipse cx="{}" cy="{}" rx="{}" ry="{}" {} transform="{}"/>\n"#,
                number(shape.x + shape.width / 2.0),
                number(shape.y + shape.height / 2.0),
                number(shape.width / 2.0),
                number(shape.height / 2.0),
                style,
                transform
            )),
            ShapeKind::Diamond => {
                let points = format!(
                    "{},{} {},{} {},{} {},{}",
                    number(shape.x + shape.width / 2.0),
                    number(shape.y),
                    number(shape.x + shape.width),
                    number(shape.y + shape.height / 2.0),
                    number(shape.x + shape.width / 2.0),
                    number(shape.y + shape.height),
                    number(shape.x),
                    number(shape.y + shape.height / 2.0)
                );
                output.push_str(&format!(
                    r#"<polygon points="{}" {} transform="{}"/>\n"#,
                    points, style, transform
                ));
            }
            ShapeKind::ImportedSvg => {
                if let Some(content) = &shape.svg_content {
                    output.push_str(&format!(
                        r#"<image x="{}" y="{}" width="{}" height="{}" preserveAspectRatio="xMidYMid meet" href="data:image/svg+xml;base64,{}" transform="{}"/>\n"#,
                        number(shape.x),
                        number(shape.y),
                        number(shape.width),
                        number(shape.height),
                        BASE64.encode(content.as_bytes()),
                        transform
                    ));
                }
            }
        }
        if !shape.text.is_empty() {
            output.push_str(&format!(
                r##"<text x="{}" y="{}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="16" fill="#172033" transform="{}">{}</text>\n"##,
                number(shape.x + shape.width / 2.0), number(shape.y + shape.height / 2.0), transform,
                escape_xml(&shape.text)
            ));
        }
    }
    output.push_str("</svg>\n");
    output
}

fn connection_points(from: &Shape, to: &Shape) -> ((f64, f64), (f64, f64)) {
    let from_center = (from.x + from.width / 2.0, from.y + from.height / 2.0);
    let to_center = (to.x + to.width / 2.0, to.y + to.height / 2.0);
    (
        boundary_point(
            from,
            to_center.0 - from_center.0,
            to_center.1 - from_center.1,
        ),
        boundary_point(to, from_center.0 - to_center.0, from_center.1 - to_center.1),
    )
}

fn boundary_point(shape: &Shape, dx: f64, dy: f64) -> (f64, f64) {
    let center = (shape.x + shape.width / 2.0, shape.y + shape.height / 2.0);
    if dx.abs() < f64::EPSILON && dy.abs() < f64::EPSILON {
        return center;
    }
    let scale = (shape.width / 2.0 / dx.abs().max(f64::EPSILON))
        .min(shape.height / 2.0 / dy.abs().max(f64::EPSILON));
    (center.0 + dx * scale, center.1 + dy * scale)
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn number(value: f64) -> String {
    let result = format!("{value:.3}");
    result
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_round_trips_as_json() {
        let mut document = Document::default();
        document
            .shapes
            .push(Shape::new(ShapeKind::Rectangle, 10.0, 20.0));
        let json = serde_json::to_string(&document).unwrap();
        let decoded: Document = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded, document);
    }

    #[test]
    fn svg_export_escapes_text_and_contains_shapes() {
        let mut document = Document::default();
        let mut shape = Shape::new(ShapeKind::Diamond, 10.0, 20.0);
        shape.text = "A < B & C".into();
        document.shapes.push(shape);
        let svg = export_svg(&document);
        assert!(svg.contains("<polygon"));
        assert!(svg.contains("A &lt; B &amp; C"));
    }

    #[test]
    fn imported_svg_round_trips_and_exports_as_embedded_image() {
        let mut document = Document::default();
        let mut shape = Shape::new(ShapeKind::ImportedSvg, 10.0, 20.0);
        shape.svg_content =
            Some(r#"<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L10 10"/></svg>"#.into());
        document.shapes.push(shape);

        let json = serde_json::to_string(&document).unwrap();
        let decoded: Document = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded, document);
        assert!(export_svg(&document).contains("data:image/svg+xml;base64,"));
    }

    #[test]
    fn connection_round_trips_and_exports_with_arrow() {
        let mut document = Document::default();
        let from = Shape::new(ShapeKind::Rectangle, 10.0, 20.0);
        let to = Shape::new(ShapeKind::Ellipse, 300.0, 220.0);
        document.connections.push(Connection {
            id: Uuid::new_v4(),
            from_id: from.id,
            to_id: to.id,
            stroke: "#334155".into(),
            stroke_width: 2.0,
        });
        document.shapes.extend([from, to]);

        let json = serde_json::to_string(&document).unwrap();
        let decoded: Document = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded, document);
        let svg = export_svg(&document);
        assert!(svg.contains("marker-end=\"url(#arrow)\""));
        assert!(svg.contains("<line"));
    }

    #[test]
    fn raster_export_scales_with_dpi_and_encodes_supported_formats() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="5"><rect width="10" height="5" fill="#f00"/></svg>"##;
        let cases = [
            (ImageFormat::Png, "png"),
            (ImageFormat::Jpeg, "jpg"),
            (ImageFormat::Webp, "webp"),
        ];

        for (format, extension) in cases {
            let path =
                std::env::temp_dir().join(format!("svg-editor-{}.{}", Uuid::new_v4(), extension));
            let dimensions = export_svg_image(svg, &path, format, 192.0).unwrap();
            assert_eq!(dimensions, (20, 10));
            assert_eq!(image::image_dimensions(&path).unwrap(), dimensions);
            fs::remove_file(path).unwrap();
        }
    }

    #[test]
    fn raster_export_rejects_invalid_dpi() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="5"/>"#;
        let path = std::env::temp_dir().join(format!("svg-editor-{}.png", Uuid::new_v4()));
        assert!(matches!(
            export_svg_image(svg, path, ImageFormat::Png, 0.0),
            Err(ImageExportError::InvalidDpi)
        ));
    }

    #[test]
    fn png_export_writes_requested_dpi_metadata() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="5"/>"#;
        let path = std::env::temp_dir().join(format!("svg-editor-{}.png", Uuid::new_v4()));

        export_svg_image(svg, &path, ImageFormat::Png, 200.0).unwrap();
        let reader = png::Decoder::new(std::io::BufReader::new(fs::File::open(&path).unwrap()))
            .read_info()
            .unwrap();
        let dimensions = reader.info().pixel_dims.unwrap();
        fs::remove_file(path).unwrap();

        assert_eq!(dimensions.unit, png::Unit::Meter);
        assert!((dimensions.xppu as f32 * 0.0254 - 200.0).abs() < 0.1);
        assert_eq!(dimensions.xppu, dimensions.yppu);
    }

    #[test]
    fn raster_export_renders_text() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40"><text x="4" y="28" font-family="sans-serif" font-size="24">导出文字</text></svg>"#;
        let path = std::env::temp_dir().join(format!("svg-editor-{}.png", Uuid::new_v4()));

        export_svg_image(svg, &path, ImageFormat::Png, 96.0).unwrap();
        let image = image::open(&path).unwrap().into_rgba8();
        fs::remove_file(path).unwrap();

        assert!(image.pixels().any(|pixel| pixel[3] != 0));
    }
}
