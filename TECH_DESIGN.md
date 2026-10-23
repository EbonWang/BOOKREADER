# TECH_DESIGN - 桌面版电子书阅读器技术设计

## 1. 技术选型

### 1.1 应用框架：Electron

| 候选 | 结论 | 理由 |
| --- | --- | --- |
| **Electron** | ✅ 选定 | 生态成熟、社区资料丰富；技术栈契合 Web 技术（HTML/CSS/JS），无需额外系统级工具链；`electron-builder` 可直接产出 Windows EXE，便于分发 |
| Tauri | ❌ 不选 | 产物更轻量，但需额外安装 Rust 工具链与系统依赖，当前部署环境成本更高 |

结论：采用 **Electron** 开发**原生桌面应用**，最终打包为 Windows 可执行的 EXE 文件。应用为纯本地单机程序，**不包含任何后端服务、服务端接口或数据库**。

### 1.2 运行时与依赖

| 依赖 | 用途 |
| --- | --- |
| `electron` | 桌面应用运行时（devDependency） |
| `jszip` | 解压 EPUB（本质为 ZIP 容器），读取内部 XML / XHTML |
| `fast-xml-parser` | 解析 EPUB 内的 `container.xml` / `OPF` / `NCX` / `XHTML` |

解析逻辑不引入重量级电子书框架，只保留「解压 + XML 解析 + 文本抽取」的最小能力，避免不可控的黑盒行为。

测试使用 **Node.js 内置 `node:test` + `node:assert`**，不引入第三方测试框架。

## 2. 整体架构

Electron 标准主进程 / 预加载 / 渲染进程三层结构：

```
┌─────────────────── 主进程 (Node 环境) ───────────────────┐
│ index.js                                                │
│  · 创建 BrowserWindow                                    │
│  · dialog.showOpenDialog 系统文件选择                    │
│  · 读取文件、调用 bookParser 解析                        │
├─────────────────────────────────────────────────────────┤
│ bookParser.js（纯函数，可单测）                          │
│  · parseTxt(buffer)  → { title, format, chapters[] }     │
│  · parseEpub(buffer) → { title, format, chapters[] }     │
└─────────────────────────────────────────────────────────┘
                    │ preload.js（contextBridge，受控 IPC）
┌─────────────────── 渲染进程 (Chromium) ──────────────────┐
│ index.html / styles.css / app.js                         │
│  · 工具栏（导入书籍、书名、格式标签）                     │
│  · 左侧目录面板（点击切换章节）                           │
│  · 右侧正文区（渲染当前章节文本）                         │
└─────────────────────────────────────────────────────────┘
```

关键约定：

- **开启 `contextIsolation`，关闭 `nodeIntegration`**，所有能力经 `preload.js` 的 `contextBridge` 白名单暴露，渲染进程不直接访问 Node API。
- 解析在主进程完成，渲染进程只接收「已解析好的纯数据」，不做文件 IO、不做 ZIP 解压。

## 3. 数据模型

解析统一输出同一结构，渲染层无需区分来源格式：

```js
{
  title: string,        // 书名（TXT 取文件名；EPUB 取 dc:title，缺失回退文件名）
  format: 'txt' | 'epub',
  chapters: [           // 至少 1 项
    { id: string, title: string, content: string }  // content 为纯文本
  ]
}
```

- `content` 统一为**纯文本**，TXT 与 EPUB 走同一套正文渲染，降低渲染层复杂度。
- `chapters` 永不为 0 项：无法分章时退化为单章 `{ id: 'full', title: '全文' }`。

## 4. 核心实现方案

### 4.1 TXT 解析

1. **编码处理**：Buffer → 字符串。先按 UTF-8 解码；若出现替换字符 `U+FFFD` 则回退 GBK（中文 TXT 常见编码），避免乱码（AC-1）。
2. **换行归一**：`\r\n` / `\r` → `\n`。
3. **正则分章**（AC-3）：逐行匹配章节标题，命中则开启新章节。

```
^\\s*(序|序言|前言|引子|楔子|后记|附录|尾声|番外)?
第[0-9零一二三四五六七八九十百千]+[章节回部篇]
^\\s*Chapter\\s+[0-9IVXLC]+
^\\s*[0-9]{1,4}\\s*[.、]\\s*\\S+   （仅当行简短，避免误伤正文）
```

- 标题行本身从正文中剥离，作为章节 `title`。
- 标题行之前的文本归入「开头」章节（若有内容）。
- 无任何命中 → 单章「全文」。

### 4.2 EPUB 解析

EPUB 本质为 ZIP 容器，解析链路：

1. `META-INF/container.xml` → 取 `rootfile` 的 `full-path` → OPF 路径。
2. 解析 OPF：
   - `manifest`：建立 `id → { href, mediaType, properties }` 映射。
   - `spine`：得到阅读顺序 `idref` 列表，作为正文顺序的权威来源。
   - `metadata`：取 `dc:title` 作为书名。
3. 解析目录（AC-4）：
   - **优先 EPUB3**：manifest 中 `properties` 含 `nav` 的条目 → 解析其 `nav[epub:type="toc"]` 下 `<a href>`，得 `{ 标题, href }`。
   - **回退 EPUB2**：manifest 中 `media-type="application/x-dtbncx+xml"` → 解析 `navPoint` 树，取 `navLabel/text` 与 `content@src`。
   - **兜底**：两者皆无 → 用 `spine` 顺序 + 各章节文件的 `<title>` 或 `<h1>` 生成目录。
4. 章节正文抽取：
   - `href` 可能是相对路径且带 `#fragment`，需基于 OPF 所在目录解析为容器内绝对路径，剥离 fragment。
   - 读取该 XHTML → 抽取 `<body>` → 移除 `script` / `style` / `head` → 标签转结构（块级元素间补 `\n`）→ 去标签 → HTML 实体解码 → 压缩 3 个以上连续空行。
   - 若某目录项指向的文件与上一项相同（同文件内锚点跳转），按 fragment 定位，取该位置之后的文本；无法定位时取整文件，保证不丢内容。

### 4.3 目录切换章节

- 渲染进程持有 `book` 对象与 `currentIndex`。
- 点击目录项 → 更新 `currentIndex` → 正文区 `textContent = chapters[i].content` → 滚动区域重置到顶部 → 目录项高亮。
- 不做进度记忆、不做自动定位（Out of Scope AC-8）。

## 5. 目录结构

```
READER/
├── README/                  # 课程原始资料（保留，不参与构建）
├── PRD.md
├── TECH_DESIGN.md
├── AGENTS.md
├── package.json
├── src/
│   ├── main/
│   │   ├── index.js         # Electron 主进程：窗口、文件对话框、IPC
│   │   ├── preload.js       # contextBridge 暴露受控 API
│   │   └── bookParser.js    # TXT / EPUB 解析（纯函数，可单测）
│   └── renderer/
│       ├── index.html
│       ├── styles.css
│       └── app.js
└── tests/
    ├── fixtures/            # 测试用样例（小型 txt / epub）
    └── parser.test.js       # node:test 单元测试
```

## 6. 运行与打包

```bash
npm install          # 安装依赖
npm start            # 启动桌面应用（开发运行）
npm test             # 运行解析逻辑单元测试
npm run dist         # 打包生成 Windows EXE（输出到 dist/）
```

打包注意：Electron 下载依赖国外源，若过慢需配置镜像源（`ELECTRON_MIRROR`，如 npmmirror）后再执行打包命令。

## 7. 风险与决策记录

| 风险 | 应对 |
| --- | --- |
| EPUB 目录结构差异大（EPUB2/3、ncx/nav、相对路径、fragment） | 三级兜底：nav → ncx → spine；路径统一按 OPF 目录解析；fragment 定位失败取整文件 |
| TXT 编码多样导致乱码 | UTF-8 优先，检测到 `U+FFFD` 回退 GBK |
| TXT 正则误伤正文 | 标题行限制「行首 + 简短行」，数字编号行加长度限制 |
| 渲染进程被注入风险 | `contextIsolation: true` + `nodeIntegration: false`，能力走 preload 白名单 |
| 打包下载慢 | 配置 Electron 镜像源 |

## 8. 迭代路线

- **第一版（MVP）**：Electron 骨架 + TXT 导入 + 阅读（无目录）。
- **第二版（迭代一）**：叠加 EPUB 导入 + 目录面板与章节切换（TXT 正则分章 / EPUB 原生导航）。
- 范围以 PRD 第 3 节为准，超出部分须先修订 PRD 与本文档。
