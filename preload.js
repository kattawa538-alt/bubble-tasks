// ===== preload（main と renderer をつなぐ「橋」）=====
// このファイルは renderer が読み込まれる直前に実行される特別な場所。
// 「浮遊ウィンドウ(index.html)」と「入力小窓(input.html)」の両方が使うので、
// 両者ぶんの窓口をまとめて公開しておく。

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bubbleAPI', {
  // --- 浮遊ウィンドウ側で使う ---
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  // タスク追加が届く（payload は { text, due }）。
  onAddTask: (callback) => ipcRenderer.on('add-task', (e, payload) => callback(payload)),
  // 設定変更を受け取る（大きさ・揺れ）
  onSetSize: (callback) => ipcRenderer.on('set-size', (e, px) => callback(px)),
  onSetFloat: (callback) => ipcRenderer.on('set-float', (e, on) => callback(on)),
  // 「完了したタスク一覧を出して」が届く
  onShowCompleted: (callback) => ipcRenderer.on('show-completed', () => callback()),

  // --- 入力小窓側で使う ---
  addTask: (text, due, flags) => ipcRenderer.send('add-task', { text, due, ...(flags || {}) }),
  hideInput: () => ipcRenderer.send('hide-input'),
  quit: () => ipcRenderer.send('quit-app'),
  // 設定を変更する（大きさ・揺れ）
  setSize: (px) => ipcRenderer.send('set-size', px),
  setFloat: (on) => ipcRenderer.send('set-float', on),
  // 完了したタスク一覧を開く
  openCompleted: () => ipcRenderer.send('open-completed'),
});
