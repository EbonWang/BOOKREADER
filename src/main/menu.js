const { app, Menu, dialog } = require('electron');

/**
 * 构建中文应用菜单栏，替换 Electron 默认的英文菜单。
 * @param {import('electron').BrowserWindow} mainWindow 主窗口实例
 * @param {Function} onImport 点击「导入书籍」时的回调
 * @returns {import('electron').Menu} 应用菜单
 */
function createAppMenu(mainWindow, onImport) {
  const template = [
    {
      label: '文件(&F)',
      submenu: [
        {
          label: '导入书籍',
          accelerator: 'CmdOrCtrl+O',
          click: () => onImport(),
        },
        { type: 'separator' },
        { label: '退出', accelerator: 'Alt+F4', role: 'quit' },
      ],
    },
    {
      label: '帮助(&H)',
      submenu: [
        {
          label: '关于阅读器',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              title: '关于阅读器',
              message: '阅读器',
              detail: `版本 ${app.getVersion()}\nElectron ${process.versions.electron}\nNode ${process.versions.node}`,
              buttons: ['确定'],
              defaultId: 0,
            });
          },
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

module.exports = { createAppMenu };
