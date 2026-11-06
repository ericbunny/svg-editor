# 内置字体

`NotoSansSC-Variable.ttf` 是 Google Fonts 发布的 Noto Sans SC 可变字体，采用 SIL Open Font License 1.1 许可。

- 字体来源：https://github.com/google/fonts/tree/main/ofl/notosanssc
- 许可文件：`OFL.txt`
- 用途：作为 SVG 文字渲染的默认字体和系统字体缺失时的中文回退字体

字体通过 Rust 的 `include_bytes!` 编译进程序，不依赖目标计算机预装该字体。系统字体仍会被加载，以兼容 SVG 中明确指定的其他字体。
