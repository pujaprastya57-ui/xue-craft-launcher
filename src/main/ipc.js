'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { ipcMain, dialog, shell, app, BrowserWindow } = require('electron');
const paths = require('./core/paths');
const meta = require('./mc/meta');
const installer = require('./mc/installer');
const versions = require('./mc/versions');
const java = require('./mc/java');
const launch = require('./mc/launch');
const microsoft = require('./auth/microsoft');
const fabric = require('./loaders/fabric');
const forge = require('./loaders/forge');
const modrinthApi = require('./modrinth/api');
const modrinthInstaller = require('./modrinth/installer');
const updater = require('./updater');

/** 打开微软官方登录窗口，拦截 oauth20_desktop.srf 的跳转以获取授权码 */
function openMicrosoftLogin(parent) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 500,
      height: 760,
      parent: parent || undefined,
      modal: Boolean(parent),
      show: true,
      autoHideMenuBar: true,
      title: '登录 Microsoft 账号',
      backgroundColor: '#ffffff',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: 'persist:microsoft-login',
      },
    });

    let settled = false;
    const finish = (err, code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!win.isDestroyed()) win.close();
      if (err) reject(err);
      else resolve(code);
    };

    const inspect = (url) => {
      if (!url || !String(url).startsWith(microsoft.LIVE_REDIRECT)) return;
      try {
        const parsed = new URL(url);
        const code = parsed.searchParams.get('code');
        const error = parsed.searchParams.get('error_description') || parsed.searchParams.get('error');
        if (code) finish(null, code);
        else finish(new Error(error || '登录未返回授权码'));
      } catch {
        finish(new Error('无法解析登录回调地址'));
      }
    };

    win.webContents.on('will-redirect', (event, url) => {
      inspect(url);
      if (settled) event.preventDefault();
    });
    win.webContents.on('will-navigate', (_event, url) => inspect(url));
    win.webContents.on('did-navigate', (_event, url) => inspect(url));
    win.webContents.setWindowOpenHandler(({ url }) => {
      inspect(url);
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.on('closed', () => finish(new Error('登录窗口已关闭')));
    win.webContents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3) finish(new Error(`登录页面加载失败：${description}`));
    });

    const timer = setTimeout(() => finish(new Error('登录超时，请重试')), 15 * 60 * 1000);
    win.loadURL(microsoft.buildAuthorizeUrl()).catch((err) => finish(err));
  });
}

function registerIpc(getWindow) {
  const send = (channel, payload) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    if (channel === 'progress') updateTaskbar(win, payload);
    win.webContents.send(channel, payload);
  };
  const reporter = (scope, title) => (data) => send('progress', { scope, title, ...data });

  // ---------- 任务栏进度条 ----------
  // 只有下载/安装类任务显示在任务栏图标上，避免登录、启动游戏时误显示
  const TASKBAR_SCOPES = new Set(['install', 'repair', 'loader', 'modrinth', 'java']);
  let taskbarTimer = null;
  const resetTaskbar = () => {
    if (taskbarTimer) {
      clearTimeout(taskbarTimer);
      taskbarTimer = null;
    }
    const win = getWindow();
    if (win && !win.isDestroyed()) win.setProgressBar(-1);
  };
  function updateTaskbar(win, payload) {
    if (!payload || !TASKBAR_SCOPES.has(payload.scope)) return;
    if (taskbarTimer) {
      clearTimeout(taskbarTimer);
      taskbarTimer = null;
    }
    if (payload.phase === 'done') {
      win.setProgressBar(1);
      taskbarTimer = setTimeout(resetTaskbar, 1200);
      taskbarTimer.unref?.();
      return;
    }
    const total = Number(payload.total || 0);
    const done = Number(payload.completed || 0);
    const bytesTotal = Number(payload.bytesTotal || 0);
    const bytesDone = Number(payload.bytesDone || 0);
    let fraction = -1;
    if (bytesTotal > 0) fraction = bytesDone / bytesTotal;
    else if (total > 0) fraction = done / total;
    if (fraction < 0) {
      // 无法估算时显示滚动的不确定进度
      try {
        win.setProgressBar(1, { status: 'indeterminate' });
      } catch {
        win.setProgressBar(0.5);
      }
      return;
    }
    win.setProgressBar(Math.max(0.01, Math.min(1, fraction)));
  }

  // 同一时间只允许一个耗时任务（下载/安装/修复），避免下载未完成时启动导致相互等待
  let activeTask = null;
  const exclusive = async (label, fn) => {
    if (activeTask) throw new Error(`正在${activeTask}，请等待完成后再操作`);
    activeTask = label;
    try {
      return await fn();
    } catch (err) {
      resetTaskbar();
      throw err;
    } finally {
      activeTask = null;
    }
  };

  ipcMain.handle('app:info', async () => {
    const config = paths.loadConfig();
    const accounts = await microsoft.listAccounts();
    return {
      root: paths.root(),
      config,
      accounts: accounts.accounts,
      activeId: accounts.activeId,
      java: java.detectInstalled(),
      versions: await versions.listLocalVersions(),
      appVersion: app.getVersion(),
      platform: process.platform,
    };
  });

  ipcMain.handle('config:get', () => paths.loadConfig());
  ipcMain.handle('config:save', (_e, patch) => {
    const config = paths.saveConfig(patch || {});
    if (patch && patch.javaPath !== undefined) java.detectInstalled({ rescan: true });
    return config;
  });
  ipcMain.handle('config:pickDir', async () => {
    const result = await dialog.showOpenDialog(getWindow(), { properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? '' : result.filePaths[0];
  });
  ipcMain.handle('config:pickJava', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      properties: ['openFile'],
      filters: [{ name: 'Java 可执行文件', extensions: ['exe'] }],
    });
    return result.canceled ? '' : result.filePaths[0];
  });
  ipcMain.handle('java:detect', () => java.detectInstalled({ rescan: true }));
  ipcMain.handle('java:download', async (_e, major) => java.ensureJava(major, { onProgress: reporter('java', 'Java 运行时') }));

  // ---------- 账号 ----------
  // 浏览器登录（推荐）：官方 MSA 客户端 ID，登录窗口捕获授权码
  ipcMain.handle('auth:loginBrowser', async () => {
    const code = await openMicrosoftLogin(getWindow());
    send('auth:status', { phase: 'xbox', message: '正在验证 Xbox 账号…' });
    const account = await microsoft.loginWithLiveCode(code);
    send('auth:state', await microsoft.listAccounts());
    return account;
  });

  // 设备代码登录：需要支持设备代码流的 Entra 应用客户端 ID
  const startDeviceLogin = async () => {
    const code = await microsoft.requestDeviceCode();
    if (code.verificationUri) shell.openExternal(code.verificationUri).catch(() => {});
    microsoft
      .pollForAccount(code.deviceCode, {
        interval: code.interval,
        expiresIn: code.expiresIn,
        clientId: code.clientId,
        onStatus: (status) => send('auth:status', status),
      })
      .then(async () => {
        const accounts = await microsoft.listAccounts();
        send('auth:state', accounts);
        send('progress', { scope: 'auth', phase: 'done', message: '登录成功', completed: 1, total: 1 });
      })
      .catch((err) => send('auth:error', { message: err.message }));
    return { userCode: code.userCode, verificationUri: code.verificationUri, expiresIn: code.expiresIn };
  };
  ipcMain.handle('auth:loginDevice', startDeviceLogin);
  ipcMain.handle('auth:login', startDeviceLogin);
  ipcMain.handle('auth:accounts', () => microsoft.listAccounts());
  ipcMain.handle('auth:setActive', async (_e, uuid) => microsoft.setActive(uuid));
  ipcMain.handle('auth:logout', async (_e, uuid) => microsoft.removeAccount(uuid));

  // ---------- 版本 ----------
  ipcMain.handle('mc:manifest', async (_e, type) => meta.listVersions({ type: type || 'all' }));
  ipcMain.handle('versions:local', () => versions.listLocalVersions());
  ipcMain.handle('versions:detail', (_e, id) => versions.versionDetail(id));
  ipcMain.handle('versions:delete', async (_e, id) => {
    const result = await versions.deleteVersion(id);
    const cfg = paths.loadConfig();
    if (cfg.selectedVersion === id) paths.saveConfig({ selectedVersion: '' });
    return result;
  });
  ipcMain.handle('versions:saves', (_e, id) => versions.listSaves(id));
  ipcMain.handle('versions:openDir', (_e, id) => shell.openPath(paths.dirs.version(id)));

  ipcMain.handle('mc:install', async (_e, versionId) =>
    exclusive(`下载 ${versionId}`, () => installer.installVersion(versionId, { report: reporter('install', versionId) }))
  );
  ipcMain.handle('mc:repair', async (_e, versionId) =>
    exclusive(`修复 ${versionId}`, () => installer.repairVersion(versionId, { report: reporter('repair', versionId) }))
  );

  // ---------- 加载器 ----------
  ipcMain.handle('loaders:fabricVersions', (_e, mc) => fabric.listFabricLoaders(mc));
  ipcMain.handle('loaders:forgeVersions', (_e, mc) => forge.listForgeVersions(mc));
  ipcMain.handle('loaders:neoForgeVersions', (_e, mc) => forge.listNeoForgeVersions(mc));
  ipcMain.handle('loaders:install', async (_e, { type, mc, version }) =>
    exclusive('安装加载器', async () => {
      const report = reporter('loader', `${type} ${version}`);
      if (type === 'fabric') return fabric.installFabric(mc, version, { report });
      if (type === 'forge') return forge.installForge(mc, version, { report });
      if (type === 'neoforge') return forge.installNeoForge(mc, version, { report });
      throw new Error(`未知的加载器类型：${type}`);
    })
  );

  // ---------- Modrinth ----------
  ipcMain.handle('modrinth:search', (_e, options) => modrinthApi.search(options || {}));
  ipcMain.handle('modrinth:project', (_e, id) => modrinthApi.getProject(id));
  ipcMain.handle('modrinth:versions', (_e, { projectId, gameVersion, loader }) =>
    modrinthApi.getVersions(projectId, { gameVersion, loader })
  );
  ipcMain.handle('modrinth:install', async (_e, payload) =>
    exclusive('安装 Modrinth 资源', async () => {
      const report = reporter('modrinth', 'Modrinth');
      if (payload.contentType === 'modpack') {
        return modrinthInstaller.installModpack({ projectId: payload.projectId, versionId: payload.versionId, report });
      }
      return modrinthInstaller.installContent({ ...payload, report });
    })
  );
  ipcMain.handle('modrinth:pickPackFile', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      properties: ['openFile'],
      filters: [{ name: 'Modrinth 整合包', extensions: ['mrpack'] }],
    });
    return result.canceled ? '' : result.filePaths[0];
  });
  ipcMain.handle('modrinth:installPackFile', async (_e, filePath) =>
    exclusive('导入整合包', () =>
      modrinthInstaller.installModpackFromFile(filePath, { report: reporter('modrinth', '整合包') })
    )
  );

  // ---------- 启动器自更新 ----------
  ipcMain.handle('updater:current', () => updater.currentVersion());
  ipcMain.handle('updater:pickInstaller', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      properties: ['openFile'],
      filters: [{ name: 'xue Craft launcher 安装包', extensions: ['exe'] }],
    });
    return result.canceled ? '' : result.filePaths[0];
  });
  ipcMain.handle('updater:applyInstaller', async (_e, filePath) =>
    updater.applyInstaller(filePath, { getWindow })
  );

  // ---------- 启动 ----------
  ipcMain.handle('game:launch', async (_e, versionId) => {
    if (activeTask) throw new Error(`正在${activeTask}，请等待完成后再启动游戏`);
    const local = await versions.listLocalVersions();
    const target = local.find((v) => v.id === versionId);
    if (!target) throw new Error(`版本「${versionId}」尚未安装完成，请先等待下载结束或重新安装`);
    if (!target.hasJar) throw new Error(`版本「${versionId}」主文件尚未就绪，请等待下载完成或在「版本管理」中点击「修复」`);

    const account = await microsoft.getAccountForLaunch();
    const report = reporter('launch', versionId);
    let lastLogAt = 0;
    const child = await exclusive('启动游戏', () =>
      launch.launchGame(versionId, account, {
        onProgress: (p) => report({ ...p, message: p.message || '正在准备启动' }),
        onLog: (data) => {
          const now = Date.now();
          if (now - lastLogAt > 40) {
            lastLogAt = now;
            send('game:log', data);
          }
        },
        onExit: (data) => send('game:exit', data),
      })
    );
    return { pid: child.pid, logFile: child.logFile };
  });
  ipcMain.handle('game:openFolder', (_e, versionId) => shell.openPath(paths.gameDir(versionId)));
  ipcMain.handle('logs:openDir', () => shell.openPath(paths.dirs.logs()));
  ipcMain.handle('logs:latest', async (_e, versionId) => {
    const dir = paths.dirs.logs();
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(`${versionId}-`))
      .map((f) => ({ name: f, time: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    if (!files.length) return { name: '', content: '' };
    const latest = files[0];
    return { name: latest.name, content: fs.readFileSync(path.join(dir, latest.name), 'utf8').slice(-20000) };
  });
  ipcMain.handle('shell:openExternal', (_e, url) => {
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url);
    return null;
  });
}

module.exports = { registerIpc };
