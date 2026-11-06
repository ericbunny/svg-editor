import type { Shape, ShapeKind } from "./types";

export type LibraryGroupId = "basic" | "flow" | "annotation" | "import";

export interface LibraryGroup {
  id: LibraryGroupId;
  label: string;
  hint: string;
}

/**
 * 元素库条目：几何形状用原生 kind（可编辑文字），
 * 复杂轮廓用内联 SVG 模板（可改色、可缩放，同样能拆成独立元素）。
 */
export interface LibraryItem {
  id: string;
  label: string;
  /** 搜索别名，让「判断 / decision / diamond」都能命中。 */
  keywords: string;
  group: LibraryGroupId;
  kind: ShapeKind;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  text?: string;
  viewBox?: string;
  /** 内联 SVG 图形主体，__fill__ / __stroke__ / __strokeWidth__ 为占位符。 */
  body?: string;
  /** 内联 SVG 形状是否渲染居中文字标签。 */
  showText?: boolean;
  /** 特殊动作：不创建形状，而是触发文件导入。 */
  action?: "import";
}

export const libraryGroups: LibraryGroup[] = [
  { id: "basic", label: "基础形状", hint: "矩形、圆形、多边形" },
  { id: "flow", label: "流程图", hint: "开始、判断、数据、数据库" },
  { id: "annotation", label: "标注与文字", hint: "文字、便签、箭头" },
  { id: "import", label: "导入", hint: "把外部 SVG 变成可编辑元素" },
];

const outline = 'fill="__fill__" stroke="__stroke__" stroke-width="__strokeWidth__"';
const strokeOnly = 'fill="none" stroke="__stroke__" stroke-width="__strokeWidth__" stroke-linejoin="round"';

export const libraryItems: LibraryItem[] = [
  // == 基础形状 ==
  {
    id: "rectangle", label: "矩形", keywords: "rectangle rect square 方框 box 基础",
    group: "basic", kind: "rectangle", width: 140, height: 80, fill: "#dbeafe", stroke: "#2563eb", strokeWidth: 2, text: "",
    body: `<rect x="1" y="1" width="138" height="78" rx="8" ${outline}/>`,
  },
  {
    id: "rounded", label: "圆角矩形", keywords: "rounded rect 圆角 卡片 card 基础",
    group: "basic", kind: "importedSvg", width: 140, height: 80, fill: "#dbeafe", stroke: "#2563eb", strokeWidth: 2, showText: true,
    body: `<rect x="1" y="1" width="138" height="78" rx="20" ${outline}/>`,
  },
  {
    id: "ellipse", label: "椭圆", keywords: "ellipse oval 圆形 基础",
    group: "basic", kind: "ellipse", width: 140, height: 80, fill: "#dbeafe", stroke: "#2563eb", strokeWidth: 2, text: "",
    body: `<ellipse cx="70" cy="40" rx="69" ry="39" ${outline}/>`,
  },
  {
    id: "circle", label: "圆形", keywords: "circle 圆点 dot 基础",
    group: "basic", kind: "ellipse", width: 100, height: 100, fill: "#dbeafe", stroke: "#2563eb", strokeWidth: 2, text: "",
    body: `<ellipse cx="70" cy="40" rx="38" ry="38" ${outline}/>`,
  },
  {
    id: "diamond", label: "菱形", keywords: "diamond rhombus 判断 基础",
    group: "basic", kind: "diamond", width: 140, height: 100, fill: "#dbeafe", stroke: "#2563eb", strokeWidth: 2, text: "",
    body: `<polygon points="70,2 138,40 70,78 2,40" ${outline}/>`,
  },
  {
    id: "triangle", label: "三角形", keywords: "triangle 三角 基础",
    group: "basic", kind: "importedSvg", width: 140, height: 80, fill: "#dbeafe", stroke: "#2563eb", strokeWidth: 2,
    body: `<path d="M70 3 L137 77 H3 Z" ${outline}/>`,
  },
  {
    id: "hexagon", label: "六边形", keywords: "hexagon 多边形 polygon 基础",
    group: "basic", kind: "importedSvg", width: 140, height: 80, fill: "#dbeafe", stroke: "#2563eb", strokeWidth: 2,
    body: `<path d="M36 3 H104 L137 40 L104 77 H36 L3 40 Z" ${outline}/>`,
  },
  {
    id: "star", label: "星形", keywords: "star 星 收藏 评分 基础",
    group: "basic", kind: "importedSvg", width: 140, height: 80, fill: "#dbeafe", stroke: "#2563eb", strokeWidth: 2,
    body: `<polygon points="70,2 78.9,27.7 106.2,28.3 84.5,44.7 92.3,70.7 70,55.2 47.7,70.7 55.5,44.7 33.8,28.3 61.1,27.7" ${outline}/>`,
  },

  // == 流程图 ==
  {
    id: "flow-terminal", label: "开始/结束", keywords: "terminator start end 起止 开始 结束 流程",
    group: "flow", kind: "importedSvg", width: 160, height: 64, fill: "#ede9fe", stroke: "#7c3aed", strokeWidth: 2, text: "开始", showText: true,
    body: `<rect x="1" y="1" width="158" height="62" rx="31" ${outline}/>`,
  },
  {
    id: "flow-process", label: "处理", keywords: "process 步骤 step 处理 流程",
    group: "flow", kind: "rectangle", width: 160, height: 80, fill: "#ede9fe", stroke: "#7c3aed", strokeWidth: 2, text: "处理步骤",
    body: `<rect x="1" y="1" width="158" height="78" rx="8" ${outline}/>`,
  },
  {
    id: "flow-decision", label: "判断", keywords: "decision condition 条件 分支 判断 流程",
    group: "flow", kind: "diamond", width: 160, height: 100, fill: "#ede9fe", stroke: "#7c3aed", strokeWidth: 2, text: "条件?",
    body: `<polygon points="70,2 138,40 70,78 2,40" ${outline}/>`,
  },
  {
    id: "flow-data", label: "数据", keywords: "data io 输入 输出 平行四边形 流程",
    group: "flow", kind: "importedSvg", width: 160, height: 80, fill: "#ede9fe", stroke: "#7c3aed", strokeWidth: 2, text: "数据", showText: true,
    body: `<path d="M30 3 H157 L130 77 H3 Z" ${outline}/>`,
  },
  {
    id: "flow-document", label: "文档", keywords: "document 文件 报告 流程",
    group: "flow", kind: "importedSvg", width: 160, height: 90, fill: "#ede9fe", stroke: "#7c3aed", strokeWidth: 2, text: "文档", showText: true,
    viewBox: "0 0 160 90",
    body: `<path d="M3 3 H157 V66 C126 80 108 66 80 73 C52 80 34 66 3 66 Z" ${outline}/>`,
  },
  {
    id: "flow-database", label: "数据库", keywords: "database storage cylinder 存储 数据 流程",
    group: "flow", kind: "importedSvg", width: 160, height: 100, fill: "#ede9fe", stroke: "#7c3aed", strokeWidth: 2, text: "数据库", showText: true,
    viewBox: "0 0 160 100",
    body: `<path d="M3 18 V72 A77 14 0 0 0 157 72 V18" ${outline}/><ellipse cx="80" cy="18" rx="77" ry="14" ${outline}/>`,
  },
  {
    id: "flow-manual", label: "手动操作", keywords: "manual operation 手输 梯形 流程",
    group: "flow", kind: "importedSvg", width: 160, height: 80, fill: "#ede9fe", stroke: "#7c3aed", strokeWidth: 2, text: "手动操作", showText: true,
    body: `<path d="M24 3 H136 L157 77 H3 Z" ${outline}/>`,
  },
  {
    id: "flow-subroutine", label: "子流程", keywords: "subroutine predefined 预定义流程 流程",
    group: "flow", kind: "importedSvg", width: 160, height: 80, fill: "#ede9fe", stroke: "#7c3aed", strokeWidth: 2, text: "子流程", showText: true,
    body: `<rect x="1" y="1" width="158" height="78" rx="8" ${outline}/><path d="M24 1 V79 M136 1 V79" ${strokeOnly}/>`,
  },
  {
    id: "flow-connector", label: "连接点", keywords: "connector junction 圆点 节点 流程",
    group: "flow", kind: "importedSvg", width: 44, height: 44, fill: "#ffffff", stroke: "#7c3aed", strokeWidth: 2,
    viewBox: "0 0 80 80",
    body: `<circle cx="40" cy="40" r="38" ${outline}/>`,
  },

  // == 标注与文字 ==
  {
    id: "text", label: "文字", keywords: "text label 文本 标签 标题 说明",
    group: "annotation", kind: "text", width: 160, height: 44, fill: "#1f2937", stroke: "#1f2937", strokeWidth: 0, text: "文本",
    body: `<text x="70" y="42" text-anchor="middle" dominant-baseline="middle" font-size="38" font-weight="600" fill="__fill__">Aa</text>`,
  },
  {
    id: "note", label: "便签", keywords: "note sticky 备注 贴纸 折角 标注",
    group: "annotation", kind: "importedSvg", width: 160, height: 100, fill: "#fef9c3", stroke: "#ca8a04", strokeWidth: 2, text: "备注", showText: true,
    viewBox: "0 0 160 100",
    body: `<path d="M3 3 H120 L157 40 V97 H3 Z" ${outline}/><path d="M120 3 V40 H157" ${strokeOnly}/>`,
  },
  {
    id: "callout", label: "注释气泡", keywords: "callout comment bubble 气泡 注释 标注",
    group: "annotation", kind: "importedSvg", width: 160, height: 90, fill: "#fef9c3", stroke: "#ca8a04", strokeWidth: 2, text: "注释", showText: true,
    viewBox: "0 0 160 90",
    body: `<path d="M3 3 H157 V63 H58 L30 87 V63 H3 Z" ${outline}/>`,
  },
  {
    id: "arrow", label: "箭头", keywords: "arrow 箭头 指向 方向 标注",
    group: "annotation", kind: "importedSvg", width: 160, height: 72, fill: "#475569", stroke: "#475569", strokeWidth: 2,
    viewBox: "0 0 160 72",
    body: `<path d="M3 25 H97 V6 L157 36 L97 66 V47 H3 Z" ${outline}/>`,
  },
  {
    id: "arrow-both", label: "双向箭头", keywords: "arrow both double 双向 箭头 标注",
    group: "annotation", kind: "importedSvg", width: 160, height: 64, fill: "#475569", stroke: "#475569", strokeWidth: 2,
    viewBox: "0 0 160 64",
    body: `<path d="M3 32 L31 5 V22 H129 V5 L157 32 L129 59 V42 H31 V59 Z" ${outline}/>`,
  },

  // == 导入 ==
  {
    id: "import-svg", label: "导入 SVG", keywords: "import svg 文件 导入 外部",
    group: "import", kind: "importedSvg", width: 0, height: 0, fill: "#e2e8f0", stroke: "#64748b", strokeWidth: 2, action: "import",
    viewBox: "0 0 160 80",
    body: `<rect x="6" y="6" width="148" height="68" rx="12" fill="none" stroke="__stroke__" stroke-width="2" stroke-dasharray="8 6"/><path d="M80 56 V26 M66 40 L80 26 L94 40" fill="none" stroke="__stroke__" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
];

const itemsById = new Map(libraryItems.map((item) => [item.id, item]));

export function libraryItemById(id: string): LibraryItem | undefined {
  return itemsById.get(id);
}

/** 创建可放在画布上的形状；内联 SVG 元素带上真实配色，之后仍可改色/拆分。 */
export function createLibraryShape(item: LibraryItem, index: number): Shape {
  const shape: Shape = {
    id: crypto.randomUUID(),
    kind: item.kind,
    x: 120 + (index % 5) * 24,
    y: 100 + (index % 5) * 24,
    width: item.width,
    height: item.height,
    rotation: 0,
    fill: item.fill,
    stroke: item.stroke,
    strokeWidth: item.strokeWidth,
    text: item.text ?? "",
  };
  if (item.kind === "importedSvg" && item.body) {
    shape.svgContent = inlineSvg(item, item.fill, item.stroke, item.strokeWidth);
    shape.stretch = true;
    shape.showText = item.showText ?? false;
  }
  return shape;
}

/** 元素卡片里的缩略图（用 currentColor 交给 CSS 统一着色）。 */
export function libraryItemMarkup(item: LibraryItem): string {
  const viewBox = item.viewBox ?? `0 0 ${item.width} ${item.height}`;
  const body = fillTemplate(item.body ?? "", "currentColor", "currentColor", 2);
  return `<svg viewBox="${viewBox}" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** 搜索匹配：名称、别名、默认文字与分组名都参与。 */
export function matchesLibraryQuery(item: LibraryItem, query: string): boolean {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return true;
  const group = libraryGroups.find((entry) => entry.id === item.group)?.label ?? "";
  return [item.label, item.keywords, item.text ?? "", group].some((value) => value.toLowerCase().includes(keyword));
}

function inlineSvg(item: LibraryItem, fill: string, stroke: string, strokeWidth: number): string {
  const viewBox = item.viewBox ?? `0 0 ${item.width} ${item.height}`;
  const body = fillTemplate(item.body ?? "", fill, stroke, strokeWidth);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${item.width}" height="${item.height}">${body}</svg>`;
}

function fillTemplate(body: string, fill: string, stroke: string, strokeWidth: number): string {
  return body
    .replaceAll("__fill__", fill)
    .replaceAll("__stroke__", stroke)
    .replaceAll("__strokeWidth__", String(strokeWidth));
}
