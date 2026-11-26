'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, Menu, safeStorage, shell } = require('electron');
const paths = require('./core/paths');
const microsoft = require('./auth/microsoft');
const { registerIpc } = require('./ipc');

const SMOKE_TEST = process.argv.includes('--smoke-test');
let mainWindow = null;

// 启动器数据根目录（游戏、账号、配置）
const LAUNCHER_ROOT = path.join(app.getPath('appData'), 'TraeCraft');
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
