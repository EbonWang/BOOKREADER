const test = require('node:test');
const assert = require('node:assert');
const JSZip = require('jszip');
const parser = require('../src/main/bookParser');
const { htmlToText } = require('../src/main/htmlUtils');

/**
 * 构造一个测试用 EPUB 压缩包。
 * @param {object} options 配置：useNav 是否提供 EPUB3 nav，useNcx 是否提供 EPUB2 ncx，anchors 是否把两章放进同一文件
 * @returns {Promise<Buffer>} EPUB 二进制内容
 */
async function buildEpub(options = {}) {
  const { useNav = true, useNcx = true, anchors = false } = options;
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
      '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>' +
      '</container>'
  );

  const manifest = [
    '<item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>',
    '<item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>',
    useNav ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : '',
    useNcx ? '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' : '',
  ]
    .filter(Boolean)
    .join('');

  const opf =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">' +
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    '<dc:title>测试书籍</dc:title></metadata>' +
    `<manifest>${manifest}</manifest>` +
    '<spine toc="ncx"><itemref idref="c1"/><itemref idref="c2"/></spine>' +
    '</package>';
  zip.file('OEBPS/content.opf', opf);

  if (useNav) {
    const href1 = anchors ? 'ch1.xhtml#s1' : 'ch1.xhtml';
    const href2 = anchors ? 'ch1.xhtml#s2' : 'ch2.xhtml';
    zip.file(
      'OEBPS/nav.xhtml',
      '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">' +
        '<body><nav epub:type="toc"><ol>' +
        `<li><a href="${href1}">第一章 启程</a></li>` +
        `<li><a href="${href2}">第二章 远方</a></li>` +
        '</ol></nav></body></html>'
    );
  }

  if (useNcx) {
    zip.file(
      'OEBPS/toc.ncx',
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">' +
        '<navMap>' +
        '<navPoint id="p1"><navLabel><text>第一章 启程</text></navLabel><content src="ch1.xhtml"/></navPoint>' +
        '<navPoint id="p2"><navLabel><text>第二章 远方</text></navLabel><content src="ch2.xhtml"/></navPoint>' +
        '</navMap></ncx>'
    );
  }

  zip.file(
    'OEBPS/ch1.xhtml',
    '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml">' +
      '<head><title>第一章 启程</title></head><body>' +
      (anchors ? '<h1 id="s1">第一章 启程</h1><p>第一段落内容</p><h1 id="s2">第二章 远方</h1><p>第二段落内容</p>'
               : '<h1>第一章 启程</h1><p>第一段落内容</p>') +
      '</body></html>'
  );
  zip.file(
    'OEBPS/ch2.xhtml',
    '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml">' +
      '<head><title>第二章 远方</title></head><body><h1>第二章 远方</h1><p>第二段落内容</p></body></html>'
  );

  return zip.generateAsync({ type: 'nodebuffer' });
}

test('htmlToText：剥离标签并保留段落结构', () => {
  const text = htmlToText('<html><body><h1>标题</h1><p>第一段</p><p>第二段</p></body></html>');
  assert.strictEqual(text, '标题\n第一段\n第二段');
});

test('htmlToText：解码 HTML 实体', () => {
  assert.strictEqual(htmlToText('<p>a&amp;b&nbsp;c&#39;d</p>'), "a&b c'd");
});

test('isChapterTitle：识别常见中文与英文章节标题', () => {
  assert.ok(parser.isChapterTitle('第一章 启程'));
  assert.ok(parser.isChapterTitle('第二十三章'));
  assert.ok(parser.isChapterTitle('第三章'));
  assert.ok(parser.isChapterTitle('前言'));
  assert.ok(parser.isChapterTitle('Chapter 1 The Road'));
  assert.ok(parser.isChapterTitle('1. 引言'));
});

test('isChapterTitle：不把普通正文长句误判为标题', () => {
  assert.ok(!parser.isChapterTitle('这是一段很普通的小说正文内容，讲述主人公告别故乡踏上旅途的故事。'));
  assert.ok(!parser.isChapterTitle(''));
});

test('splitTxtChapters：按标题切分章节，开头内容保留', () => {
  const text = '开头的一段引子文字\n第一章 启程\n正文一\n第二章 远方\n正文二';
  const chapters = parser.splitTxtChapters(text);
  assert.strictEqual(chapters.length, 3);
  assert.strictEqual(chapters[0].title, '开头');
  assert.strictEqual(chapters[1].title, '第一章 启程');
  assert.strictEqual(chapters[1].content, '正文一');
  assert.strictEqual(chapters[2].title, '第二章 远方');
  assert.strictEqual(chapters[2].content, '正文二');
});

test('splitTxtChapters：无章节标题时退化为全文单章', () => {
  const chapters = parser.splitTxtChapters('只有一段没有章节标题的内容');
  assert.strictEqual(chapters.length, 1);
  assert.strictEqual(chapters[0].title, '全文');
});

test('decodeText：UTF-8 正常解码', () => {
  const buffer = Buffer.from('中文测试', 'utf-8');
  assert.strictEqual(parser.decodeText(buffer), '中文测试');
});

test('decodeText：GBK 编码回退，不产生乱码', () => {
  const buffer = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]); // GBK 的「中文」
  assert.strictEqual(parser.decodeText(buffer), '中文');
});

test('parseTxt：返回书名、格式与章节', () => {
  const text = '引子内容\n第一章 启程\n正文一\n第二章 远方\n正文二';
  const book = parser.parseTxt(Buffer.from(text, 'utf-8'), '我的小说.txt');
  assert.strictEqual(book.title, '我的小说');
  assert.strictEqual(book.format, 'txt');
  assert.strictEqual(book.chapters.length, 3);
});

test('resolveHref：解析相对路径并剥离 fragment', () => {
  const result = parser.resolveHref('OEBPS', 'text/ch1.xhtml#section2');
  assert.strictEqual(result.zipPath, 'OEBPS/text/ch1.xhtml');
  assert.strictEqual(result.fragment, 'section2');
});

test('parseNavDocument：提取 nav.xhtml 中的目录条目', () => {
  const nav =
    '<nav epub:type="toc"><ol><li><a href="ch1.xhtml">第一章</a></li>' +
    '<li><a href="ch2.xhtml#a">第二章</a></li></ol></nav>';
  const entries = parser.parseNavDocument(nav);
  assert.deepStrictEqual(entries, [
    { title: '第一章', href: 'ch1.xhtml' },
    { title: '第二章', href: 'ch2.xhtml#a' },
  ]);
});

test('parseNcxDocument：提取 toc.ncx 中的目录条目', () => {
  const ncx =
    '<ncx><navMap><navPoint><navLabel><text>第一章</text></navLabel>' +
    '<content src="ch1.xhtml"/></navPoint>' +
    '<navPoint><navLabel><text>第二章</text></navLabel>' +
    '<content src="ch2.xhtml"/></navPoint></navMap></ncx>';
  const entries = parser.parseNcxDocument(ncx);
  assert.deepStrictEqual(entries, [
    { title: '第一章', href: 'ch1.xhtml' },
    { title: '第二章', href: 'ch2.xhtml' },
  ]);
});

test('parseEpub：EPUB3 nav 目录解析，书名与章节正确', async () => {
  const buffer = await buildEpub({ useNav: true, useNcx: false });
  const book = await parser.parseEpub(buffer, 'sample.epub');
  assert.strictEqual(book.title, '测试书籍');
  assert.strictEqual(book.format, 'epub');
  assert.strictEqual(book.chapters.length, 2);
  assert.strictEqual(book.chapters[0].title, '第一章 启程');
  assert.ok(book.chapters[0].content.includes('第一段落内容'));
  assert.strictEqual(book.chapters[1].title, '第二章 远方');
  assert.ok(book.chapters[1].content.includes('第二段落内容'));
});

test('parseEpub：无 nav 时回退 EPUB2 toc.ncx', async () => {
  const buffer = await buildEpub({ useNav: false, useNcx: true });
  const book = await parser.parseEpub(buffer, 'sample.epub');
  assert.strictEqual(book.chapters.length, 2);
  assert.strictEqual(book.chapters[0].title, '第一章 启程');
  assert.ok(book.chapters[0].content.includes('第一段落内容'));
});

test('parseEpub：无 nav 无 ncx 时按 spine 兜底生成目录', async () => {
  const buffer = await buildEpub({ useNav: false, useNcx: false });
  const book = await parser.parseEpub(buffer, 'sample.epub');
  assert.strictEqual(book.chapters.length, 2);
  assert.ok(book.chapters[0].content.includes('第一段落内容'));
  assert.ok(book.chapters[1].content.includes('第二段落内容'));
});

test('parseEpub：同一文件内按锚点切分相邻章节，内容不重复', async () => {
  const buffer = await buildEpub({ useNav: true, useNcx: false, anchors: true });
  const book = await parser.parseEpub(buffer, 'sample.epub');
  assert.strictEqual(book.chapters.length, 2);
  assert.ok(book.chapters[0].content.includes('第一段落内容'));
  assert.ok(!book.chapters[0].content.includes('第二段落内容'));
  assert.ok(book.chapters[1].content.includes('第二段落内容'));
  assert.ok(!book.chapters[1].content.includes('第一段落内容'));
});

test('parseEpub：缺少 container.xml 时抛出可读错误', async () => {
  const zip = new JSZip();
  zip.file('OEBPS/content.opf', '<package/>');
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(() => parser.parseEpub(buffer, 'bad.epub'), /container\.xml/);
});
