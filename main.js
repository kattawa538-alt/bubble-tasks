// ===== メインプロセス =====
// Electron アプリが起動すると、まずこのファイルが実行される。
// 「アプリ全体を管理する係」。ウィンドウ・トレイ（メニューバー／タスクトレイ常駐）を担当する。
// Mac でも Windows でも動くように、OS ごとの違いはここで吸収している。

const { app, BrowserWindow, Tray, ipcMain, nativeImage, screen, globalShortcut } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');

const isMac = process.platform === 'darwin';

// 二重起動を防ぐ（Windows だとショートカットを2回押すと2個起動してしまうため）。
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// 他の関数からも触れるよう、ウィンドウ類を関数の外に出しておく。
let win;       // バブルが浮く透明ウィンドウ（index.html）
let inputWin;  // タスク入力の小窓（input.html）
let tray;      // 常駐アイコン
let lastHide = 0; // 小窓を最後に隠した時刻（トレイのクリックと blur がぶつかるのを防ぐ）
let lastShow = 0; // 小窓を最後に出した時刻
const SHORTCUT = 'Control+Shift+Space';  // どこからでも入力小窓を出すキー（Mac では Ctrl+Shift+Space）

// --- バブルが浮く透明ウィンドウ ---
function createWindow() {
  // 画面全体（メニューバー／タスクバーを除いた使える範囲）にぴったり合わせる。
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;

  win = new BrowserWindow({
    x, y,
    width,
    height,
    title: 'Bubble Desktop',
    transparent: true,  // 背景を透明に
    frame: false,       // 枠なし
    alwaysOnTop: true,  // 常に最前面
    hasShadow: false,   // 影を消す
    skipTaskbar: true,  // Windows：タスクバーにボタンを出さない
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadFile('index.html');

  // 起動直後はクリックが後ろにすり抜ける状態（位置情報だけは受け取る）。
  win.setIgnoreMouseEvents(true, { forward: true });
}

// --- タスク入力の小窓（常駐アイコンから呼び出す） ---
function createInputWindow() {
  inputWin = new BrowserWindow({
    width: 280,
    height: 475,
    show: false,        // 最初は隠しておく
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  inputWin.loadFile('input.html');

  // フォーカスが外れたら隠す（ポップオーバーっぽい挙動）。
  inputWin.on('blur', () => {
    // 出した直後の blur は無視（Windows のトレイの「^」メニューが閉じるときにフォーカスを奪うため）。
    if (Date.now() - lastShow < 400) { inputWin.focus(); return; }
    inputWin.hide();
    lastHide = Date.now();
  });
}

// 小窓を出す/隠すを切り替える。
// Mac：メニューバー（上）のアイコンの「下」に出す。
// Windows：タスクトレイ（普通は右下）のアイコンの「上」に出す。
function toggleInput() {
  // Windows では、アイコンを押した瞬間に blur → 隠れる → click が来て再表示、となりがち。
  // 隠した直後のクリックは「閉じる操作」だったとみなして無視する。
  if (Date.now() - lastHide < 250) return;

  if (inputWin.isVisible()) {
    inputWin.hide();
    return;
  }
  const t = tray.getBounds();          // アイコンの位置・大きさ
  const w = inputWin.getBounds();      // 小窓の大きさ
  const area = screen.getDisplayNearestPoint({ x: t.x, y: t.y }).workArea;

  let x = Math.round(t.x + t.width / 2 - w.width / 2);
  let y;
  if (t.y > area.y + area.height / 2) {
    y = t.y - w.height - 4;            // タスクバーが下 → アイコンの上に出す
  } else {
    y = t.y + t.height + 4;            // 上にある（Mac など）→ アイコンの下に出す
  }
  // アイコンの位置が取れない（0,0 になる）環境もあるので、そのときは右下に置く。
  if (t.width === 0 && t.height === 0) {
    x = area.x + area.width - w.width - 8;
    y = area.y + area.height - w.height - 8;
  }
  // 画面からはみ出さないように収める。
  x = Math.max(area.x, Math.min(x, area.x + area.width - w.width));
  y = Math.max(area.y, Math.min(y, area.y + area.height - w.height));

  inputWin.setPosition(Math.round(x), Math.round(y), false);
  lastShow = Date.now();
  inputWin.show();
  inputWin.focus();
}

// --- 常駐アイコン（Tray） ---
function createTray() {
  let icon;
  if (isMac) {
    // ファイル名が Template で終わる画像は、macOS がライト/ダークに合わせて自動で色を反転する。
    icon = nativeImage.createFromPath(path.join(__dirname, 'iconTemplate.png'));
    icon.setTemplateImage(true);
  } else {
    // Windows：色付きの .ico を使う（Template の自動反転は Mac だけの機能）。
    icon = nativeImage.createFromPath(path.join(__dirname, 'icon.ico'));
  }
  tray = new Tray(icon);
  tray.setToolTip('Bubble Tasks — クリック または Ctrl+Shift+Space でタスク追加');

  // 左クリック・右クリックどちらでも入力小窓を出す。
  tray.on('click', toggleInput);
  tray.on('right-click', toggleInput);
}

// --- 全画面・最大化のウィンドウが前にあるときは泡を隠す（Windows だけ）---
// Mac は全画面アプリが別の「スペース」に移るので自然に隠れるが、
// Windows は「常に最前面」のウィンドウが全画面アプリより前に出てしまう。
// そこで PowerShell に「いま前面にあるウィンドウがメイン画面で全画面 or 最大化か」を
// 0.7秒ごとに見張らせ、変わったときだけ 1（隠す）/ 0（出す）/ -（そのまま）を知らせてもらう。
let watcher = null;

function startFullscreenWatcher() {
  if (process.platform !== 'win32') return;

  const myPid = process.pid;
  const ps = `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
try {
$src = @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class FS {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MI { public int cb; public RECT M; public RECT W; public uint F; }
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MI mi);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  // Windows 自身の画面（タスクバー・Alt+Tab・スタートメニュー・通知など）。これが前に来ても泡の状態は変えない。
  static readonly string[] Shell = {
    "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd",
    "XamlExplorerHostIslandWindow", "Windows.UI.Core.CoreWindow", "MultitaskingViewFrame",
    "ForegroundStaging", "TaskListThumbnailWnd", "TopLevelWindowForOverflowXamlIsland",
    "NotifyIconOverflowWindow", "Shell_InputSwitchTopLevelWindow", "#32768"
  };
  public static void Init() { SetProcessDPIAware(); }
  // 前面ウィンドウの様子を "判定|クラス名|窓の範囲|画面の範囲|メイン画面か" の1行で返す。
  public static string Describe(uint myPid) {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) return "0|(none)";
    uint pid; GetWindowThreadProcessId(h, out pid);
    var sb = new StringBuilder(256); GetClassName(h, sb, 256);
    string c = sb.ToString();
    if (pid == myPid) return "-|self:" + c;                  // 自分（泡・入力小窓）が前面 → そのまま
    if (c == "Progman" || c == "WorkerW") return "0|desktop:" + c;   // デスクトップをクリック → 泡を出す
    if (Array.IndexOf(Shell, c) >= 0) return "-|shell:" + c;         // Windows の画面 → そのまま
    RECT r; if (!GetWindowRect(h, out r)) return "0|norect:" + c;
    MI mi = new MI(); mi.cb = Marshal.SizeOf(typeof(MI));
    if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return "0|nomon:" + c;
    bool primary = (mi.F & 1) != 0;
    bool full = r.L <= mi.M.L && r.T <= mi.M.T && r.R >= mi.M.R && r.B >= mi.M.B;  // 全画面
    bool zoomed = IsZoomed(h);                                                        // 最大化
    return ((primary && (full || zoomed)) ? "1" : "0") + "|" + c
      + "|win=" + r.L + "," + r.T + "," + r.R + "," + r.B
      + "|mon=" + mi.M.L + "," + mi.M.T + "," + mi.M.R + "," + mi.M.B
      + "|primary=" + primary + "|max=" + zoomed;
  }
}
"@
Add-Type -TypeDefinition $src
[FS]::Init()
[Console]::Out.WriteLine("READY"); [Console]::Out.Flush()
$last = ""
while ($true) {
  if (-not (Get-Process -Id ${myPid} -ErrorAction SilentlyContinue)) { exit }
  try {
    $d = [FS]::Describe(${myPid})
    $key = ($d -split '\\|')[0..1] -join '|'
    if ($key -ne $last) { [Console]::Out.WriteLine($d); [Console]::Out.Flush(); $last = $key }
  } catch {
    [Console]::Out.WriteLine("ERR|" + $_.Exception.Message); [Console]::Out.Flush()
  }
  Start-Sleep -Milliseconds 700
}
} catch {
  [Console]::Out.WriteLine("ERR|" + $_.Exception.Message); [Console]::Out.Flush()
}
`;
  // 日本語や記号を安全に渡すため、Base64（UTF-16LE）にして渡す。
  const encoded = Buffer.from(ps, 'utf16le').toString('base64');

  try {
    watcher = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true });
  } catch (err) {
    console.error('全画面の見張りを起動できませんでした:', err);
    return;
  }

  let buf = '';
  watcher.stdout.on('data', (data) => {
    buf += data.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();                 // 途中までの行は次回に回す
    for (const line of lines) {
      if (!line.trim()) continue;
      if (line.startsWith('ERR')) console.error('[watcher]', line);  // 問題があったときだけ表示
      const v = line.split('|')[0];
      if (!win) continue;
      if (v === '1') {
        win.hide();                       // 全画面・最大化のウィンドウが前 → 泡を隠す
      } else if (v === '0' && !win.isVisible()) {
        win.showInactive();               // 戻ってきた → フォーカスを奪わずに再表示
        win.setAlwaysOnTop(true);
      }
    }
  });
  watcher.stderr.on('data', (d) => console.error('[watcher]', d.toString()));
  watcher.on('exit', () => { watcher = null; });
}

// ===== IPC（renderer からのメッセージ受け口）=====

// クリックすり抜けの切り替え（浮遊ウィンドウから）。
ipcMain.on('set-ignore-mouse', (event, ignore) => {
  if (win) win.setIgnoreMouseEvents(ignore, { forward: true });
});

// タスク追加（入力小窓 → main → 浮遊ウィンドウへ中継）。
// payload は { text, due, important, urgent, quick, wish } の形。
ipcMain.on('add-task', (event, payload) => {
  if (win) win.webContents.send('add-task', payload);
  if (inputWin) inputWin.hide();
});

// 入力小窓を閉じる（Esc から）。
ipcMain.on('hide-input', () => {
  if (inputWin) inputWin.hide();
});

// 「完了したタスク一覧」を開く。
ipcMain.on('open-completed', () => {
  if (inputWin) inputWin.hide();
  if (win) {
    win.focus();  // Windows：パネルにすぐ触れるよう前に出す
    win.webContents.send('show-completed');
  }
});

// アプリ終了（小窓の「終了」から）。
ipcMain.on('quit-app', () => app.quit());

// 見た目の設定変更を、浮遊ウィンドウへ中継する。
ipcMain.on('set-size', (event, px) => {
  if (win) win.webContents.send('set-size', px);
});
ipcMain.on('set-float', (event, on) => {
  if (win) win.webContents.send('set-float', on);
});

// ===== アプリのライフサイクル =====
app.whenReady().then(() => {
  if (isMac && app.dock) app.dock.hide();  // Mac：Dock にアイコンを出さない（常駐アプリなので）

  createWindow();
  createInputWindow();
  createTray();
  startFullscreenWatcher();

  // キーボードショートカットで、どこからでも入力小窓を出せるようにする。
  globalShortcut.register(SHORTCUT, () => {
    lastHide = 0;  // ショートカットは連打防止の対象外
    toggleInput();
  });

  // 起動したら一度だけ入力小窓を出して、「ここから入力する」と分かるようにする。
  inputWin.once('ready-to-show', () => toggleInput());

  // パッケージ版のときだけ、ログイン時に自動起動するよう登録する（Mac・Windows 共通）。
  // 開発中（electron .）は Electron 本体が登録されてしまうので除外する。
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true });
  }

  // 自動アップデート（Windows のインストール版だけ）。
  // 起動時に GitHub Releases に新しい版がないか確かめ、あれば裏でダウンロードして、
  // 次にアプリを終了したときに入れ替える。Mac は正式な署名をするまでは手動で入れ直してもらう。
  if (app.isPackaged && process.platform === 'win32') {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => console.error('[updater]', err));
  }

  app.on('activate', () => {
    if (!win) createWindow();
  });
});

// 2個目を起動しようとしたら、入力小窓を出すだけにする。
app.on('second-instance', () => {
  if (inputWin && tray) toggleInput();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (watcher) watcher.kill();   // 見張り役の PowerShell も一緒に終わらせる
});

// ウィンドウは隠すだけで閉じないので、ここには基本来ない。
app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
