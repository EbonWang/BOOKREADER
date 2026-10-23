const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const bookParser = require('./bookParser');
const { createAppMenu } = require('./menu');

let mainWindow = null;

/** 创建应用主窗口并加载渲染层页面。 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 720,
    minHeight: 480,
    title: '阅读器',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  Menu.setApplicationMenu(createAppMenu(mainWindow, importFromMenu));
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

/**
 * 导入书籍：弹出系统文件选择框，读取并按扩展名分流解析。
 * @returns {Promise<object|null>} 解析后的书籍对象，用户取消时返回 null
 */
async function importBook() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入书籍',
    properties: ['openFile'],
    filters: [{ name: '电子书', extensions: ['txt', 'epub'] }],
  });
  if (result.canceled || !result.filePaths.length) {
    return null;
  }
  const filePath = result.filePaths[0];
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.txt' && ext !== '.epub') {
    return { ok: false, message: `暂不支持的文件格式：${ext || '未知'}，仅支持 TXT 与 EPUB` };
  }
  try {
    const buffer = fs.readFileSync(filePath);
    const book =
      ext === '.txt'
        ? bookParser.parseTxt(buffer, path.basename(filePath))
        : await bookParser.parseEpub(buffer, path.basename(filePath));
    return { ok: true, book };
  } catch (err) {
    return {
      ok: false,
      message: `解析失败：${err && err.message ? err.message : '未知错误'}`,
    };
  }
}

ipcMain.handle('book:import', importBook);

/**
 * 菜单栏「导入书籍」入口：解析完成后把结果推送给渲染层。
 * @returns {Promise<void>}
 */
async function importFromMenu() {
  const result = await importBook();
  if (result && mainWindow) {
    mainWindow.webContents.send('book:opened', result);
  }
}
