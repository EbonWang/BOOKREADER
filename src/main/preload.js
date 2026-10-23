const { contextBridge, ipcRenderer } = require('electron');

// 仅暴露受控的白名单 API，渲染进程无法直接访问 Node 能力
contextBridge.exposeInMainWorld('readerApi', {
  importBook: () => ipcRenderer.invoke('book:import'),
  // 菜单栏「导入书籍」由主进程解析完成后推送结果给渲染层
  onBookOpened: (callback) => {
    const listener = (_event, result) => callback(result);
    ipcRenderer.on('book:opened', listener);
  },
});
