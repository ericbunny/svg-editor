export type ShapeKind = "rectangle" | "ellipse" | "diamond" | "text" | "importedSvg";

export interface Shape {
  id: string;
  kind: ShapeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  text: string;
  /** 导入/内联 SVG 形状是否在画布上渲染 text 标签（元素库里的流程图元素需要）。 */
  showText?: boolean;
  /** 内联 SVG 是否随外框自由拉伸（元素库形状）；导入的部件保持等比缩放。 */
  stretch?: boolean;
  svgContent?: string;
}

export interface Connection {
  id: string;
  fromId: string;
  toId: string;
  stroke: string;
  strokeWidth: number;
}

export interface DocumentModel {
  version: number;
  name: string;
  width: number;
  height: number;
  background: string;
  shapes: Shape[];
  connections: Connection[];
}

export const emptyDocument = (): DocumentModel => ({
  version: 1,
  name: "未命名绘图",
  width: 1280,
  height: 720,
  background: "#ffffff",
  shapes: [],
  connections: [],
});

export const createShape = (kind: ShapeKind, index: number): Shape => {
  const palette = kind === "diamond"
    ? { fill: "#fef3c7", stroke: "#d97706" }
    : kind === "ellipse"
      ? { fill: "#dcfce7", stroke: "#16a34a" }
      : kind === "text"
        ? { fill: "#1f2937", stroke: "#1f2937" }
        : { fill: "#dbeafe", stroke: "#2563eb" };
  return {
    id: crypto.randomUUID(),
    kind,
    x: 120 + (index % 5) * 24,
    y: 100 + (index % 5) * 24,
    width: kind === "text" ? 160 : 140,
    height: kind === "text" ? 44 : 80,
    rotation: 0,
    fill: palette.fill,
    stroke: palette.stroke,
    strokeWidth: kind === "text" ? 0 : 2,
    text: kind === "diamond" ? "判断" : kind === "ellipse" ? "开始/结束" : kind === "text" ? "文本" : "处理步骤",
  };
};
