const path = require('node:path');
const JSZip = require('jszip');
const { XMLParser } = require('fast-xml-parser');
const { htmlToText, unescapeEntities } = require('./htmlUtils');

/** 识别 TXT 章节标题的正则（行首匹配） */
const CHAPTER_TITLE_PATTERNS = [
  /^\s*(?:序|序言|自序|前言|引子|楔子|后记|尾声|附录|番外|结语)\s*$/,
  /^\s*第[0-9零一二三四五六七八九十百千万]+[章节回部篇卷]\s*[：:、.\-—\s]*.{0,40}$/,
  /^\s*(?:卷|篇|部)\s*[0-9零一二三四五六七八九十]+\s*[：:、.\-—\s]*.{0,40}$/,
  /^\s*Chapter\s+[0-9IVXLCDM]+\b.{0,40}$/i,
  /^\s*[0-9]{1,4}\s*[.、]\s*\S.{0,30}$/,
];

/** 章节标题行的最大长度，避免把长正文行误判为标题 */
const MAX_TITLE_LENGTH = 50;

/**
 * 判断一行文本是否为章节标题。
 * @param {string} line 单行文本
 * @returns {boolean} 是章节标题返回 true
 */
function isChapterTitle(line) {
  const trimmed = String(line).trim();
  if (!trimmed || trimmed.length > MAX_TITLE_LENGTH) {
    return false;
  }
  return CHAPTER_TITLE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * 按章节标题正则切分 TXT 文本为章节数组。
 * @param {string} text 归一化后的全文
 * @returns {Array<{id: string, title: string, content: string}>} 章节数组（至少 1 项）
 */
function splitTxtChapters(text) {
  const lines = String(text).split('\n');
  const chapters = [];
  let currentTitle = '开头';
  let buffer = [];

  const flush = () => {
    const content = buffer.join('\n').trim();
    buffer = [];
    if (!content) {
      return;
    }
    chapters.push({
      id: `ch-${chapters.length}`,
      title: currentTitle,
      content,
    });
  };

  for (const line of lines) {
    if (isChapterTitle(line)) {
      flush();
      currentTitle = line.trim();
      continue;
    }
    buffer.push(line);
  }
  flush();

  if (chapters.length === 0) {
    return [{ id: 'full', title: '全文', content: String(text).trim() }];
  }
  // 只有一个「开头」且无真实章节标题时，退化为全文单章
  if (chapters.length === 1 && chapters[0].title === '开头') {
    return [{ id: 'full', title: '全文', content: chapters[0].content }];
  }
  return chapters.map((chapter, index) => ({
    id: `ch-${index}`,
    title: chapter.title,
    content: chapter.content,
  }));
}

/**
 * 将 Buffer 解码为字符串，UTF-8 优先，出现替换字符时回退 GB18030。
 * @param {Buffer} buffer 文件二进制内容
 * @returns {string} 解码后的文本
 */
function decodeText(buffer) {
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  if (!utf8.includes('\uFFFD')) {
    return utf8;
  }
  try {
    return new TextDecoder('gb18030').decode(buffer);
  } catch (err) {
    return utf8;
  }
}

/**
 * 归一化换行符，并压缩 3 个以上的连续空行。
 * @param {string} text 原始文本
 * @returns {string} 归一化后的文本
 */
function normalizeText(text) {
  return text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 解析 TXT 文件为统一书籍结构（含正则分章）。
 * @param {Buffer} buffer TXT 文件二进制内容
 * @param {string} fileName 文件名（用于书名兜底）
 * @returns {{title: string, format: string, chapters: Array<{id: string, title: string, content: string}>}}
 */
function parseTxt(buffer, fileName) {
  const raw = normalizeText(decodeText(buffer));
  const title = String(fileName || '未命名').replace(/\.txt$/i, '');
  return {
    title,
    format: 'txt',
    chapters: splitTxtChapters(raw),
  };
}

/* ------------------------------ EPUB ------------------------------ */

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
});

/**
 * 把 XML 解析结果统一成数组。
 * @param {*} value 单对象或数组
 * @returns {Array} 数组形式
 */
function toArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/**
 * 解析 XML 文本，失败时返回 null。
 * @param {string} text XML 文本
 * @returns {object|null} 解析结果
 */
function parseXmlSafely(text) {
  try {
    return xmlParser.parse(text);
  } catch (err) {
    return null;
  }
}

/**
 * 把 EPUB 内的相对 href 解析为压缩包内的绝对路径（剥离 fragment）。
 * @param {string} baseDir OPF 所在目录（posix 路径）
 * @param {string} href 相对路径，可能带 #fragment
 * @returns {{zipPath: string, fragment: string}} 容器内路径与锚点
 */
function resolveHref(baseDir, href) {
  const raw = String(href || '');
  const hashIndex = raw.indexOf('#');
  const fragment = hashIndex >= 0 ? raw.slice(hashIndex + 1) : '';
  const cleanPath = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  let decoded = cleanPath;
  try {
    decoded = decodeURIComponent(cleanPath);
  } catch (err) {
    decoded = cleanPath;
  }
  const joined = path.posix.join(baseDir, decoded);
  return { zipPath: path.posix.normalize(joined), fragment };
}

/**
 * 从 EPUB3 nav.xhtml 中提取目录条目（标题 + href）。
 * @param {string} navText nav.xhtml 内容
 * @returns {Array<{title: string, href: string}>} 目录条目
 */
function parseNavDocument(navText) {
  const navMatch =
    /<nav[^>]*epub:type\s*=\s*["']?toc["']?[^>]*>([\s\S]*?)<\/nav>/i.exec(navText) ||
    /<nav[^>]*type\s*=\s*["']?toc["']?[^>]*>([\s\S]*?)<\/nav>/i.exec(navText) ||
    /<nav[^>]*>([\s\S]*?)<\/nav>/i.exec(navText);
  const scope = navMatch ? navMatch[1] : navText;
  const entries = [];
  const anchorRegex = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match = anchorRegex.exec(scope);
  while (match !== null) {
    const title = htmlToText(match[2]).replace(/\s+/g, ' ').trim();
    if (title) {
      entries.push({ title, href: match[1] });
    }
    match = anchorRegex.exec(scope);
  }
  return entries;
}

/**
 * 递归收集 NCX 中的 navPoint 为扁平目录条目。
 * @param {*} navPoints navPoint 节点（单个或数组）
 * @returns {Array<{title: string, href: string}>} 目录条目
 */
function collectNavPoints(navPoints) {
  const entries = [];
  for (const point of toArray(navPoints)) {
    const label = point && point.navLabel ? point.navLabel.text : '';
    const src = point && point.content ? point.content['@_src'] : '';
    const title = typeof label === 'string' ? label.trim() : String(label || '').trim();
    if (title && src) {
      entries.push({ title, href: src });
    }
    if (point && point.navPoint) {
      entries.push(...collectNavPoints(point.navPoint));
    }
  }
  return entries;
}

/**
 * 从 EPUB2 toc.ncx 中提取目录条目。
 * @param {string} ncxText ncx 内容
 * @returns {Array<{title: string, href: string}>} 目录条目
 */
function parseNcxDocument(ncxText) {
  const parsed = parseXmlSafely(ncxText);
  if (!parsed || !parsed.ncx || !parsed.ncx.navMap) {
    return [];
  }
  return collectNavPoints(parsed.ncx.navMap.navPoint);
}

/**
 * 定位 XHTML 中所有 id 锚点及其出现位置（按文档顺序）。
 * @param {string} html XHTML 文本
 * @returns {Array<{id: string, index: number}>} 锚点列表
 */
function collectAnchors(html) {
  const anchors = [];
  const idRegex = /\sid\s*=\s*["']([^"']+)["']/gi;
  let match = idRegex.exec(html);
  while (match !== null) {
    anchors.push({ id: match[1], index: match.index });
    match = idRegex.exec(html);
  }
  return anchors;
}

/**
 * 按锚点截取 XHTML 片段并转为纯文本。
 * 无锚点时取整文件；有锚点时截取到同文件下一个锚点，避免相邻章节内容重复。
 * @param {string} html XHTML 全文
 * @param {string} fragment 锚点 id
 * @param {Array<string>} nextIds 同文件中排在该锚点之后、且属于目录的 id（用于确定结束位置）
 * @returns {string} 章节纯文本
 */
function sliceChapterHtml(html, fragment, nextIds) {
  if (!fragment) {
    return htmlToText(html);
  }
  const anchors = collectAnchors(html);
  const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const target = anchors.find(
    (anchor) => anchor.id === fragment || new RegExp(`^${escaped}$`).test(anchor.id)
  );
  if (!target) {
    return htmlToText(html);
  }
  let endIndex = html.length;
  for (const id of nextIds) {
    const next = anchors.find((anchor) => anchor.id === id && anchor.index > target.index);
    if (next) {
      endIndex = next.index;
      break;
    }
  }
  return htmlToText(html.slice(target.index, endIndex));
}

/**
 * 解析 EPUB 文件为统一书籍结构（含原生目录）。
 * @param {Buffer} buffer EPUB 文件二进制内容
 * @param {string} fileName 文件名（用于书名兜底）
 * @returns {Promise<{title: string, format: string, chapters: Array<{id: string, title: string, content: string}>}>}
 */
async function parseEpub(buffer, fileName) {
  const zip = await JSZip.loadAsync(buffer);

  // 1. container.xml → OPF 路径
  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) {
    throw new Error('不是有效的 EPUB 文件（缺少 container.xml）');
  }
  const containerXml = parseXmlSafely(await containerFile.async('string'));
  const rootfiles = containerXml
    ? toArray(containerXml.container.rootfiles.rootfile)
    : [];
  let opfPath = rootfiles.length ? rootfiles[0]['@_full-path'] : '';
  if (!opfPath) {
    opfPath = 'OEBPS/content.opf';
  }

  // 2. 解析 OPF
  const opfFile = zip.file(opfPath) || zip.file(decodeURIComponent(opfPath));
  if (!opfFile) {
    throw new Error('EPUB 解析失败：找不到 OPF 文件');
  }
  const opfXml = parseXmlSafely(await opfFile.async('string'));
  if (!opfXml || !opfXml.package) {
    throw new Error('EPUB 解析失败：OPF 格式异常');
  }
  const baseDir = path.posix.dirname(opfPath);

  const manifestItems = toArray(opfXml.package.manifest.item).map((item) => ({
    id: item['@_id'],
    href: item['@_href'],
    mediaType: item['@_media-type'] || '',
    properties: item['@_properties'] || '',
  }));
  const itemById = new Map(manifestItems.map((item) => [item.id, item]));
  const spineIds = toArray(opfXml.package.spine.itemref)
    .map((ref) => ref['@_idref'])
    .filter(Boolean);

  // 3. 书名
  const metadata = opfXml.package.metadata || {};
  let dcTitle = metadata.title;
  if (Array.isArray(dcTitle)) {
    dcTitle = dcTitle[0];
  }
  const title =
    (typeof dcTitle === 'string' ? dcTitle.trim() : '') ||
    String(fileName || '未命名').replace(/\.epub$/i, '');

  // 4. 目录：nav.xhtml → toc.ncx → spine 兜底
  let tocEntries = [];
  const navItem = manifestItems.find((item) =>
    String(item.properties).split(/\s+/).includes('nav')
  );
  if (navItem) {
    const navFile = zip.file(resolveHref(baseDir, navItem.href).zipPath);
    if (navFile) {
      tocEntries = parseNavDocument(await navFile.async('string'));
    }
  }
  if (tocEntries.length === 0) {
    const ncxItem = manifestItems.find(
      (item) => item.mediaType === 'application/x-dtbncx+xml'
    ) || manifestItems.find((item) => /\.ncx$/i.test(item.href));
    if (ncxItem) {
      const ncxFile = zip.file(resolveHref(baseDir, ncxItem.href).zipPath);
      if (ncxFile) {
        tocEntries = parseNcxDocument(await ncxFile.async('string'));
      }
    }
  }
  if (tocEntries.length === 0) {
    tocEntries = spineIds
      .map((id) => itemById.get(id))
      .filter(Boolean)
      .map((item) => ({ title: '', href: item.href }));
  }

  // 5. 解析每个目录项指向的文件与锚点，预读文件内容
  const resolved = tocEntries.map((entry) => {
    const { zipPath, fragment } = resolveHref(baseDir, entry.href);
    return { title: entry.title, zipPath, fragment };
  });

  const uniquePaths = [...new Set(resolved.map((item) => item.zipPath))];
  const htmlCache = new Map();
  await Promise.all(
    uniquePaths.map(async (zipPath) => {
      const file = zip.file(zipPath);
      if (!file) {
        htmlCache.set(zipPath, '');
        return;
      }
      htmlCache.set(zipPath, await file.async('string'));
    })
  );

  // 同一文件内按文档顺序排好锚点，用于切分相邻章节
  const fragmentsByFile = new Map();
  for (const item of resolved) {
    if (!item.fragment) {
      continue;
    }
    if (!fragmentsByFile.has(item.zipPath)) {
      fragmentsByFile.set(item.zipPath, []);
    }
    fragmentsByFile.get(item.zipPath).push(item.fragment);
  }

  const chapters = [];
  for (const item of resolved) {
    const html = htmlCache.get(item.zipPath) || '';
    const anchorOrder = collectAnchors(html)
      .map((anchor) => anchor.id)
      .filter((id) => (fragmentsByFile.get(item.zipPath) || []).includes(id));
    const currentIndex = anchorOrder.indexOf(item.fragment);
    const nextIds = currentIndex >= 0 ? anchorOrder.slice(currentIndex + 1) : [];
    let content = sliceChapterHtml(html, item.fragment, nextIds);

    let chapterTitle = item.title;
    if (!chapterTitle) {
      const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
      chapterTitle = titleMatch
        ? htmlToText(titleMatch[1]).trim()
        : item.zipPath;
    }
    content = content.trim();
    if (!content) {
      continue;
    }
    chapters.push({
      id: `ch-${chapters.length}`,
      title: chapterTitle || `第 ${chapters.length + 1} 章`,
      content,
    });
  }

  if (chapters.length === 0) {
    // 兜底：直接按 spine 顺序输出整文件内容
    for (const spineId of spineIds) {
      const item = itemById.get(spineId);
      if (!item) {
        continue;
      }
      const { zipPath } = resolveHref(baseDir, item.href);
      const file = zip.file(zipPath);
      if (!file) {
        continue;
      }
      const content = htmlToText(await file.async('string')).trim();
      if (content) {
        chapters.push({
          id: `ch-${chapters.length}`,
          title: `第 ${chapters.length + 1} 章`,
          content,
        });
      }
    }
  }

  return { title, format: 'epub', chapters };
}

module.exports = {
  decodeText,
  normalizeText,
  isChapterTitle,
  splitTxtChapters,
  parseTxt,
  parseEpub,
  resolveHref,
  parseNavDocument,
  parseNcxDocument,
  htmlToText,
  unescapeEntities,
};
