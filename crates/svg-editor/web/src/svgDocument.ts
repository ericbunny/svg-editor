import { createImportedSvgParts, createImportedSvg, svgViewport } from "./svgImport";
import { emptyDocument, type DocumentModel, type Shape } from "./types";

const metadataId = "svg-editor-document";

export function parseSvgDocument(source: string): DocumentModel {
  const xml = new DOMParser().parseFromString(source, "image/svg+xml");
  const error = xml.querySelector("parsererror");
  if (error || xml.documentElement.localName !== "svg") {
    throw new Error(error?.textContent?.trim() || "文件不是有效的 SVG");
  }

  const metadata = xml.querySelector(`metadata#${metadataId}`);
  if (metadata?.textContent) {
    const document = JSON.parse(metadata.textContent) as DocumentModel;
    if (document.version !== 1 || !Array.isArray(document.shapes)) throw new Error("SVG 编辑元数据版本不受支持");
    return { ...document, connections: document.connections ?? [] };
  }

  const viewport = svgViewport(source);
  return { ...emptyDocument(), width: viewport.width, height: viewport.height, shapes: importShapes(source, viewport) };
}

/** 第三方 SVG 没有编辑元数据，按原始布局拆成可单独选择的图形元素。 */
function importShapes(source: string, viewport: { width: number; height: number }): Shape[] {
  try {
    return createImportedSvgParts(source, 0, "original");
  } catch {
    const imported = createImportedSvg(source, 0);
    return [{ ...imported, x: 0, y: 0, width: viewport.width, height: viewport.height }];
  }
}

export function serializeSvgDocument(document: DocumentModel): string {
  const xml = globalThis.document.implementation.createDocument("http://www.w3.org/2000/svg", "svg");
  const root = xml.documentElement;
  root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  root.setAttribute("width", number(document.width));
  root.setAttribute("height", number(document.height));
  root.setAttribute("viewBox", `0 0 ${number(document.width)} ${number(document.height)}`);

  const metadata = xml.createElementNS(root.namespaceURI, "metadata");
  metadata.setAttribute("id", metadataId);
  metadata.textContent = JSON.stringify(document);
  root.append(metadata);

  const defs = xml.createElementNS(root.namespaceURI, "defs");
  defs.innerHTML = '<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker>';
  root.append(defs);

  const background = xml.createElementNS(root.namespaceURI, "rect");
  setAttributes(background, { width: "100%", height: "100%", fill: document.background, "data-svg-editor-role": "background" });
  root.append(background);

  for (const connection of document.connections) {
    const from = document.shapes.find((shape) => shape.id === connection.fromId);
    const to = document.shapes.find((shape) => shape.id === connection.toId);
    if (!from || !to) continue;
    const [start, end] = connectionPoints(from, to);
    const line = xml.createElementNS(root.namespaceURI, "line");
    setAttributes(line, { id: connection.id, x1: number(start.x), y1: number(start.y), x2: number(end.x), y2: number(end.y), fill: "none", stroke: connection.stroke, "stroke-width": number(connection.strokeWidth), "marker-end": "url(#arrow)" });
    root.append(line);
  }

  for (const shape of document.shapes) {
    const transform = `rotate(${number(shape.rotation)} ${number(shape.x + shape.width / 2)} ${number(shape.y + shape.height / 2)})`;
    if (shape.kind === "importedSvg" && shape.svgContent) {
      const imported = new DOMParser().parseFromString(shape.svgContent, "image/svg+xml").documentElement;
      const nested = xml.importNode(imported, true);
      setAttributes(nested, { id: shape.id, x: number(shape.x), y: number(shape.y), width: number(shape.width), height: number(shape.height), transform, preserveAspectRatio: shape.stretch ? "none" : "xMidYMid meet" });
      root.append(nested);
      if (shape.showText && shape.text) appendLabel(shape, transform);
      continue;
    }
    if (shape.kind === "text") {
      appendLabel(shape, transform, number(Math.max(8, shape.height * 0.62)), shape.fill);
      continue;
    }
    const element = xml.createElementNS(root.namespaceURI, shape.kind === "rectangle" ? "rect" : shape.kind === "ellipse" ? "ellipse" : "polygon");
    const common = { id: shape.id, fill: shape.fill, stroke: shape.stroke, "stroke-width": number(shape.strokeWidth), transform };
    if (shape.kind === "rectangle") setAttributes(element, { ...common, x: number(shape.x), y: number(shape.y), width: number(shape.width), height: number(shape.height), rx: "8" });
    else if (shape.kind === "ellipse") setAttributes(element, { ...common, cx: number(shape.x + shape.width / 2), cy: number(shape.y + shape.height / 2), rx: number(shape.width / 2), ry: number(shape.height / 2) });
    else setAttributes(element, { ...common, points: `${number(shape.x + shape.width / 2)},${number(shape.y)} ${number(shape.x + shape.width)},${number(shape.y + shape.height / 2)} ${number(shape.x + shape.width / 2)},${number(shape.y + shape.height)} ${number(shape.x)},${number(shape.y + shape.height / 2)}` });
    root.append(element);
    if (shape.text) appendLabel(shape, transform);
  }

  /** 形状内的居中文字；文字元素本身直接复用 shape 的 id。 */
  function appendLabel(shape: Shape, transform: string, fontSize?: string, fill?: string) {
    const text = xml.createElementNS(root.namespaceURI, "text");
    const attributes: Record<string, string> = {
      id: fontSize ? shape.id : `${shape.id}-label`,
      x: number(shape.x + shape.width / 2),
      y: number(shape.y + shape.height / 2),
      "text-anchor": "middle",
      "dominant-baseline": "middle",
      transform,
    };
    if (fontSize) attributes["font-size"] = fontSize;
    if (fill) attributes.fill = fill;
    setAttributes(text, attributes);
    text.textContent = shape.text;
    root.append(text);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(root)}\n`;
}

export function stripEditorMetadata(source: string): string {
  const xml = new DOMParser().parseFromString(source, "image/svg+xml");
  const error = xml.querySelector("parsererror");
  if (error || xml.documentElement.localName !== "svg") throw new Error(error?.textContent?.trim() || "文件不是有效的 SVG");
  xml.querySelector(`metadata#${metadataId}`)?.remove();
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(xml.documentElement)}\n`;
}

function setAttributes(element: Element, values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) element.setAttribute(name, value);
}

function number(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function connectionPoints(from: DocumentModel["shapes"][number], to: DocumentModel["shapes"][number]): [{ x: number; y: number }, { x: number; y: number }] {
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  return [boundaryPoint(from, toCenter.x - fromCenter.x, toCenter.y - fromCenter.y), boundaryPoint(to, fromCenter.x - toCenter.x, fromCenter.y - toCenter.y)];
}

function boundaryPoint(shape: DocumentModel["shapes"][number], dx: number, dy: number) {
  const center = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
  if (!dx && !dy) return center;
  const scale = Math.min(shape.width / 2 / Math.max(Math.abs(dx), .001), shape.height / 2 / Math.max(Math.abs(dy), .001));
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}
