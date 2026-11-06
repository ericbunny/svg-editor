# Rust SVG Editor

基于 Rust、Tauri 2、React 和原生 SVG DOM 的可视化编辑器初版。

## 当前功能

- 添加矩形、椭圆和判断图形
- 选择和拖动画布图形
- 多选：空白处拖拽框选（可 `Shift`/`Ctrl` 追加），`Ctrl/Command`（或 `Shift`）+ 点击增减元素，`Esc` 取消选择
- 多选后整体拖动、批量修改填充/描边/线宽或一键删除
- 使用八向手柄调整控件大小，并通过旋转手柄调整角度
- 在控件之间创建可自动跟随的箭头连接线
- 编辑文本、位置、尺寸、旋转、填充和描边
- 撤销、重做和删除图形
- 缩放画布
- 支持缩放按钮、适应画布及 `Ctrl/Command + 滚轮` 定点缩放
- 直接打开和保存标准 `.svg` 文件
- 使用可视化模式或带 XML 语法高亮、行号和格式化功能的 SVG 源码模式编辑同一份文档
- 在源码无效时保留编辑缓冲区并阻止覆盖有效画布
- 导入并整体编辑已有 SVG 文件
- 按原 SVG 图组拆分为多个可独立编辑的部件
- 在 SVG `<metadata>` 中保存连接关系等编辑器语义
- 桌面应用和浏览器开发模式

## 启动桌面应用

```powershell
cd crates/svg-editor
npm install
npm run tauri dev
```

## 启动浏览器开发模式

```powershell
cd crates/svg-editor
npm run dev
```

浏览器访问 `http://localhost:1420`。浏览器模式使用下载和文件选择完成 SVG 保存和打开。

## 文件格式说明

SVG 是应用的主文档格式，不再要求使用私有工程文件。应用创建的 SVG 在标准图形元素之外使用 `<metadata id="svg-editor-document">` 保存可视化编辑所需的连接关系和对象属性；其他 SVG 阅读器会忽略这些元数据并正常显示图形。

没有编辑器元数据的第三方 SVG 会作为一个可整体移动、缩放和旋转的对象打开。源码模式可查看和修改完整 SVG；只有通过 XML 和 SVG 根元素校验的源码才能提交回可视化模式。源码发生结构性修改后会移除可能过期的编辑元数据，并在可视化模式中作为整体 SVG 对象继续编辑。

Visio 当前可通过其导出的 SVG 与本应用交换文件。原生 VSDX/VSD 导入尚未实现，后续将作为文件格式适配器接入，不改变 SVG 主文档模型。

## 构建发布包

Windows 构建环境需要安装 Node.js、Rust stable、Microsoft C++ 生成工具和 WebView2。首次构建先安装锁定版本的前端依赖：

```powershell
cd crates/svg-editor
npm ci
npm run tauri build
```

安装包生成在工作区根目录的 `target/release/bundle` 下，其中 `msi` 和 `nsis` 目录分别包含 MSI 与 EXE 安装包。发布时选择其中一种安装包即可，不需要单独分发字体文件。

SVG 导出会加载目标系统已有字体，并将 `assets/fonts/NotoSansSC-Variable.ttf` 作为默认中文回退字体。该字体已通过 `include_bytes!` 编译进程序；其 SIL Open Font License 1.1 许可文件会随安装包分发。

## 验证

```powershell
cargo test -p svg-editor --lib
cargo check -p svg-editor --all-targets
cd crates/svg-editor
npm run build
```
