const importBtn = document.getElementById('import-btn');
const bookTitleEl = document.getElementById('book-title');
const bookFormatEl = document.getElementById('book-format');
const tocPanelEl = document.getElementById('toc-panel');
const tocListEl = document.getElementById('toc-list');
const contentAreaEl = document.getElementById('content-area');
const contentTextEl = document.getElementById('content-text');
const emptyStateEl = document.getElementById('empty-state');

let currentBook = null;
let currentIndex = 0;

/** 应用导入结果，工具栏按钮与菜单栏共用。 */
function applyResult(result) {
  if (!result) {
    return;
  }
  if (!result.ok) {
    window.alert(result.message);
    return;
  }
  currentBook = result.book;
  currentIndex = 0;
  renderBook();
}

/** 点击导入按钮：调用主进程选择并解析书籍。 */
async function handleImport() {
  try {
    applyResult(await window.readerApi.importBook());
  } catch (err) {
    const message = err && err.message ? err.message : '导入失败';
    window.alert(message);
  }
}

/** 渲染左侧目录列表。 */
function renderToc() {
  tocListEl.textContent = '';
  currentBook.chapters.forEach((chapter, index) => {
    const item = document.createElement('li');
    item.className = 'toc-item';
    if (index === currentIndex) {
      item.classList.add('active');
    }
    item.textContent = chapter.title;
    item.title = chapter.title;
    item.addEventListener('click', () => selectChapter(index));
    tocListEl.appendChild(item);
  });
  tocPanelEl.hidden = false;
}

/** 切换并渲染指定章节。 */
function selectChapter(index) {
  currentIndex = index;
  const chapter = currentBook.chapters[index];
  contentTextEl.textContent = chapter.content;
  contentAreaEl.scrollTop = 0;
  for (const item of tocListEl.children) {
    item.classList.remove('active');
  }
  if (tocListEl.children[index]) {
    tocListEl.children[index].classList.add('active');
  }
}

/** 渲染当前书籍：书名、格式标签、目录与正文。 */
function renderBook() {
  if (!currentBook) {
    return;
  }
  bookTitleEl.textContent = currentBook.title;
  bookFormatEl.textContent = currentBook.format.toUpperCase();
  bookFormatEl.hidden = false;

  emptyStateEl.hidden = true;
  contentTextEl.hidden = false;
  renderToc();
  selectChapter(0);
}

importBtn.addEventListener('click', handleImport);
window.readerApi.onBookOpened(applyResult);
