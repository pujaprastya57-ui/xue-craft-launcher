'use strict';

const { app, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/** 当前启动器版本 */
function currentVersion() {
  return app.getVersion();
}

/** 解析 x.y.z 版本号为数字数组 */
function parseVersion(value) {
  return String(value || '')
    .trim()
    .split(/[._-]/)
    .slice(0, 3)
    .map((n) => parseInt(n, 10) || 0);
}

/** 比较两个版本号：a>b 返回 1，a<b 返回 -1，相等返回 0 */
function compareVersion(a, b) {
  const A = parseVersion(a);
  const B = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (A[i] > B[i]) return 1;
    if (A[i] < B[i]) return -1;
  }
  return 0;
}

const FILENAME_VERSION_RE = /(\d+\.\d+\.\d+)/;

/** 从文件名（xueCraft-Setup-1.4.2.exe）解析版本号 */
function versionFromFileName(filePath) {
  const base = path.basename(filePath);
  const m = base.match(FILENAME_VERSION_RE);
  return m ? m[1] : '';
}

/** 通过 PowerShell 读取 exe 的文件版本信息（作为文件名解析的交叉校验） */
function getFileVersion(filePath) {
  return new Promise((resolve) => {
    try {
      const escaped = filePath.replace(/'/g, "''");
      const ps = `(Get-Item -LiteralPath '${escaped}').VersionInfo.FileVersion`;
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
        windowsHide: true,
      });
      let out = '';
      child.stdout.on('data', (data) => {
        out += data.toString();
      });
      child.on('error', () => resolve(''));
      child.on('close', () => resolve(out.trim()));
      setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        resolve('');
      }, 8000).unref?.();
    } catch {
      resolve('');
    }
  });
}

/** 识别安装包版本：优先文件版本信息，回退到文件名 */
async function detectInstallerVersion(filePath) {
  const byFile = await getFileVersion(filePath);
  const byName = versionFromFileName(filePath);
  if (byFile && parseVersion(byFile)[0]) return byFile;
  return byName;
}

/** 判断是否为 xue Craft launcher 的 NSIS 安装包（便携版 exe 不能用于更新） */
function isLikelyInstaller(filePath) {
  if (!filePath || !/\.exe$/i.test(filePath)) return false;
  const base = path.basename(filePath).toLowerCase();
  const compact = base.replace(/[\s_-]/g, '');
  if (!compact.includes('xuecraft') && !compact.includes('traecraft')) return false;
  if (base.includes('portable')) return false;
  return base.includes('setup') || base.includes('install');
}

/**
 * 直接拉起 NSIS 安装包：
 * /S 静默安装（安装器会自动关闭仍在运行的旧版进程），
 * --force-run 让安装器在装完后自动启动新版本。
 * 全程无控制台窗口，无需额外的脚本助手。
 */
function launchInstaller(filePath) {
  try {
    const child = spawn(filePath, ['/S', '--force-run'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', () => {
      shell.openPath(filePath).catch(() => {});
    });
    child.unref();
    return true;
  } catch (err) {
    console.error('[xueCraft] 启动安装包失败:', err);
    shell.openPath(filePath).catch(() => {});
    return false;
  }
}

/**
 * 导入并应用安装包：校验版本、向用户确认，确认后在退出时静默安装。
 * @returns {{cancelled?: boolean, applying?: boolean, current: string, detected: string, newer: boolean}}
 */
async function applyInstaller(filePath, { getWindow } = {}) {
  if (process.platform !== 'win32') {
    throw new Error('当前平台不支持通过安装包更新');
  }
  if (!app.isPackaged) {
    throw new Error('开发模式不支持自动更新，请在已安装的正式版本中使用');
  }
  if (!filePath) throw new Error('未选择更新包');
  if (!fs.existsSync(filePath)) throw new Error('更新包文件不存在');
  if (!isLikelyInstaller(filePath)) {
    throw new Error('文件不是有效的安装包（应为 xueCraft-Setup-x.x.x.exe，便携版无法用于更新）');
  }

  const detected = await detectInstallerVersion(filePath);
  const current = currentVersion();
  const newer = detected ? compareVersion(detected, current) > 0 : true;
  const same = detected ? compareVersion(detected, current) === 0 : false;

  const detail = same
    ? '该版本与当前启动器版本相同，仍可重新安装以修复损坏的文件。'
    : newer
      ? '更新完成后会自动启动新版本；账号、存档与设置保存在 %APPDATA%\\TraeCraft，不会丢失。'
      : '该更新包版本低于当前版本，安装后会降级到旧版本。';

  const result = await dialog.showMessageBox(getWindow ? getWindow() : undefined, {
    type: 'question',
    buttons: ['取消', '开始更新'],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
    title: '更新 xue Craft launcher',
    message: detected
      ? `更新包版本：${detected}\n当前版本：${current}`
      : `当前版本：${current}\n未能识别更新包版本，仍尝试安装。`,
    detail,
  });

  if (result.response !== 1) {
    return { cancelled: true, current, detected, newer };
  }

  // 先拉起安装包，再立即退出本进程；安装器会负责关闭残留进程并在装完后启动新版
  launchInstaller(filePath);
  setTimeout(() => app.exit(0), 1200);
  return { applying: true, current, detected, newer };
}

module.exports = {
  currentVersion,
  compareVersion,
  detectInstallerVersion,
  isLikelyInstaller,
  applyInstaller,
};
