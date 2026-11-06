import type { Shape } from "./types";

const blockedElements = "script, foreignObject, iframe, object, embed, link";
const sharedTags = new Set(["defs", "style", "title", "desc", "metadata", "symbol", "marker", "clipPath", "mask"]);

export type ImportLayout = "stack" | "original";

export interface SvgViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function createImportedSvg(content: string, index: number): Shape {
  const root = parseAndSanitize(content);
  const { width: intrinsicWidth, height: intrinsicHeight } = svgSize(root);
  const scale = Math.min(1, 600 / intrinsicWidth, 450 / intrinsicHeight);
  const host = mountHidden(root);
  let paint = { fill: "#ffffff", stroke: "#94a3b8", strokeWidth: 0 };
  try {
    paint = samplePaint(root);
  } finally {
    host.remove();
  }

  return partShape({
    x: 100 + (index % 5) * 24,
    y: 80 + (index % 5) * 24,
    width: Math.max(1, intrinsicWidth * scale),
    height: Math.max(1, intrinsicHeight * scale),
    name: "",
    content: new XMLSerializer().serializeToString(root),
    ...paint,
  });
}

/** 读取 SVG 的用户坐标系范围（优先使用 viewBox，与画布 viewBox 保持一致）。 */
export function svgViewport(content: string): SvgViewport {
  return viewportOf(parseAndSanitize(content));
}

export function createImportedSvgParts(content: string, index: number, layout: ImportLayout = "stack"): Shape[] {
  const { root, viewport, parts } = measureParts(content);

  if (layout === "original") {
    return parts.map(({ element, box, fill, stroke, strokeWidth }, partIndex) => partShape({
      x: box.x - viewport.x,
      y: box.y - viewport.y,
      width: Math.max(1, box.width),
      height: Math.max(1, box.height),
      name: elementLabel(element, `SVG 元素 ${index + partIndex + 1}`),
      content: serializePart(root, element, box),
      fill,
      stroke,
      strokeWidth,
    }));
  }

  const minX = Math.min(...parts.map(({ box }) => box.x));
  const minY = Math.min(...parts.map(({ box }) => box.y));
  const maxX = Math.max(...parts.map(({ box }) => box.x + box.width));
  const maxY = Math.max(...parts.map(({ box }) => box.y + box.height));
  const scale = Math.min(1, 800 / Math.max(1, maxX - minX), 550 / Math.max(1, maxY - minY));

  return parts.map(({ element, box, fill, stroke, strokeWidth }, partIndex) => partShape({
    x: 80 + (box.x - minX) * scale,
    y: 70 + (box.y - minY) * scale,
    width: Math.max(1, box.width * scale),
    height: Math.max(1, box.height * scale),
    name: elementLabel(element, `SVG 部件 ${index + partIndex + 1}`),
    content: serializePart(root, element, box),
    fill,
    stroke,
    strokeWidth,
  }));
}

/** 把已导入的整体 SVG 形状按内部元素拆开，返回替换用的形状列表（不足 2 个时返回空数组）。 */
export function splitImportedShape(shape: Shape): Shape[] {
  if (shape.kind !== "importedSvg" || !shape.svgContent) throw new Error("该对象不是导入的 SVG");
  const { root, viewport, parts } = measureParts(shape.svgContent);
  if (parts.length < 2) return [];
  const scaleX = shape.width / Math.max(1e-6, viewport.width);
  const scaleY = shape.height / Math.max(1e-6, viewport.height);

  return parts.map(({ element, box, fill, stroke, strokeWidth }, partIndex) => partShape({
    x: shape.x + (box.x - viewport.x) * scaleX,
    y: shape.y + (box.y - viewport.y) * scaleY,
    width: Math.max(1, box.width * scaleX),
    height: Math.max(1, box.height * scaleY),
    rotation: shape.rotation,
    name: elementLabel(element, `SVG 部件 ${partIndex + 1}`),
    content: serializePart(root, element, box),
    fill,
    stroke,
    strokeWidth,
  }));
}

/** 改写部件里的文字内容（拆到 <text> 层后可直接编辑文案）。 */
export function replaceSvgText(content: string, value: string): string {
  const root = parseAndSanitize(content);
  const text = root.querySelector("text");
  if (!text) throw new Error("该部件不包含可编辑文字");
  text.textContent = value;
  return new XMLSerializer().serializeToString(root);
}

/**
 * 改写部件内部的绘制颜色：只覆盖当前确实有填充/描边的元素，
 * 保持 fill="none" 的线条不被误填充。
 */
export function recolorSvgContent(content: string, patch: { fill?: string; stroke?: string; strokeWidth?: number }): string {
  const root = parseAndSanitize(content);
  const host = mountHidden(root);
  try {
    const nodes = [root, ...root.querySelectorAll("*")]
      .filter((element) => paintTags.has(element.localName));
    for (const element of nodes) {
      const target = element as SVGElement;
      const style = getComputedStyle(target);
      const currentStrokeWidth = Number.parseFloat(style.strokeWidth);
      if (patch.fill && paintable(style.fill)) target.style.setProperty("fill", patch.fill);
      if (patch.stroke) {
        target.style.setProperty("stroke", patch.stroke);
        if (patch.strokeWidth === undefined && !(currentStrokeWidth > 0)) target.style.setProperty("stroke-width", "1.5");
      }
      if (patch.strokeWidth !== undefined && paintable(style.stroke)) target.style.setProperty("stroke-width", String(patch.strokeWidth));
    }
  } finally {
    host.remove();
  }
  return new XMLSerializer().serializeToString(root);
}

interface MeasuredPart {
  element: Element;
  box: DOMRect;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

function measureParts(content: string): { root: SVGSVGElement; viewport: SvgViewport; parts: MeasuredPart[] } {
  const root = parseAndSanitize(content);
  const viewport = viewportOf(root);
  root.setAttribute("width", String(viewport.width));
  root.setAttribute("height", String(viewport.height));
  if (!root.hasAttribute("viewBox")) root.setAttribute("viewBox", `0 0 ${viewport.width} ${viewport.height}`);

  const host = mountHidden(root);
  try {
    const candidates = resolveCandidates(root);
    if (!candidates.length) throw new Error("SVG 中没有可拆分的可见部件");
    if (candidates.length > 300) throw new Error("SVG 可拆分部件超过 300 个，请先在矢量工具中进行分组");

    const parts = candidates
      .map((element) => {
        const paint = samplePaint(element);
        return {
          element,
          box: rootBounds(root, element),
          fill: paint.fill,
          stroke: paint.stroke,
          strokeWidth: paint.strokeWidth,
        };
      })
      .filter(({ box }) => Number.isFinite(box.x) && Number.isFinite(box.y) && (box.width >= 0.5 || box.height >= 0.5));
    if (!parts.length) throw new Error("无法计算 SVG 部件边界");
    return { root, viewport, parts };
  } finally {
    host.remove();
  }
}

/** 水平/垂直直线的可视高度只有线宽，过小的框会导致点不中，这里补到最小可选尺寸（内容居中不变形）。 */
const minimumHitSize = 8;

function partShape(values: { x: number; y: number; width: number; height: number; rotation?: number; name: string; content: string; fill?: string; stroke?: string; strokeWidth?: number }): Shape {
  const width = Math.max(minimumHitSize, values.width);
  const height = Math.max(minimumHitSize, values.height);
  return {
    id: crypto.randomUUID(),
    kind: "importedSvg",
    x: values.x - (width - values.width) / 2,
    y: values.y - (height - values.height) / 2,
    width,
    height,
    rotation: values.rotation ?? 0,
    fill: values.fill ?? "#ffffff",
    stroke: values.stroke ?? "#94a3b8",
    strokeWidth: values.strokeWidth ?? 0,
    text: values.name,
    svgContent: values.content,
  };
}

const elementKindLabels: Record<string, string> = {
  rect: "矩形",
  circle: "圆形",
  ellipse: "椭圆",
  line: "直线",
  polyline: "折线",
  polygon: "多边形",
  path: "路径",
  text: "文字",
  image: "图片",
  use: "引用",
  g: "分组",
};

export function svgElementType(content: string | undefined): string {
  if (!content) return "SVG";
  try {
    const root = parseAndSanitize(content);
    const rootChildren = drawableChildren(root);
    if (rootChildren.length !== 1) return "SVG";
    let element = rootChildren[0];
    while (containerTags.has(element.localName)) {
      const children = drawableChildren(element);
      if (children.length !== 1) break;
      element = children[0];
    }
    return elementKindLabels[element.localName] ?? element.localName.toUpperCase();
  } catch {
    return "SVG";
  }
}

function elementLabel(element: Element, fallback: string): string {
  const text = (element.localName === "text" ? element.textContent : element.querySelector("text")?.textContent)?.trim();
  if (text) return text.replace(/\s+/g, " ").slice(0, 24);
  const kind = elementKindLabels[element.localName];
  if (!kind) return fallback;
  const index = fallback.match(/(\d+)$/)?.[1];
  return index ? `${kind} ${index}` : kind;
}

/** 分组本身往往没有绘制属性，取组内第一个绘制元素的样式作为属性面板初始值。 */
function samplePaint(element: Element): { fill: string; stroke: string; strokeWidth: number } {
  const own = !containerTags.has(element.localName) || element.hasAttribute("fill") || element.hasAttribute("stroke");
  const target = own ? element : element.querySelector("rect, circle, ellipse, line, polyline, polygon, path, text, image") ?? element;
  const style = getComputedStyle(target);
  return {
    fill: cssColorToHex(style.fill) ?? "#ffffff",
    stroke: cssColorToHex(style.stroke) ?? "#94a3b8",
    strokeWidth: Number.parseFloat(style.strokeWidth) || 0,
  };
}

function cssColorToHex(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return undefined;
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  const match = /^rgba?\(([^)]+)\)$/i.exec(trimmed);
  if (!match) return undefined;
  const [r, g, b, alpha] = match[1].split(/[\s,/]+/).map(Number);
  if (![r, g, b].every((channel) => Number.isFinite(channel))) return undefined;
  if (alpha !== undefined && alpha < 0.1) return undefined;
  return `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

function mountHidden(root: SVGSVGElement): HTMLDivElement {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none";
  host.append(root);
  document.body.append(host);
  return host;
}

function viewportOf(root: Element): SvgViewport {
  const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (viewBox?.length === 4 && viewBox.every((value) => Number.isFinite(value)) && viewBox[2] > 0 && viewBox[3] > 0) {
    return { x: viewBox[0], y: viewBox[1], width: viewBox[2], height: viewBox[3] };
  }
  const size = svgSize(root);
  return { x: 0, y: 0, width: size.width, height: size.height };
}

function parseAndSanitize(content: string): SVGSVGElement {
  const parser = new DOMParser();
  const xml = parser.parseFromString(content, "image/svg+xml");
  if (xml.querySelector("parsererror") || xml.documentElement.localName !== "svg") {
    throw new Error("文件不是有效的 SVG");
  }

  xml.querySelectorAll(blockedElements).forEach((element) => element.remove());
  xml.querySelectorAll("style").forEach((element) => {
    element.textContent = sanitizeCss(element.textContent ?? "");
    if (!element.textContent.trim()) element.remove();
  });
  xml.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on")) element.removeAttribute(attribute.name);
      if ((name === "href" || name === "xlink:href") && !value.startsWith("#") && !value.startsWith("data:image/")) {
        element.removeAttribute(attribute.name);
        if (element.localName === "image" || element.localName === "use") element.remove();
      }
      if (name === "style") element.setAttribute(attribute.name, sanitizeCss(value));
      if (/url\s*\(\s*["']?(?!#|data:image\/)/i.test(value)) element.removeAttribute(attribute.name);
    }
  });

  const root = xml.documentElement as unknown as SVGSVGElement;
  if (!root.getAttribute("xmlns")) root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return root;
}

function svgSize(root: Element): { width: number; height: number } {
  const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  return {
    width: positiveNumber(root.getAttribute("width")) ?? (viewBox?.length === 4 ? viewBox[2] : undefined) ?? 400,
    height: positiveNumber(root.getAttribute("height")) ?? (viewBox?.length === 4 ? viewBox[3] : undefined) ?? 300,
  };
}

const containerTags = new Set(["g", "a", "switch", "svg"]);
const paintTags = new Set(["rect", "circle", "ellipse", "line", "polyline", "polygon", "path", "text", "tspan", "g", "use"]);

function drawableChildren(element: Element): Element[] {
  return [...element.children].filter((child) =>
    !sharedTags.has(child.localName) && child.getAttribute("data-svg-editor-role") !== "background");
}

function resolveCandidates(root: Element): Element[] {
  let best = drawableChildren(root);
  let candidates = best;
  let depth = 0;
  while (candidates.length === 1 && containerTags.has(candidates[0].localName) && depth < 12) {
    const children = drawableChildren(candidates[0]);
    if (!children.length) break;
    candidates = children;
    best = children;
    depth += 1;
  }
  return best;
}

function paintable(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== "none" && normalized !== "transparent" && normalized !== "rgba(0, 0, 0, 0)" && !normalized.startsWith("url(");
}

/** 描边会外扩一半线宽：水平/垂直直线几何高度为 0 需要靠它救回，分组则要取组内最大线宽。 */
function strokePadding(element: Element): number {
  const targets = containerTags.has(element.localName)
    ? [element, ...element.querySelectorAll("rect, circle, ellipse, line, polyline, polygon, path, text")]
    : [element];
  let padding = 0;
  for (const target of targets) {
    const style = getComputedStyle(target);
    if (!paintable(style.stroke)) continue;
    const width = Number.parseFloat(style.strokeWidth);
    if (Number.isFinite(width) && width > 0) padding = Math.max(padding, width / 2);
  }
  return padding;
}

function rootBounds(root: SVGSVGElement, element: Element): DOMRect {
  const graphics = element as SVGGraphicsElement;
  const raw = graphics.getBBox();
  const padding = strokePadding(element);
  const box = new DOMRect(raw.x - padding, raw.y - padding, raw.width + padding * 2, raw.height + padding * 2);
  const rootMatrix = root.getScreenCTM();
  const elementMatrix = graphics.getScreenCTM();
  if (!rootMatrix || !elementMatrix) return box;
  const matrix = rootMatrix.inverse().multiply(elementMatrix);
  const points = [
    new DOMPoint(box.x, box.y),
    new DOMPoint(box.x + box.width, box.y),
    new DOMPoint(box.x + box.width, box.y + box.height),
    new DOMPoint(box.x, box.y + box.height),
  ].map((point) => point.matrixTransform(matrix));
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  return new DOMRect(minX, minY, maxX - minX, maxY - minY);
}

function serializePart(root: SVGSVGElement, element: Element, box: DOMRect): string {
  const marker = crypto.randomUUID();
  element.setAttribute("data-svg-editor-part", marker);
  const clone = root.cloneNode(true) as SVGSVGElement;
  element.removeAttribute("data-svg-editor-part");
  const marked = clone.querySelector(`[data-svg-editor-part="${marker}"]`);
  if (!marked) throw new Error("无法拆分 SVG 部件");
  let branch: Element = marked;
  branch.removeAttribute("data-svg-editor-part");
  while (branch.parentElement) {
    const parent: Element = branch.parentElement;
    for (const sibling of [...parent.children]) {
      if (sibling !== branch && !["defs", "style", "title", "desc", "metadata"].includes(sibling.localName)) sibling.remove();
    }
    if (parent === clone) break;
    branch = parent;
  }
  clone.setAttribute("viewBox", `${box.x} ${box.y} ${box.width} ${box.height}`);
  clone.setAttribute("width", String(box.width));
  clone.setAttribute("height", String(box.height));
  return new XMLSerializer().serializeToString(clone);
}

function sanitizeCss(css: string): string {
  return css
    .replace(/@import[\s\S]*?(?:;|$)/gi, "")
    .replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (_match, _quote, target: string) => {
      const value = target.trim();
      return value.startsWith("#") || value.startsWith("data:image/") ? `url(${value})` : "none";
    })
    .replace(/[\w-]+\s*:\s*[^;]*(?:expression\s*\(|javascript:)[^;]*;?/gi, "");
}

export function svgDataUri(content: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`;
}

export function svgBase64(content: string): string {
  const bytes = new TextEncoder().encode(content);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function positiveNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}
