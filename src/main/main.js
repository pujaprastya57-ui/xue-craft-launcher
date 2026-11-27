'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, Menu, safeStorage, shell, dialog } = require('electron');
const paths = require('./core/paths');
const microsoft = require('./auth/microsoft');
const { registerIpc } = require('./ipc');

const SMOKE_TEST = process.argv.includes('--smoke-test');
let mainWindow = null;

// 启动器数据根目录：始终位于「安装目录」内，不写入 C 盘 %APPDATA%。
// - 安装版：用户安装时选择的目录（即 exe 所在目录）
// - 便携版：exe 所在目录（electron-builder 会注入 PORTABLE_EXECUTABLE_DIR）
// - 开发模式：项目根目录，避免污染 node_modules 内的 electron
function resolveInstallDir() {
  if (!app.isPackaged) return path.resolve(__dirname, '..', '..');
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  return path.dirname(process.execPath);
}
const INSTALL_DIR = resolveInstallDir();
let LAUNCHER_ROOT = path.join(INSTALL_DIR, 'data');

// 旧版本的数据位置，仅用于读取并迁移，不再作为写入目标
const LEGACY_ROOTS = [
  path.join(app.getPath('appData'), 'xueCraft'),
  path.join(app.getPath('appData'), 'TraeCraft'),
];

/** 判断目录里是否真的存在用户数据（区别于只有 config/缓存的空壳目录） */
function hasUserData(dir) {
  try {
    if (!fs.existsSync(dir)) return false;
    if (fs.existsSync(path.join(dir, 'accounts.json'))) return true;
    for (const name of ['versions', 'libraries', 'assets', 'runtime']) {
      const sub = path.join(dir, name);
      if (fs.existsSync(sub) && fs.readdirSync(sub).length > 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** 把 src 下的内容逐项移动到 dest，已存在的文件不覆盖；跨盘时退化为复制后删除 */
function moveDirContents(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const s = path.join(src, entry);
    const d = path.join(dest, entry);
    if (fs.existsSync(d)) continue;
    try {
      fs.renameSync(s, d);
    } catch (err) {
      if (err.code === 'EXDEV' || err.code === 'EPERM' || err.code === 'EBUSY') {
        fs.cpSync(s, d, { recursive: true, force: false });
        fs.rmSync(s, { recursive: true, force: true });
      } else {
        throw err;
      }
    }
  }
  try {
    if (fs.readdirSync(src).length === 0) fs.rmdirSync(src);
  } catch {
    // 旧目录删不掉不影响使用
  }
}

// 首次启动时把旧版本留在 %APPDATA% 的数据迁移到安装目录。
// 迁移失败时回退到旧目录继续运行并提示用户，绝不因创建空目录而让老用户数据“丢失”。
let migrationOk = true;
let migrationNote = '';
function migrateLegacyDataDir() {
  if (hasUserData(LAUNCHER_ROOT)) return true;
  const oldRoot = LEGACY_ROOTS.find((dir) => hasUserData(dir));
  if (!oldRoot) return true;
  let lastErr = null;
  for (let i = 0; i < 4; i++) {
    try {
      moveDirContents(oldRoot, LAUNCHER_ROOT);
      migrationNote = `已将旧数据从 ${oldRoot} 迁移到 ${LAUNCHER_ROOT}`;
      return true;
    } catch (err) {
      lastErr = err;
    }
    try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400 * (i + 1)); } catch (_) {}
  }
  console.error('[xueCraft] 数据目录迁移失败，回退到旧目录:', lastErr && lastErr.message);
  LAUNCHER_ROOT = oldRoot;
  migrationNote = `迁移失败，本次继续使用 ${oldRoot}`;
  return false;
}
migrationOk = migrateLegacyDataDir();

// 迁移完成后清理 C 盘遗留的空壳目录（仅在确认没有任何账号或游戏文件时才删除）
if (migrationOk) {
  for (const dir of LEGACY_ROOTS) {
    try {
      if (fs.existsSync(dir) && !hasUserData(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  }
}

// 所有 Electron / Chromium 缓存同样落在安装目录内
const CACHE_DIR = path.join(LAUNCHER_ROOT, '.cache');
const TEMP_DIR = path.join(LAUNCHER_ROOT, '.temp');
for (const dir of [LAUNCHER_ROOT, CACHE_DIR, TEMP_DIR]) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
}
app.setPath('userData', CACHE_DIR);
app.setPath('cache', CACHE_DIR);
app.setPath('crashDumps', path.join(CACHE_DIR, 'crashDumps'));
app.setPath('logs', path.join(LAUNCHER_ROOT, 'logs'));
app.setPath('temp', TEMP_DIR);

/** 检测安装目录是否可写（例如被装到 Program Files 时普通权限无法写入） */
function installDirWritable() {
  try {
    fs.mkdirSync(LAUNCHER_ROOT, { recursive: true });
    const probe = path.join(LAUNCHER_ROOT, '.write-test');
    fs.writeFileSync(probe, String(Date.now()));
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}
const writable = installDirWritable();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock && !SMOKE_TEST) {
  app.quit();
}

app.setAppUserModelId('com.xuecraft.launcher');

function launcherRoot() {
  return LAUNCHER_ROOT;
}

function setupVault() {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      microsoft.setVault({
        encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
        decrypt: (text) => safeStorage.decryptString(Buffer.from(text, 'base64')),
      });
    }
  } catch {
    // 系统不支持加密时退回 base64（仍可正常使用）
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#0b0f14',
    title: 'xue Craft launcher',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (SMOKE_TEST) mainWindow.setOpacity(1);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (SMOKE_TEST) runSmokeTest();
}

function runSmokeTest() {
  const messages = [];
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    messages.push(`[${level}] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on('did-finish-load', async () => {
    try {
      await new Promise((r) => setTimeout(r, 3500));
      const outDir = path.join(paths.root(), 'smoke');
      fs.mkdirSync(outDir, { recursive: true });
      // 首次启动的协议同意层：截图后按真实交互勾选并同意
      const consentVisible = await mainWindow.webContents.executeJavaScript('Boolean(document.querySelector(".legal-mask"))');
      if (consentVisible) {
        const legalImage = await mainWindow.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, 'ui-legal.png'), legalImage.toPNG());
        await mainWindow.webContents.executeJavaScript('document.querySelector("#legalAgree")?.click()');
        await new Promise((r) => setTimeout(r, 200));
        await mainWindow.webContents.executeJavaScript('document.querySelector("#legalAccept")?.click()');
        await new Promise((r) => setTimeout(r, 1500));
      }
      for (const view of ['home', 'versions', 'download', 'modrinth', 'account', 'settings']) {
        await mainWindow.webContents.executeJavaScript(
          `document.querySelector('.nav-item[data-view="${view}"]')?.click()`
        );
        await new Promise((r) => setTimeout(r, 900));
        const image = await mainWindow.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, `ui-${view}.png`), image.toPNG());
      }
      fs.writeFileSync(path.join(outDir, 'console.log'), messages.join('\n'), 'utf8');
      console.log('SMOKE_OK', messages.filter((m) => m.startsWith('[3]') || m.includes('error')).join(' | '));
    } catch (err) {
      console.error('SMOKE_FAIL', err);
    } finally {
      app.exit(0);
    }
  });
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  if (!writable) {
    dialog.showMessageBoxSync({
      type: 'error',
      title: '安装目录不可写',
      message: '无法在安装目录内写入数据。',
      detail: `所有账号、存档与缓存都保存在 ${LAUNCHER_ROOT}，但当前没有写入权限。\n\n请改用以下任一方式：\n1. 以管理员身份运行本启动器；\n2. 重新安装到你有写入权限的目录（如 D:\\Games\\xueCraft）。`,
      buttons: ['退出'],
      noLink: true,
    });
    app.exit(1);
    return;
  }
  paths.init(launcherRoot());
  paths.dirs.root();
  setupVault();
  registerIpc(() => mainWindow);
  createWindow();
  if (!migrationOk) {
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: '数据目录迁移',
      message: '旧版数据未能迁移到安装目录。',
      detail: `通常是旧版启动器仍在运行并占用了文件。${migrationNote}，账号、存档与配置不会丢失。请关闭所有正在运行的 xue Craft 启动器后重新打开，即可完成迁移。`,
      buttons: ['我知道了'],
      noLink: true,
    }).catch(() => {});
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

process.on('uncaughtException', (err) => {
  try {
    const dir = path.join(launcherRoot(), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'launcher-error.log'), `[${new Date().toISOString()}] ${err.stack || err}\n`);
  } catch {
    // 忽略记录失败
  }
  console.error('[xueCraft] 未捕获异常:', err);
});
