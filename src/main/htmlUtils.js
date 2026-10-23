const HTML_ENTITIES = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&mdash;': '—',
  '&ndash;': '–',
  '&ldquo;': '“',
  '&rdquo;': '”',
  '&lsquo;': '‘',
  '&rsquo;': '’',
  '&hellip;': '…',
};

/**
 * 解码常见 HTML 实体为对应字符。
 * @param {string} text 含 HTML 实体的文本
 * @returns {string} 解码后的文本
 */
function unescapeEntities(text) {
  let result = String(text);
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    result = result.split(entity).join(char);
  }
  // 处理数字实体 &#123; / &#x1F600;
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
    String.fromCodePoint(parseInt(hex, 16))
  );
  result = result.replace(/&#(\d+);/g, (_, dec) =>
    String.fromCodePoint(parseInt(dec, 10))
  );
  return result;
}

/**
 * 将 XHTML 片段转为纯文本：块级标签补换行，剥离其余标签。
 * @param {string} html XHTML 字符串
 * @returns {string} 纯文本
 */
function htmlToText(html) {
  let result = String(html);
  // 移除脚本、样式与注释
  result = result
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  // 块级闭合标签直接移除，只由开标签产生换行，避免出现多余空行
  result = result.replace(
    /<\/(p|div|h[1-6]|li|tr|section|article|blockquote|pre|table|ul|ol)\s*>/gi,
    ''
  );
  // 块级开标签（含 <br/> 等自闭合标签）转换为换行，保留段落结构
  result = result.replace(
    /<(p|div|br|h[1-6]|li|tr|section|article|blockquote|pre|table|ul|ol|hr)\b[^>]*>/gi,
    '\n'
  );
  // 剥离剩余标签
  result = result.replace(/<[^>]+>/g, '');
  result = unescapeEntities(result);
  // 行尾空白清理，压缩多余空行
  result = result
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return result;
}

module.exports = { unescapeEntities, htmlToText };
