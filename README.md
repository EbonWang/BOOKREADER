# 阅读器

原生桌面端电子书阅读器，基于 Electron，运行于 Windows，可打包为 EXE。

## 功能

- 导入本地 **TXT** 与 **EPUB** 电子书
- 渲染正文进行阅读
- 通过**目录面板切换章节**
  - TXT：按「第X章 / Chapter N / 前言后记」等标题正则自动分章
  - EPUB：优先使用书籍原生导航（EPUB3 `nav.xhtml`，回退 EPUB2 `toc.ncx`）

## 运行

```bash
npm install
npm start
```

也可直接双击 `启动阅读器.bat` 运行（首次会自动安装依赖）。

## 测试与打包

```bash
npm test        # 解析逻辑单元测试
npm run dist    # 打包生成 Windows EXE（输出到 dist/）
```

打包若下载缓慢，先配置镜像源：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
```

## 文档

| 文档 | 说明 |
| --- | --- |
| `PRD.md` | 产品需求：功能范围、不做清单、验收标准 |
| `TECH_DESIGN.md` | 技术设计：选型、架构、TXT 分章与 EPUB 解析方案 |
| `AGENTS.md` | 项目约定：技术栈、目录结构、代码风格、改动后流程 |

## 目录结构

```
src/main/       Electron 主进程、预加载脚本、书籍解析
src/renderer/   界面（工具栏 / 目录面板 / 正文区）
tests/          解析逻辑单元测试
```
