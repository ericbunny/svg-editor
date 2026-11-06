import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import CodeMirror from "@uiw/react-codemirror";
import { xml } from "@codemirror/lang-xml";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  Boxes,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Circle,
  Code2,
  Diamond,
  Download,
  FileInput,
  FilePlus2,
  FolderOpen,
  Layers,
  Link2,
  LoaderCircle,
  Maximize2,
  MousePointer2,
  Palette,
  Redo2,
  Save,
  Search,
  Square,
  Trash2,
  Type,
  Undo2,
  Ungroup,
  WandSparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { emptyDocument, type Connection, type DocumentModel, type Shape, type ShapeKind } from "./types";
import {
  createLibraryShape,
  libraryGroups,
  libraryItemById,
  libraryItemMarkup,
  libraryItems,
  matchesLibraryQuery,
  type LibraryItem,
} from "./elementLibrary";
import { createImportedSvg, createImportedSvgParts, recolorSvgContent, replaceSvgText, splitImportedShape, svgDataUri, svgElementType } from "./svgImport";
import { parseSvgDocument, serializeSvgDocument, stripEditorMetadata } from "./svgDocument";

type DragState = { ids: string[]; clickedId: string; startX: number; startY: number; origins: Array<{ id: string; x: number; y: number }>; moved: boolean };
type MarqueeState = { startX: number; startY: number; currentX: number; currentY: number; additive: boolean; base: string[] };
type LibraryDragState = { item: LibraryItem; startX: number; startY: number; x: number; y: number; moved: boolean };
type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type ResizeState = { id: string; handle: ResizeHandle; startX: number; startY: number; origin: Shape };
type RotateState = { id: string };
type CanvasResizeState = { handle: ResizeHandle; startX: number; startY: number; startWidth: number; startHeight: number; width: number; height: number; origin: DocumentModel };
type Rect = { x: number; y: number; width: number; height: number };
type ExportFormat = "png" | "jpeg" | "webp";
type ExportState = "idle" | "exporting" | "success" | "error";

const clone = (document: DocumentModel): DocumentModel => structuredClone(document);
const isTauri = () => "__TAURI_INTERNALS__" in window;
export default function App() {
  const [document, setDocument] = useState<DocumentModel>(emptyDocument);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [marqueeBox, setMarqueeBox] = useState<MarqueeState | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [canvasSelected, setCanvasSelected] = useState(false);
  const [ctrlPressed, setCtrlPressed] = useState(false);
  const [connectMode, setConnectMode] = useState(false);
  const [connectionStart, setConnectionStart] = useState<string | null>(null);
  const [past, setPast] = useState<DocumentModel[]>([]);
  const [future, setFuture] = useState<DocumentModel[]>([]);
  const [zoom, setZoom] = useState(0.8);
  const [status, setStatus] = useState("就绪");
  const [sourceMode, setSourceMode] = useState(false);
  const [source, setSource] = useState("");
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("png");
  const [exportDpi, setExportDpi] = useState(96);
  const [exportState, setExportState] = useState<ExportState>("idle");
  const [libraryDragPreview, setLibraryDragPreview] = useState<LibraryDragState | null>(null);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const drag = useRef<DragState | null>(null);
  const resize = useRef<ResizeState | null>(null);
  const rotate = useRef<RotateState | null>(null);
  const canvasResize = useRef<CanvasResizeState | null>(null);
  const dragSnapshot = useRef<DocumentModel | null>(null);
  const libraryDrag = useRef<LibraryDragState | null>(null);
  const suppressLibraryClick = useRef(false);
  const canvasRef = useRef<SVGSVGElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const splitImport = useRef(false);
  const sourceSnapshot = useRef("");
  const marquee = useRef<MarqueeState | null>(null);
  /** 只有单选时才展示完整属性面板与缩放/旋转手柄；多选走批量面板。 */
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const selectOnly = useCallback((id: string | null) => {
    setSelectedIds(id ? [id] : []);
    if (id) setCanvasSelected(false);
  }, []);
  const toggleSelected = useCallback((id: string) => {
    setCanvasSelected(false);
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }, []);
  const selected = useMemo(() => document.shapes.find((shape) => shape.id === selectedId), [document, selectedId]);
  const selectedShapes = useMemo(() => document.shapes.filter((shape) => selectedIds.includes(shape.id)), [document.shapes, selectedIds]);
  const selectedConnection = useMemo(() => document.connections.find((connection) => connection.id === selectedConnectionId), [document, selectedConnectionId]);

  const commit = useCallback((updater: (current: DocumentModel) => DocumentModel) => {
    setDocument((current) => {
      const next = updater(clone(current));
      setPast((items) => [...items.slice(-99), current]);
      setFuture([]);
      return next;
    });
  }, []);

  const addLibraryItem = (item: LibraryItem, position?: { x: number; y: number }) => {
    if (item.action === "import") { void importSvg(true); return; }
    const shape = createLibraryShape(item, document.shapes.length);
    if (position) {
      shape.x = Math.max(0, Math.min(document.width - shape.width, position.x - shape.width / 2));
      shape.y = Math.max(0, Math.min(document.height - shape.height, position.y - shape.height / 2));
    }
    commit((next) => ({ ...next, shapes: [...next.shapes, shape] }));
    selectOnly(shape.id);
    setSelectedConnectionId(null);
    setRecentIds((ids) => [item.id, ...ids.filter((id) => id !== item.id)].slice(0, 6));
    setStatus(`已添加「${item.label}」`);
  };

  const onLibraryPointerDown = (event: React.PointerEvent<HTMLButtonElement>, item: LibraryItem) => {
    if (event.button !== 0 || item.action === "import") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const state = { item, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false };
    libraryDrag.current = state;
    setLibraryDragPreview(state);
  };

  const onLibraryPointerMove = (event: React.PointerEvent) => {
    const state = libraryDrag.current;
    if (!state) return;
    const moved = state.moved || Math.hypot(event.clientX - state.startX, event.clientY - state.startY) > 4;
    const next = { ...state, x: event.clientX, y: event.clientY, moved };
    libraryDrag.current = next;
    setLibraryDragPreview(next);
  };

  const onLibraryPointerUp = (event: React.PointerEvent) => {
    const state = libraryDrag.current;
    if (!state) return;
    if (state.moved) {
      suppressLibraryClick.current = true;
      const bounds = canvasRef.current?.getBoundingClientRect();
      if (bounds && event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom) {
        addLibraryItem(state.item, {
          x: (event.clientX - bounds.left) * document.width / bounds.width,
          y: (event.clientY - bounds.top) * document.height / bounds.height,
        });
      }
    }
    libraryDrag.current = null;
    setLibraryDragPreview(null);
  };

  const addLibraryItemFromClick = (item: LibraryItem) => {
    if (suppressLibraryClick.current) {
      suppressLibraryClick.current = false;
      return;
    }
    addLibraryItem(item);
  };

  const updateSelected = (patch: Partial<Shape>) => {
    if (!selectedId) return;
    commit((next) => ({
      ...next,
      shapes: next.shapes.map((shape) => shape.id === selectedId ? withPaintPatch(shape, patch) : shape),
    }));
  };

  /** 多选时批量改外观（填充/描边/线宽等）。 */
  const updateSelection = (patch: Partial<Shape>) => {
    if (!selectedIds.length) return;
    const ids = new Set(selectedIds);
    commit((next) => ({
      ...next,
      shapes: next.shapes.map((shape) => ids.has(shape.id) ? withPaintPatch(shape, patch) : shape),
    }));
  };

  const updateCanvasSize = (width: number, height: number) => {
    commit((next) => ({ ...next, width, height }));
    setStatus(`画布尺寸已调整为 ${width} × ${height}`);
  };

  const onCanvasResizePointerDown = (event: React.PointerEvent<HTMLButtonElement>, handle: ResizeHandle) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    canvasResize.current = {
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: document.width,
      startHeight: document.height,
      width: document.width,
      height: document.height,
      origin: clone(document),
    };
  };

  const onCanvasResizePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = canvasResize.current;
    if (!state) return;
    const dx = (event.clientX - state.startX) / zoom;
    const dy = (event.clientY - state.startY) / zoom;
    const widthDelta = state.handle.includes("e") ? dx : state.handle.includes("w") ? -dx : 0;
    const heightDelta = state.handle.includes("s") ? dy : state.handle.includes("n") ? -dy : 0;
    const width = Math.max(64, Math.min(100000, Math.round(state.startWidth + widthDelta)));
    const height = Math.max(64, Math.min(100000, Math.round(state.startHeight + heightDelta)));
    state.width = width;
    state.height = height;
    setDocument((current) => current.width === width && current.height === height ? current : { ...current, width, height });
  };

  const onCanvasResizePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = canvasResize.current;
    if (!state) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    canvasResize.current = null;
    if (state.width === state.startWidth && state.height === state.startHeight) return;
    setPast((items) => [...items.slice(-99), state.origin]);
    setFuture([]);
    setStatus(`画布尺寸已调整为 ${state.width} × ${state.height}`);
  };

  const splitSelectedShape = () => {
    if (!selected || selected.kind !== "importedSvg") return;
    try {
      const parts = splitImportedShape(selected);
      if (!parts.length) { setStatus("该对象已是最小可编辑单元，无法继续拆分"); return; }
      commit((next) => ({
        ...next,
        shapes: next.shapes.flatMap((shape) => shape.id === selected.id ? parts : [shape]),
      }));
      selectOnly(parts[0].id);
      setStatus(`已拆分为 ${parts.length} 个可单独编辑的元素`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "拆分失败");
    }
  };

  const updateSelectedConnection = (patch: Partial<Connection>) => {
    if (!selectedConnectionId) return;
    commit((next) => ({
      ...next,
      connections: next.connections.map((connection) => connection.id === selectedConnectionId ? { ...connection, ...patch } : connection),
    }));
  };

  const removeSelected = useCallback(() => {
    if (selectedConnectionId) {
      commit((next) => ({ ...next, connections: next.connections.filter((connection) => connection.id !== selectedConnectionId) }));
      setSelectedConnectionId(null);
      setStatus("已删除连接线");
      return;
    }
    if (!selectedIds.length) return;
    const ids = new Set(selectedIds);
    commit((next) => ({
      ...next,
      shapes: next.shapes.filter((shape) => !ids.has(shape.id)),
      connections: next.connections.filter((connection) => !ids.has(connection.fromId) && !ids.has(connection.toId)),
    }));
    setStatus(selectedIds.length > 1 ? `已删除 ${selectedIds.length} 个图形` : "已删除图形");
    setSelectedIds([]);
  }, [commit, selectedConnectionId, selectedIds]);

  const undo = useCallback(() => {
    setPast((items) => {
      const previous = items.at(-1);
      if (!previous) return items;
      setDocument((current) => { setFuture((next) => [current, ...next]); return previous; });
      selectOnly(null);
      setSelectedConnectionId(null);
      return items.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((items) => {
      const next = items[0];
      if (!next) return items;
      setDocument((current) => { setPast((previous) => [...previous, current]); return next; });
      selectOnly(null);
      setSelectedConnectionId(null);
      return items.slice(1);
    });
  }, []);

  const changeZoom = useCallback((value: number, anchor?: { x: number; y: number }) => {
    const workspace = workspaceRef.current;
    const next = Math.max(0.1, Math.min(4, value));
    if (!workspace) { setZoom(next); return; }
    const bounds = workspace.getBoundingClientRect();
    const canvasBounds = canvasRef.current?.getBoundingClientRect();
    const point = anchor ?? { x: bounds.left + workspace.clientWidth / 2, y: bounds.top + workspace.clientHeight / 2 };
    const documentX = canvasBounds ? (point.x - canvasBounds.left) / zoom : document.width / 2;
    const documentY = canvasBounds ? (point.y - canvasBounds.top) / zoom : document.height / 2;
    setZoom(next);
    requestAnimationFrame(() => {
      const nextCanvasBounds = canvasRef.current?.getBoundingClientRect();
      if (!nextCanvasBounds) return;
      workspace.scrollLeft += nextCanvasBounds.left + documentX * next - point.x;
      workspace.scrollTop += nextCanvasBounds.top + documentY * next - point.y;
    });
  }, [document.height, document.width, zoom]);

  const fitCanvas = useCallback(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    changeZoom(Math.min((workspace.clientWidth - 100) / document.width, (workspace.clientHeight - 100) / document.height));
  }, [changeZoom, document.height, document.width]);

  const onWorkspaceWheel = (event: React.WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    changeZoom(zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1), { x: event.clientX, y: event.clientY });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable=true]")) return;
      if (!sourceMode && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        const ids = document.shapes.map((shape) => shape.id);
        setSelectedIds(ids);
        setSelectedConnectionId(null);
        setCanvasSelected(false);
        setStatus(ids.length ? `已选择画布中的 ${ids.length} 个元素` : "画布中没有可选择的元素");
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
      if (event.key === "Delete" || event.key === "Backspace") removeSelected();
      if (event.key === "Escape") {
        marquee.current = null;
        setMarqueeBox(null);
        setSelectedIds([]);
        setSelectedConnectionId(null);
        setCanvasSelected(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [document.shapes, redo, removeSelected, sourceMode, undo]);

  useEffect(() => {
    const updateModifier = (event: KeyboardEvent) => setCtrlPressed(event.ctrlKey);
    const clearModifier = () => setCtrlPressed(false);
    window.addEventListener("keydown", updateModifier);
    window.addEventListener("keyup", updateModifier);
    window.addEventListener("blur", clearModifier);
    return () => {
      window.removeEventListener("keydown", updateModifier);
      window.removeEventListener("keyup", updateModifier);
      window.removeEventListener("blur", clearModifier);
    };
  }, []);

  const onPointerDown = (event: React.PointerEvent, shape: Shape) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    if (connectMode) {
      if (!connectionStart) {
        setConnectionStart(shape.id);
        selectOnly(shape.id);
        setSelectedConnectionId(null);
        setStatus("请选择连接线的终点");
      } else if (connectionStart !== shape.id) {
        const connection: Connection = { id: crypto.randomUUID(), fromId: connectionStart, toId: shape.id, stroke: "#475569", strokeWidth: 2 };
        commit((next) => ({ ...next, connections: [...next.connections, connection] }));
        setConnectionStart(null);
        selectOnly(null);
        setSelectedConnectionId(connection.id);
        setStatus("已创建连接线");
      }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      // Ctrl/Cmd（或 Shift）+ 点击：把该元素加入或移出选择集合，不启动拖动
      setSelectedConnectionId(null);
      toggleSelected(shape.id);
      return;
    }
    const draggingSelection = selectedIds.includes(shape.id);
    const ids = draggingSelection ? selectedIds : [shape.id];
    if (!draggingSelection) selectOnly(shape.id);
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    setSelectedConnectionId(null);
    drag.current = {
      ids,
      clickedId: shape.id,
      startX: event.clientX,
      startY: event.clientY,
      origins: document.shapes.filter((item) => ids.includes(item.id)).map((item) => ({ id: item.id, x: item.x, y: item.y })),
      moved: false,
    };
    dragSnapshot.current = document;
  };

  const onResizePointerDown = (event: React.PointerEvent, shape: Shape, handle: ResizeHandle) => {
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    resize.current = { id: shape.id, handle, startX: event.clientX, startY: event.clientY, origin: { ...shape } };
    dragSnapshot.current = document;
  };

  const onRotatePointerDown = (event: React.PointerEvent, shape: Shape) => {
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    rotate.current = { id: shape.id };
    dragSnapshot.current = document;
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (drag.current) {
      const state = drag.current;
      const dx = (event.clientX - state.startX) / zoom;
      const dy = (event.clientY - state.startY) / zoom;
      if (!state.moved && Math.hypot(dx, dy) > 3) state.moved = true;
      const origins = new Map(state.origins.map((origin) => [origin.id, origin]));
      setDocument((current) => ({
        ...current,
        shapes: current.shapes.map((shape) => {
          const origin = origins.get(shape.id);
          return origin ? { ...shape, x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) } : shape;
        }),
      }));
      return;
    }
    if (resize.current) {
      const state = resize.current;
      const dx = (event.clientX - state.startX) / zoom;
      const dy = (event.clientY - state.startY) / zoom;
      const minimum = 20;
      const origin = state.origin;
      let { x, y, width, height } = origin;
      if (state.handle.includes("e")) width = Math.max(minimum, origin.width + dx);
      if (state.handle.includes("s")) height = Math.max(minimum, origin.height + dy);
      if (state.handle.includes("w")) { width = Math.max(minimum, origin.width - dx); x = origin.x + origin.width - width; }
      if (state.handle.includes("n")) { height = Math.max(minimum, origin.height - dy); y = origin.y + origin.height - height; }
      setDocument((current) => ({ ...current, shapes: current.shapes.map((shape) => shape.id === state.id ? { ...shape, x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) } : shape) }));
      return;
    }
    if (rotate.current) {
      const shape = document.shapes.find((item) => item.id === rotate.current?.id);
      const bounds = canvasRef.current?.getBoundingClientRect();
      if (!shape || !bounds) return;
      const pointerX = (event.clientX - bounds.left) * document.width / bounds.width;
      const pointerY = (event.clientY - bounds.top) * document.height / bounds.height;
      const centerX = shape.x + shape.width / 2;
      const centerY = shape.y + shape.height / 2;
      const rotation = Math.round(Math.atan2(pointerY - centerY, pointerX - centerX) * 180 / Math.PI + 90);
      setDocument((current) => ({ ...current, shapes: current.shapes.map((item) => item.id === shape.id ? { ...item, rotation } : item) }));
    }
  };

  const onPointerUp = () => {
    const dragged = Boolean(drag.current?.moved);
    if (((drag.current && dragged) || resize.current || rotate.current) && dragSnapshot.current) {
      setPast((items) => [...items.slice(-99), dragSnapshot.current!]);
      setFuture([]);
    }
    // 多选时单击（未拖动）集合内的元素，收缩为只选中该元素
    if (drag.current && !dragged) selectOnly(drag.current.clickedId);
    drag.current = null;
    resize.current = null;
    rotate.current = null;
    dragSnapshot.current = null;
  };

  const pointerToDocument = (event: { clientX: number; clientY: number }) => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    return {
      x: (event.clientX - bounds.left) * document.width / bounds.width,
      y: (event.clientY - bounds.top) * document.height / bounds.height,
    };
  };

  /** 框选矩形命中的图形（相交即选中，忽略旋转角度，按外框近似）。 */
  const marqueeSelection = (state: MarqueeState) => {
    const bounds = marqueeBounds(state);
    if (bounds.width < 2 && bounds.height < 2) return state.base;
    const hits = document.shapes
      .filter((shape) => rectsIntersect({ x: shape.x, y: shape.y, width: shape.width, height: shape.height }, bounds))
      .map((shape) => shape.id);
    return state.additive ? [...state.base, ...hits.filter((id) => !state.base.includes(id))] : hits;
  };

  const onCanvasPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    setSelectedConnectionId(null);
    setCanvasSelected(true);
    setConnectionStart(null);
    if (connectMode) { setSelectedIds([]); return; }
    const point = pointerToDocument(event);
    if (!point) return;
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (!additive) setSelectedIds([]);
    event.currentTarget.setPointerCapture(event.pointerId);
    const state: MarqueeState = {
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
      additive,
      base: additive ? selectedIds : [],
    };
    marquee.current = state;
    setMarqueeBox(state);
  };

  const onCanvasPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const state = marquee.current;
    if (!state) return;
    const point = pointerToDocument(event);
    if (!point) return;
    const next = { ...state, currentX: point.x, currentY: point.y };
    marquee.current = next;
    setMarqueeBox(next);
    const ids = marqueeSelection(next);
    setSelectedIds((current) => sameIds(current, ids) ? current : ids);
  };

  const onCanvasPointerUp = () => {
    const state = marquee.current;
    if (!state) return;
    marquee.current = null;
    setMarqueeBox(null);
    const bounds = marqueeBounds(state);
    if (bounds.width < 2 && bounds.height < 2) return;
    const count = marqueeSelection(state).length;
    setStatus(count ? `已框选 ${count} 个元素` : "已取消选择");
  };

  const newDocument = () => {
    if (document.shapes.length && !window.confirm("新建文档将清空当前画布，是否继续？")) return;
    setDocument(emptyDocument()); selectOnly(null); setSelectedConnectionId(null); setPast([]); setFuture([]); setStatus("已新建文档");
  };

  const saveDocument = async () => {
    let content: string;
    try {
      content = sourceMode && source !== sourceSnapshot.current ? stripEditorMetadata(source) : serializeSvgDocument(document);
      parseSvgDocument(content);
    } catch (error) { setSourceError(error instanceof Error ? error.message : "SVG 源码无效"); return; }
    if (!isTauri()) { downloadBlob(content, `${document.name}.svg`, "image/svg+xml"); return; }
    const path = await save({ defaultPath: `${document.name}.svg`, filters: [{ name: "SVG 图像", extensions: ["svg"] }] });
    if (path) { await invoke("write_svg", { path, content }); setStatus("SVG 已保存"); }
  };

  const exportImage = async () => {
    if (!Number.isFinite(exportDpi) || exportDpi <= 0) { window.alert("DPI 必须大于 0"); return; }
    if (!isTauri()) { window.alert("图片导出功能仅在桌面应用中可用"); return; }
    let content: string;
    try {
      content = sourceMode && source !== sourceSnapshot.current ? stripEditorMetadata(source) : serializeSvgDocument(document);
      parseSvgDocument(content);
    } catch (error) { setSourceError(error instanceof Error ? error.message : "SVG 源码无效"); return; }
    const extension = exportFormat === "jpeg" ? "jpg" : exportFormat;
    const path = await save({
      defaultPath: `${document.name}.${extension}`,
      filters: [{ name: `${exportFormat.toUpperCase()} 图像`, extensions: [extension] }],
    });
    if (!path) return;
    setExportState("exporting");
    setStatus(`正在导出 ${exportFormat.toUpperCase()} 图片…`);
    try {
      const [width, height] = await invoke<[number, number]>("export_image", { path, content, format: exportFormat, dpi: exportDpi });
      setExportState("success");
      setStatus(`已导出 ${exportFormat.toUpperCase()} · ${width} × ${height} px · ${exportDpi} DPI`);
    } catch (error) {
      setExportState("error");
      setStatus(`图片导出失败：${String(error)}`);
      window.alert(`图片导出失败：${String(error)}`);
    }
  };

  const openDocument = async () => {
    if (!isTauri()) { window.document.getElementById("file-input")?.click(); return; }
    const path = await open({ multiple: false, filters: [{ name: "SVG 图像", extensions: ["svg"] }] });
    if (typeof path === "string") openSvgSource(await invoke<string>("read_svg", { path }));
  };

  const openSvgSource = (content: string) => {
    try {
      const next = parseSvgDocument(content);
      setDocument(next); setSource(content); setSourceMode(false); setSourceError(null);
      selectOnly(null); setSelectedConnectionId(null); setPast([]); setFuture([]);
      setStatus(next.shapes.length > 1 ? `SVG 已打开，可单独编辑 ${next.shapes.length} 个元素` : "SVG 已打开");
    } catch (error) { window.alert(error instanceof Error ? error.message : "SVG 打开失败"); }
  };

  const toggleSourceMode = () => {
    if (!sourceMode) {
      const nextSource = stripEditorMetadata(serializeSvgDocument(document));
      sourceSnapshot.current = nextSource; setSource(nextSource); setSourceError(null); setSourceMode(true); return;
    }
    if (source === sourceSnapshot.current) { setSourceMode(false); return; }
    try {
      const content = stripEditorMetadata(source);
      const next = parseSvgDocument(content);
      setPast((items) => [...items.slice(-99), document]); setFuture([]); setDocument(next);
      setSource(content); selectOnly(null); setSelectedConnectionId(null); setSourceError(null); setSourceMode(false); setStatus("SVG 源码已应用");
    } catch (error) { setSourceError(error instanceof Error ? error.message : "SVG 源码无效"); }
  };

  const formatSource = async () => {
    try {
      parseSvgDocument(source);
      const [{ format }, { default: xmlPlugin }] = await Promise.all([import("prettier/standalone"), import("@prettier/plugin-xml")]);
      setSource(await format(source, { parser: "xml", plugins: [xmlPlugin], tabWidth: 2, printWidth: 120, xmlWhitespaceSensitivity: "preserve" }));
      setSourceError(null); setStatus("SVG 源码已格式化");
    } catch (error) { setSourceError(error instanceof Error ? error.message : "SVG 源码无效"); }
  };

  const addImportedSvg = (content: string, split = false) => {
    try {
      const shapes = split ? createImportedSvgParts(content, document.shapes.length) : [createImportedSvg(content, document.shapes.length)];
      commit((next) => ({ ...next, shapes: [...next.shapes, ...shapes] }));
      selectOnly(shapes[0].id);
      setStatus(split ? `SVG 已拆分为 ${shapes.length} 个可单独编辑的元素` : "SVG 已作为整体对象导入，可在属性面板继续拆分");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "SVG 导入失败");
    }
  };

  const importSvg = async (split = false) => {
    if (!isTauri()) { splitImport.current = split; window.document.getElementById("svg-file-input")?.click(); return; }
    const path = await open({ multiple: false, filters: [{ name: "SVG 图像", extensions: ["svg"] }] });
    if (typeof path === "string") addImportedSvg(await invoke<string>("read_svg", { path }), split);
  };

  return (
    <div className={`app-shell${leftPanelCollapsed ? " left-collapsed" : ""}${rightPanelCollapsed ? " right-collapsed" : ""}`} onPointerMove={onLibraryPointerMove} onPointerUp={onLibraryPointerUp}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><WandSparkles size={18} /></span>
          <div className="brand-text"><strong>Rust SVG Editor</strong><small>{document.name}</small></div>
        </div>
        <div className="toolbar">
          <div className="tool-group">
            <ToolButton title="新建" onClick={newDocument}><FilePlus2 /></ToolButton>
            <ToolButton title="打开 SVG" onClick={openDocument}><FolderOpen /></ToolButton>
            <ToolButton title="保存 SVG" onClick={saveDocument}><Save /></ToolButton>
          </div>
          <div className="tool-group">
            <ToolButton title={sourceMode ? "应用源码并返回可视化编辑" : "编辑 SVG 源码"} active={sourceMode} onClick={toggleSourceMode}><Code2 /></ToolButton>
            <ToolButton title="导入为整体对象" onClick={() => importSvg(false)}><FileInput /></ToolButton>
            <ToolButton title="拆分导入（逐个元素）" onClick={() => importSvg(true)}><Ungroup /></ToolButton>
          </div>
          <div className="tool-group">
            <ToolButton title="连接线" active={connectMode} onClick={() => { setConnectMode((value) => !value); setConnectionStart(null); setStatus(connectMode ? "已退出连线模式" : "请选择连接线的起点"); }}><Link2 /></ToolButton>
          </div>
          <div className="tool-group">
            <ToolButton title="撤销" onClick={undo} disabled={!past.length}><Undo2 /></ToolButton>
            <ToolButton title="重做" onClick={redo} disabled={!future.length}><Redo2 /></ToolButton>
          </div>
          <div className="tool-group">
            <ToolButton title="另存为 SVG" onClick={saveDocument}><Download /></ToolButton>
          </div>
          <div className="export-controls">
            <select aria-label="导出图片格式" value={exportFormat} disabled={exportState === "exporting"} onChange={(event) => setExportFormat(event.target.value as ExportFormat)}>
              <option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option>
            </select>
            <label><input aria-label="导出 DPI" type="number" min="1" max="2400" step="1" value={exportDpi} disabled={exportState === "exporting"} onChange={(event) => setExportDpi(Number(event.target.value))} /><span>DPI</span></label>
            <button type="button" onClick={exportImage} disabled={exportState === "exporting"} aria-busy={exportState === "exporting"}>{exportState === "exporting" ? <LoaderCircle className="export-spinner" /> : <Download size={15} />} {exportState === "exporting" ? "正在导出…" : "导出图片"}</button>
          </div>
        </div>
        <button className="primary-button" onClick={saveDocument}><Save size={16} /> 保存 SVG</button>
      </header>

      <aside className={`left-panel${leftPanelCollapsed ? " collapsed" : ""}`}>
        <div className="panel-heading">
          <span className="panel-heading-icon"><Boxes size={16} /></span>
          <div className="panel-heading-text"><strong>元素库</strong><small>拖拽到画布，或单击添加</small></div>
          <button type="button" className="panel-collapse-button" title="收起元素库" aria-label="收起元素库" onClick={() => setLeftPanelCollapsed(true)}><ChevronLeft /></button>
        </div>
        <div className="library-search">
          <Search size={14} />
          <input
            type="search"
            value={libraryQuery}
            placeholder="搜索元素，如 判断"
            aria-label="搜索元素"
            onChange={(event) => setLibraryQuery(event.target.value)}
          />
          {libraryQuery && <button type="button" className="search-clear" title="清空搜索" onClick={() => setLibraryQuery("")}><X size={13} /></button>}
        </div>
        <ElementLibrary
          query={libraryQuery}
          recentIds={recentIds}
          collapsed={collapsedGroups}
          onToggleGroup={(id) => setCollapsedGroups((state) => ({ ...state, [id]: !state[id] }))}
          onAdd={addLibraryItemFromClick}
          onPointerDown={onLibraryPointerDown}
        />
        <div className="tip-card"><MousePointer2 size={18} /><p>拖动元素到画布可定位放置，或单击添加到当前画布。</p></div>
        <LayerList shapes={document.shapes} selectedIds={selectedIds} onSelect={(id, additive) => {
          setSelectedConnectionId(null);
          if (additive) toggleSelected(id); else selectOnly(id);
        }} />
      </aside>

      <main ref={workspaceRef} className={`workspace${sourceMode ? " source-workspace" : ""}`} onWheel={sourceMode ? undefined : onWorkspaceWheel} onPointerMove={sourceMode ? undefined : onPointerMove} onPointerUp={sourceMode ? undefined : onPointerUp}>
        {leftPanelCollapsed && <button type="button" className="sidebar-restore sidebar-restore-left" title="展开元素库" aria-label="展开元素库" onClick={() => setLeftPanelCollapsed(false)}><ChevronRight /></button>}
        {rightPanelCollapsed && <button type="button" className="sidebar-restore sidebar-restore-right" title="展开属性栏" aria-label="展开属性栏" onClick={() => setRightPanelCollapsed(false)}><ChevronLeft /></button>}
        {sourceMode ? <div className="source-editor">
          <div className="source-actions"><span>SVG 源码（已隐藏编辑元数据）</span><button onClick={formatSource}><WandSparkles size={15} /> 格式化</button></div>
          <CodeMirror aria-label="SVG 源码" value={source} height="100%" theme={oneDark} extensions={[xml()]} onChange={(value) => { setSource(value); setSourceError(null); }} />
          {sourceError && <div className="source-error">{sourceError}</div>}
        </div> :
        <div className={`canvas-wrap${canvasSelected ? " selected" : ""}`} style={{ width: document.width * zoom, height: document.height * zoom }}>
          <svg ref={canvasRef} className={`canvas${connectMode ? " connect-mode" : ""}`} width={document.width * zoom} height={document.height * zoom} viewBox={`0 0 ${document.width} ${document.height}`} onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove} onPointerUp={onCanvasPointerUp}>
            <defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e8ebf1" strokeWidth="1" /></pattern><marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker></defs>
            <rect width="100%" height="100%" fill={document.background} />
            <rect width="100%" height="100%" fill="url(#grid)" />
            {document.connections.map((connection) => <ConnectionNode key={connection.id} connection={connection} shapes={document.shapes} selected={connection.id === selectedConnectionId} onSelect={(event) => { event.stopPropagation(); setCanvasSelected(false); setSelectedConnectionId(connection.id); selectOnly(null); }} />)}
            {document.shapes.map((shape) => <ShapeNode key={shape.id} shape={shape} zoom={zoom} selected={selectedIds.includes(shape.id)} primary={shape.id === selectedId} connectionStart={shape.id === connectionStart} onPointerDown={onPointerDown} onResizePointerDown={onResizePointerDown} onRotatePointerDown={onRotatePointerDown} />)}
            {marqueeBox && <MarqueeOverlay box={marqueeBox} />}
          </svg>
          {canvasSelected && ctrlPressed && <>{(["n", "e", "s", "w", "nw", "ne", "se", "sw"] as ResizeHandle[]).map((handle) => <button key={handle} type="button" className={`canvas-resize-handle canvas-resize-${handle}`} title="拖动调整画布大小" aria-label={`从${handle}方向调整画布大小`} onPointerDown={(event) => onCanvasResizePointerDown(event, handle)} onPointerMove={onCanvasResizePointerMove} onPointerUp={onCanvasResizePointerUp} onPointerCancel={onCanvasResizePointerUp} />)}</>}
        </div>}
      </main>

      <aside className={`right-panel${rightPanelCollapsed ? " collapsed" : ""}`}>
        <div className="panel-heading">
          <span className="panel-heading-icon"><Palette size={16} /></span>
          <div className="panel-heading-text"><strong>属性</strong><small>{selected ? `${shapeTypeLabel(selected)} · 图形属性` : selectedConnection ? "连接线属性" : selectedShapes.length > 1 ? `已选择 ${selectedShapes.length} 个元素` : canvasSelected ? "画布属性" : "未选择对象"}</small></div>
          <button type="button" className="panel-collapse-button" title="收起属性栏" aria-label="收起属性栏" onClick={() => setRightPanelCollapsed(true)}><ChevronRight /></button>
        </div>
        {selected ? <Properties shape={selected} update={updateSelected} remove={removeSelected} split={splitSelectedShape} /> : selectedConnection ? <ConnectionProperties connection={selectedConnection} update={updateSelectedConnection} remove={removeSelected} /> : selectedShapes.length > 1 ? <MultiSelectionProperties shapes={selectedShapes} update={updateSelection} remove={removeSelected} /> : canvasSelected ? <CanvasProperties document={document} zoom={zoom} updateSize={updateCanvasSize} /> : <div className="empty-state"><span className="empty-icon"><MousePointer2 size={22} /></span><strong>未选择对象</strong><span>点击画布或图形开始编辑</span></div>}
      </aside>

      <footer className="statusbar">
        <span className="status-message" aria-live="polite"><span className={`status-dot ${exportState}`} />{status}</span>
        <span className="status-meta"><span>{document.shapes.length} 个图形</span><span className="meta-separator" /><span>{document.connections.length} 条连接线</span></span>
        <div className="zoom">
          <button type="button" title="缩小" onClick={() => changeZoom(zoom / 1.1)}><ZoomOut /></button>
          <input className="zoom-range" type="range" min="10" max="400" value={Math.round(zoom * 100)} aria-label="缩放比例" onChange={(event) => changeZoom(Number(event.target.value) / 100)} />
          <button type="button" title="放大" onClick={() => changeZoom(zoom * 1.1)}><ZoomIn /></button>
          <button type="button" className="zoom-value" title="恢复 100%" onClick={() => changeZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button type="button" title="适应画布" onClick={fitCanvas}><Maximize2 /></button>
        </div>
      </footer>
      {libraryDragPreview?.moved && <div className="library-drag-preview" style={{ left: libraryDragPreview.x, top: libraryDragPreview.y }} dangerouslySetInnerHTML={{ __html: libraryItemMarkup(libraryDragPreview.item) }} />}
      <input id="file-input" hidden type="file" accept=".svg,image/svg+xml" onChange={async (event) => { const file = event.target.files?.[0]; if (file) openSvgSource(await file.text()); event.target.value = ""; }} />
      <input id="svg-file-input" hidden type="file" accept=".svg,image/svg+xml" onChange={async (event) => { const file = event.target.files?.[0]; if (file) addImportedSvg(await file.text(), splitImport.current); event.target.value = ""; }} />
    </div>
  );
}

function ToolButton({ title, onClick, disabled, active, children }: { title: string; onClick: () => void; disabled?: boolean; active?: boolean; children: React.ReactNode }) {
  return <button type="button" className={`icon-button${active ? " active" : ""}`} aria-label={title} data-tooltip={title} onClick={onClick} disabled={disabled}>{children}</button>;
}

const shapeKindLabels: Record<ShapeKind, string> = { rectangle: "矩形", ellipse: "椭圆", diamond: "菱形", text: "文字", importedSvg: "SVG" };

function shapeTypeLabel(shape: Shape): string {
  return shape.kind === "importedSvg" ? svgElementType(shape.svgContent) : shapeKindLabels[shape.kind];
}

function CanvasProperties({ document, zoom, updateSize }: { document: DocumentModel; zoom: number; updateSize: (width: number, height: number) => void }) {
  const [width, setWidth] = useState(String(document.width));
  const [height, setHeight] = useState(String(document.height));

  useEffect(() => { setWidth(String(document.width)); }, [document.width]);
  useEffect(() => { setHeight(String(document.height)); }, [document.height]);

  const apply = () => {
    const nextWidth = Math.round(Number(width));
    const nextHeight = Math.round(Number(height));
    if (!Number.isFinite(nextWidth) || !Number.isFinite(nextHeight) || nextWidth < 1 || nextHeight < 1 || nextWidth > 100000 || nextHeight > 100000) {
      window.alert("画布宽高必须是 1 至 100000 之间的数字");
      return;
    }
    updateSize(nextWidth, nextHeight);
  };

  return <div className="canvas-properties">
    <section>
      <h3>画布尺寸</h3>
      <p>输入精确尺寸，或按住 Ctrl 后拖动画布边缘与四角。已有图形的位置和尺寸保持不变。</p>
      <div className="canvas-size-fields">
        <label><span>宽度</span><input type="number" min="1" max="100000" step="1" value={width} onChange={(event) => setWidth(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") apply(); }} /></label>
        <label><span>高度</span><input type="number" min="1" max="100000" step="1" value={height} onChange={(event) => setHeight(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") apply(); }} /></label>
      </div>
      <button type="button" onClick={apply}>应用画布尺寸</button>
    </section>
    <dl className="document-summary">
      <div><dt>图形数量</dt><dd>{document.shapes.length}</dd></div>
      <div><dt>连接线</dt><dd>{document.connections.length}</dd></div>
      <div><dt>缩放比例</dt><dd>{Math.round(zoom * 100)}%</dd></div>
    </dl>
  </div>;
}

function shapeKindIcon(kind: ShapeKind) {
  if (kind === "ellipse") return <Circle />;
  if (kind === "diamond") return <Diamond />;
  if (kind === "text") return <Type />;
  if (kind === "importedSvg") return <FileInput />;
  return <Square />;
}

function ElementLibrary({ query, recentIds, collapsed, onToggleGroup, onAdd, onPointerDown }: {
  query: string;
  recentIds: string[];
  collapsed: Record<string, boolean>;
  onToggleGroup: (id: string) => void;
  onAdd: (item: LibraryItem) => void;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>, item: LibraryItem) => void;
}) {
  const searching = query.trim().length > 0;
  const recent = recentIds
    .map((id) => libraryItemById(id))
    .filter((item): item is LibraryItem => Boolean(item));
  const groups = libraryGroups
    .map((group) => ({ group, items: libraryItems.filter((item) => item.group === group.id && matchesLibraryQuery(item, query)) }))
    .filter((entry) => entry.items.length > 0);
  const total = groups.reduce((sum, entry) => sum + entry.items.length, 0);

  const renderGrid = (items: LibraryItem[]) => <div className="library-grid">
    {items.map((item) => <button
      key={item.id}
      type="button"
      className="shape-card"
      aria-label={item.label}
      title={item.action === "import" ? "拆分导入 SVG 文件，逐元素编辑" : `${item.label} · 拖拽到画布或单击添加`}
      onPointerDown={(event) => onPointerDown(event, item)}
      onClick={() => onAdd(item)}
    >
      <span className="shape-card-icon" dangerouslySetInnerHTML={{ __html: libraryItemMarkup(item) }} />
      <span>{item.label}</span>
    </button>)}
  </div>;

  return <div className="library">
    {!searching && recent.length > 0 && <div className="library-group">
      <div className="library-group-header static">
        <span className="library-group-label">最近使用</span>
        <span className="library-group-count">{recent.length}</span>
      </div>
      {renderGrid(recent)}
    </div>}
    {groups.map(({ group, items }) => {
      const isCollapsed = !searching && Boolean(collapsed[group.id]);
      return <div key={group.id} className={`library-group${isCollapsed ? " collapsed" : ""}`}>
        <button type="button" className="library-group-header" aria-expanded={!isCollapsed} title={group.hint} onClick={() => onToggleGroup(group.id)}>
          <ChevronDown size={13} />
          <span className="library-group-label">{group.label}</span>
          <span className="library-group-count">{items.length}</span>
        </button>
        {!isCollapsed && renderGrid(items)}
      </div>;
    })}
    {total === 0 && <p className="library-empty">没有匹配「{query.trim()}」的元素，试试「判断」「箭头」或「text」。</p>}
  </div>;
}

function layerName(shape: Shape) {
  const text = (shape.text ?? "").trim();
  if (text) return text;
  return shape.kind === "importedSvg" ? "导入的 SVG" : "未命名图形";
}

function LayerList({ shapes, selectedIds, onSelect }: { shapes: Shape[]; selectedIds: string[]; onSelect: (id: string, additive: boolean) => void }) {
  return <section className="layers">
    <div className="layers-header"><span><Layers size={12} /> 图层</span><span className="badge">{shapes.length}</span></div>
    {shapes.length === 0
      ? <p className="layers-empty">画布还是空的，从上方图形库添加第一个图形。</p>
      : <ul className="layer-list">
        {shapes.map((shape) => <li key={shape.id}>
          <button type="button" className={`layer-item${selectedIds.includes(shape.id) ? " active" : ""}`} aria-pressed={selectedIds.includes(shape.id)} onClick={(event) => onSelect(shape.id, event.ctrlKey || event.metaKey || event.shiftKey)} title={layerName(shape)}>
            <span className="layer-thumb">{shapeKindIcon(shape.kind)}</span>
            <span className="layer-name">{layerName(shape)}</span>
            <span className="layer-kind">{shapeKindLabels[shape.kind] ?? "图形"}</span>
          </button>
        </li>)}
      </ul>}
  </section>;
}

function ShapeNode({ shape, zoom, selected, primary, connectionStart, onPointerDown, onResizePointerDown, onRotatePointerDown }: { shape: Shape; zoom: number; selected: boolean; primary: boolean; connectionStart: boolean; onPointerDown: (event: React.PointerEvent, shape: Shape) => void; onResizePointerDown: (event: React.PointerEvent, shape: Shape, handle: ResizeHandle) => void; onRotatePointerDown: (event: React.PointerEvent, shape: Shape) => void }) {
  const transform = `rotate(${shape.rotation} ${shape.x + shape.width / 2} ${shape.y + shape.height / 2})`;
  const common = { fill: shape.fill, stroke: shape.stroke, strokeWidth: shape.strokeWidth, transform };
  const controlScale = 1 / zoom;
  const selectionPadding = 4 * controlScale;
  const handleSize = 10 * controlScale;
  const rotationLineEnd = shape.y - 30 * controlScale;
  const rotationHandleY = shape.y - 34 * controlScale;
  return <g className="shape-node" onPointerDown={(event) => onPointerDown(event, shape)}>
    {shape.kind === "rectangle" && <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx="8" {...common} />}
    {shape.kind === "ellipse" && <ellipse cx={shape.x + shape.width / 2} cy={shape.y + shape.height / 2} rx={shape.width / 2} ry={shape.height / 2} {...common} />}
    {shape.kind === "diamond" && <polygon points={`${shape.x + shape.width / 2},${shape.y} ${shape.x + shape.width},${shape.y + shape.height / 2} ${shape.x + shape.width / 2},${shape.y + shape.height} ${shape.x},${shape.y + shape.height / 2}`} {...common} />}
    {shape.kind === "text" && <text x={shape.x + shape.width / 2} y={shape.y + shape.height / 2} transform={transform} textAnchor="middle" dominantBaseline="middle" style={{ fill: shape.fill, fontSize: Math.max(8, shape.height * 0.62) }}>{shape.text}</text>}
    {shape.kind === "importedSvg" && shape.svgContent && <image href={svgDataUri(shape.svgContent)} x={shape.x} y={shape.y} width={shape.width} height={shape.height} transform={transform} preserveAspectRatio={shape.stretch ? "none" : "xMidYMid meet"} />}
    {shape.kind !== "importedSvg" && shape.kind !== "text" && <text x={shape.x + shape.width / 2} y={shape.y + shape.height / 2} transform={transform} textAnchor="middle" dominantBaseline="middle">{shape.text}</text>}
    {shape.kind === "importedSvg" && shape.showText && <text x={shape.x + shape.width / 2} y={shape.y + shape.height / 2} transform={transform} textAnchor="middle" dominantBaseline="middle">{shape.text}</text>}
    {connectionStart && <rect className="connection-start-box" x={shape.x - 7 * controlScale} y={shape.y - 7 * controlScale} width={shape.width + 14 * controlScale} height={shape.height + 14 * controlScale} transform={transform} />}
    {selected && <g className="selection-controls" transform={transform} onPointerDown={(event) => event.stopPropagation()}>
      <rect className={primary ? "selection-box" : "multi-selection-box"} x={shape.x - selectionPadding} y={shape.y - selectionPadding} width={shape.width + 2 * selectionPadding} height={shape.height + 2 * selectionPadding} />
      {primary && <>
        <line className="rotation-line" x1={shape.x + shape.width / 2} y1={shape.y - selectionPadding} x2={shape.x + shape.width / 2} y2={rotationLineEnd} />
        <circle className="rotation-handle" cx={shape.x + shape.width / 2} cy={rotationHandleY} r={6 * controlScale} onPointerDown={(event) => onRotatePointerDown(event, shape)} />
        {resizeHandles(shape).map(({ handle, x, y }) => <rect key={handle} className={`resize-handle resize-${handle}`} x={x - handleSize / 2} y={y - handleSize / 2} width={handleSize} height={handleSize} rx={2 * controlScale} onPointerDown={(event) => onResizePointerDown(event, shape, handle)} />)}
      </>}
    </g>}
  </g>;
}

function resizeHandles(shape: Shape): Array<{ handle: ResizeHandle; x: number; y: number }> {
  const left = shape.x, centerX = shape.x + shape.width / 2, right = shape.x + shape.width;
  const top = shape.y, centerY = shape.y + shape.height / 2, bottom = shape.y + shape.height;
  return [
    { handle: "nw", x: left, y: top }, { handle: "n", x: centerX, y: top }, { handle: "ne", x: right, y: top },
    { handle: "e", x: right, y: centerY }, { handle: "se", x: right, y: bottom }, { handle: "s", x: centerX, y: bottom },
    { handle: "sw", x: left, y: bottom }, { handle: "w", x: left, y: centerY },
  ];
}

function MarqueeOverlay({ box }: { box: MarqueeState }) {
  const rect = marqueeBounds(box);
  return <rect className="marquee-box" x={rect.x} y={rect.y} width={rect.width} height={rect.height} />;
}

function marqueeBounds(state: MarqueeState): Rect {
  return {
    x: Math.min(state.startX, state.currentX),
    y: Math.min(state.startY, state.currentY),
    width: Math.abs(state.currentX - state.startX),
    height: Math.abs(state.currentY - state.startY),
  };
}

function rectsIntersect(a: Rect, b: Rect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function sameIds(a: string[], b: string[]) {
  return a.length === b.length && a.every((id) => b.includes(id));
}

function ConnectionNode({ connection, shapes, selected, onSelect }: { connection: Connection; shapes: Shape[]; selected: boolean; onSelect: (event: React.PointerEvent) => void }) {
  const from = shapes.find((shape) => shape.id === connection.fromId);
  const to = shapes.find((shape) => shape.id === connection.toId);
  if (!from || !to) return null;
  const [start, end] = connectionPoints(from, to);
  return <g className={`connection-node${selected ? " selected" : ""}`} onPointerDown={onSelect}>
    <line className="connection-hit-area" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
    <line className="connection-line" x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={connection.stroke} strokeWidth={connection.strokeWidth} markerEnd="url(#arrowhead)" />
  </g>;
}

function connectionPoints(from: Shape, to: Shape): [{ x: number; y: number }, { x: number; y: number }] {
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  return [boundaryPoint(from, toCenter.x - fromCenter.x, toCenter.y - fromCenter.y), boundaryPoint(to, fromCenter.x - toCenter.x, fromCenter.y - toCenter.y)];
}

function boundaryPoint(shape: Shape, dx: number, dy: number): { x: number; y: number } {
  const center = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
  if (!dx && !dy) return center;
  const scale = Math.min(shape.width / 2 / Math.max(Math.abs(dx), .001), shape.height / 2 / Math.max(Math.abs(dy), .001));
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

function Properties({ shape, update, remove, split }: { shape: Shape; update: (patch: Partial<Shape>) => void; remove: () => void; split: () => void }) {
  const numberField = (label: string, key: "x" | "y" | "width" | "height" | "rotation") => <label><span>{label}</span><input type="number" value={Math.round(shape[key])} onChange={(e) => update({ [key]: Number(e.target.value) })} /></label>;
  return <div className="properties">
    <div className="element-type-card">
      <span className="element-type-icon">{shapeKindIcon(shape.kind)}</span>
      <span><small>元素类型</small><strong>{shapeTypeLabel(shape)}</strong></span>
    </div>
    {shape.kind === "importedSvg"
      ? <section>
        <h3>{shape.showText ? "元素" : "导入的 SVG"}</h3>
        <p className="property-note">{shape.showText ? "元素库形状，可改文字、颜色与尺寸，也可继续拆分为独立元素。" : "已作为独立元素选中，可移动、缩放、改颜色，也可以继续拆分为更小的元素。"}</p>
        {(hasSvgText(shape.svgContent) || shape.showText) && <label className="wide"><span>文字内容</span><input value={shape.text} onChange={(e) => update({ text: e.target.value })} /></label>}
        <button type="button" className="secondary-button" onClick={split}><Ungroup size={15} /> 拆分为独立元素</button>
      </section>
      : <section><h3>文本</h3><label className="wide"><span>内容</span><input value={shape.text} onChange={(e) => update({ text: e.target.value })} /></label></section>}
    <section><h3>位置与尺寸</h3><div className="field-grid">{numberField("X", "x")}{numberField("Y", "y")}{numberField("宽", "width")}{numberField("高", "height")}</div>{numberField("旋转", "rotation")}</section>
    <section><h3>外观</h3><label><span>填充</span><input type="color" value={solidColor(shape.fill)} onChange={(e) => update({ fill: e.target.value })} /></label><label><span>描边</span><input type="color" value={solidColor(shape.stroke)} onChange={(e) => update({ stroke: e.target.value })} /></label><label><span>线宽</span><input type="number" min="0" max="20" value={shape.strokeWidth} onChange={(e) => update({ strokeWidth: Number(e.target.value) })} /></label></section>
    <button className="danger-button" onClick={remove}><Trash2 size={16} /> 删除图形</button>
  </div>;
}

/** 多选时的批量属性面板：只提供能作用到全部选中元素的字段。 */
function MultiSelectionProperties({ shapes, update, remove }: { shapes: Shape[]; update: (patch: Partial<Shape>) => void; remove: () => void }) {
  const first = shapes[0];
  return <div className="properties">
    <section>
      <h3>多选</h3>
      <p className="property-note">已选中 {shapes.length} 个元素。拖动任一元素可整体移动，按住 Ctrl（或 Shift）点击可增减选择。</p>
    </section>
    <section><h3>外观</h3>
      <label><span>填充</span><input type="color" value={solidColor(first.fill)} onChange={(event) => update({ fill: event.target.value })} /></label>
      <label><span>描边</span><input type="color" value={solidColor(first.stroke)} onChange={(event) => update({ stroke: event.target.value })} /></label>
      <label><span>线宽</span><input type="number" min="0" max="20" value={first.strokeWidth} onChange={(event) => update({ strokeWidth: Number(event.target.value) })} /></label>
    </section>
    <button className="danger-button" onClick={remove}><Trash2 size={16} /> 删除 {shapes.length} 个图形</button>
  </div>;
}

/** color 输入框只接受 #rrggbb，导入部件可能带 none/渐变等取值。 */
function solidColor(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff";
}

function ConnectionProperties({ connection, update, remove }: { connection: Connection; update: (patch: Partial<Connection>) => void; remove: () => void }) {
  return <div className="properties">
    <section><h3>连接线</h3><p className="property-note">连接线会在控件移动或调整大小时自动跟随。</p></section>
    <section><h3>外观</h3><label><span>颜色</span><input type="color" value={connection.stroke} onChange={(event) => update({ stroke: event.target.value })} /></label><label><span>线宽</span><input type="number" min="1" max="20" value={connection.strokeWidth} onChange={(event) => update({ strokeWidth: Number(event.target.value) })} /></label></section>
    <button className="danger-button" onClick={remove}><Trash2 size={16} /> 删除连接线</button>
  </div>;
}

/** 导入的 SVG 是靠 svgContent 渲染的，改颜色/文字时需要同步改写内部元素。 */
function withPaintPatch(shape: Shape, patch: Partial<Shape>): Shape {
  const next = { ...shape, ...patch };
  if (shape.kind !== "importedSvg" || !shape.svgContent) return next;
  const recolor: { fill?: string; stroke?: string; strokeWidth?: number } = {};
  if (patch.fill !== undefined) recolor.fill = next.fill;
  if (patch.stroke !== undefined) recolor.stroke = next.stroke;
  if (patch.strokeWidth !== undefined && Number.isFinite(patch.strokeWidth)) recolor.strokeWidth = next.strokeWidth;
  if (Object.keys(recolor).length) {
    try {
      next.svgContent = recolorSvgContent(shape.svgContent, recolor);
    } catch {
      next.svgContent = shape.svgContent;
    }
  }
  if (patch.text !== undefined && patch.text !== shape.text && hasSvgText(next.svgContent)) {
    try {
      next.svgContent = replaceSvgText(next.svgContent ?? "", patch.text);
    } catch {
      // 该部件没有可直接改写的文字节点时保持原内容
    }
  }
  return next;
}

/** 部件内是否含有可编辑的文字节点。 */
function hasSvgText(content: string | undefined): boolean {
  return /<text[\s>]/.test(content ?? "");
}

function downloadBlob(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}
