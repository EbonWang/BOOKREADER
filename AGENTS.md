# AGENTS.md

## 项目是什么

一个**原生桌面端**电子书阅读器应用，基于 **Electron**，运行于 Windows，打包产物为 EXE。

当前范围（严格以此为准）：

- 导入本地 **TXT** 与 **EPUB** 电子书
- 渲染正文供阅读
- 通过**目录面板切换章节**

## 怎么跑起来

```bash
npm install     # 安装依赖
npm start       # 启动桌面应用
npm test        # 运行单元测试（node:test）
npm run dist    # 打包 Windows EXE 到 dist/
```

若 Electron 下载缓慢，先配置镜像源再安装/打包：

```bash
# Windows PowerShell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
```

## 硬性约定

### 技术栈

- **Electron**（主进程 + 预加载 + 渲染进程），**不做网页端、不做纯前端页面**。
- 仅用 Node 内置能力 + `jszip`（解压 EPUB）+ `fast-xml-parser`（解析 EPUB 内部 XML）。
- 测试用 Node 内置 `node:test` + `node:assert`，**不引入第三方测试框架**。
- 不引入 UI 框架（React / Vue 等）与构建工具（Vite / webpack 等），渲染层用原生 HTML/CSS/JS。

### 安全

- 主进程必须开启 `contextIsolation: true`、`nodeIntegration: false`。
- 渲染进程只能通过 `preload.js` 中 `contextBridge` 暴露的白名单 API 访问系统能力。
- 禁止在渲染进程直接 `require` Node 模块或做文件 IO。

### 目录结构

```
src/main/index.js        主进程：窗口、文件对话框、IPC
src/main/preload.js      contextBridge 受控 API
src/main/bookParser.js   TXT/EPUB 解析（纯函数，可单测）
src/renderer/            index.html / styles.css / app.js
tests/parser.test.js     单元测试
PRD.md / TECH_DESIGN.md  产品与技术文档
```

解析逻辑必须集中在 `src/main/bookParser.js`，保持为**纯函数**（入参 Buffer/字符串，出参数据对象），便于单测；不得把解析逻辑散落到渲染层。

### 代码风格

- 主进程、预加载脚本、解析模块、测试统一使用 **CommonJS**（`require` / `module.exports`）。Electron 对主进程与 preload 的 ESM 支持存在版本差异，统一用 CommonJS 最稳定；`package.json` **不要**设置 `"type": "module"`。
- 渲染层用普通 `<script>`，不引入打包工具与框架。
- 2 空格缩进，语句末尾加分号。
- 函数与变量使用 `camelCase`，常量使用 `UPPER_SNAKE_CASE`。
- 每个导出函数写简短 JSDoc，说明入参与返回。
- 错误信息用中文，便于定位问题。

### 功能边界（红线）

除「TXT/EPUB 导入、正文阅读、目录切换章节」外，**不得添加任何多余功能**。明确禁止：

主题换肤 / 背景色切换、阅读进度记忆、书签、笔记标注、全文搜索、字体与排版设置、听书 TTS、PDF 等其它格式、云同步、账号、任何后端服务。

新增需求前，必须先修订 `PRD.md`，再改 `TECH_DESIGN.md`，最后才动代码。

### 每次改动后的强制流程

1. **Git 保存版本**：完成一个可运行的小改动后，立即 `git add -A` 并提交，提交信息用中文简述改动（如 `feat: 新增 EPUB 导入支持`）。不要等全部做完才提交。
2. **编写或更新测试**：改动涉及解析逻辑（TXT 分章、EPUB 解析、`href` 路径处理等）时，必须在 `tests/parser.test.js` 中新增或更新对应用例。
3. **交付前验证**：交付给用户前，必须执行 `npm test`，**确保所有测试全部通过**；测试未通过不得交付。

### 文档同步

- 功能范围、`Out of Scope`、验收标准以 `PRD.md` 为准。
- 技术选型、数据模型、解析方案以 `TECH_DESIGN.md` 为准。
- 改动导致文档描述与实际不符时，同步更新对应文档。
