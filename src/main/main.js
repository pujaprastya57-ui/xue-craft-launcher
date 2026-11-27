'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, Menu, safeStorage, shell, dialog } = require('electron');
const paths = require('./core/paths');
const microsoft = require('./auth/microsoft');
const { registerIpc } = require('./ipc');

const SMOKE_TEST = process.argv.includes('--smoke-test');
let mainWindow = null;

// 启动器数据根目录（游戏、账号、配置）
let LAUNCHER_ROOT = path.join(app.getPath('appData'), 'xueCraft');

// 兼容旧版本：把 %APPDATA%\TraeCraft 迁移到新目录。
// 优先 rename（瞬间完成）；若被占用（如旧启动器仍在运行）则重试，
// 持续失败时回退到旧目录继续运行——绝不创建空的新目录，避免老用户数据“丢失”。
let migrationOk = true;
function migrateLegacyDataDir() {
  const oldRoot = path.join(app.getPath('appData'), 'TraeCraft');
  if (!fs.existsSync(oldRoot) || fs.existsSync(LAUNCHER_ROOT)) return true;
  let lastErr = null;
  for (let i = 0; i < 6; i++) {
    try {
      fs.renameSync(oldRoot, LAUNCHER_ROOT);
      return true;
    } catch (err) {
      lastErr = err;
    }
    try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300 * (i + 1)); } catch (_) {}
  }
  console.error('[xueCraft] 数据目录迁移失败，回退到旧目录:', lastErr && lastErr.message);
  return false;
}
migrationOk = migrateLegacyDataDir();
if (!migrationOk) {
  LAUNCHER_ROOT = path.join(app.getPath('appData'), 'TraeCraft');
}

// Electron/Chromium 缓存单独存放，避免与游戏数据混淆
app.setPath('userData', path.join(LAUNCHER_ROOT, '.cache'));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock && !SMOKE_TEST) {
  app.quit();
}

app.setAppUserModelId('com.traecraft.launcher');

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
  paths.init(launcherRoot());
  paths.dirs.root();
  setupVault();
  registerIpc(() => mainWindow);
  createWindow();
  if (!migrationOk) {
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: '数据目录迁移',
      message: '检测到旧版数据目录未能迁移到 %APPDATA%\\xueCraft。',
      detail: '通常是旧版启动器仍在运行并占用了文件。本次将继续使用旧目录 %APPDATA%\\TraeCraft，账号、存档与配置不会丢失。请关闭所有正在运行的 xue Craft 启动器后重新打开，即可完成目录迁移。',
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
