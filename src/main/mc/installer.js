'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const paths = require('../core/paths');
const { DownloadQueue } = require('../core/download');
const { extractZipFile } = require('../core/zip');
const { downloadFile, fileSha1 } = require('../core/http');
const { evaluateRules, libraryArtifact, libraryNative, currentOs } = require('../core/rules');
const meta = require('./meta');

function progress(report, data) {
  if (typeof report === 'function') report(data);
}

/** 解析依赖库列表，区分普通库与需要解压的 natives */
function collectLibraries(resolved) {
  const sys = currentOs();
  const features = {};
  const artifacts = [];
  const natives = [];
  const seen = new Set();

  for (const lib of resolved.libraries || []) {
    if (!evaluateRules(lib.rules, features, sys)) continue;
    const artifact = libraryArtifact(lib);
    if (artifact && artifact.url && !seen.has(artifact.path)) {
      seen.add(artifact.path);
      artifacts.push(artifact);
    }
    const native = libraryNative(lib, sys);
    if (native && native.url && !seen.has(native.path)) {
      seen.add(native.path);
      natives.push(native);
    }
  }
  return { artifacts, natives };
}

/** 解压 natives jar 到版本目录的 natives 子目录 */
async function extractNatives(nativeDir, natives, report) {
  await fsp.mkdir(nativeDir, { recursive: true });
  for (const native of natives) {
    const jarPath = path.join(paths.dirs.libraries(), native.path);
    if (!fs.existsSync(jarPath)) continue;
    const excludes = (native.lib.extract && native.lib.extract.exclude) || ['META-INF/'];
    try {
      await extractZipFile(jarPath, nativeDir, {
        filter: (name) => !excludes.some((ex) => name.startsWith(ex)) && !name.endsWith('/'),
      });
    } catch (err) {
      progress(report, { phase: 'natives', message: `解压 ${path.basename(jarPath)} 失败：${err.message}` });
    }
  }
}

/** 下载某个版本的资源索引与全部资源对象 */
async function installAssets(resolved, { report, concurrency, useMirror, gameDirectory } = {}) {
  const index = resolved.assetIndex;
  if (!index) return { count: 0 };
  const indexDest = path.join(paths.dirs.indexes(), `${index.id}.json`);
  await downloadFile(index.url, indexDest, { sha1: index.sha1, size: index.size, useMirror });
  const assetIndex = await paths.readJson(indexDest, { objects: {} });
  const objects = Object.entries(assetIndex.objects || {});
  progress(report, {
    phase: 'assets',
    message: `准备下载资源文件（${objects.length} 个）`,
    completed: 0,
    total: objects.length,
  });

  const queue = new DownloadQueue({ concurrency, useMirror, phase: 'assets' });
  for (const [name, obj] of objects) {
    const sub = obj.hash.slice(0, 2);
    queue.add({
      url: `https://resources.download.minecraft.net/${sub}/${obj.hash}`,
      dest: path.join(paths.dirs.objects(), sub, obj.hash),
      sha1: obj.hash,
      size: obj.size,
      name,
    });
  }
  queue.on('progress', (p) => progress(report, { ...p, message: '正在下载游戏资源' }));
  const result = await queue.run();

  // 旧版本资源映射：virtual（1.6 之前）与 map_to_resources
  const legacyTarget =
    assetIndex.virtual
      ? path.join(paths.dirs.assets(), 'virtual', assetIndex.id)
      : resolved.assets === 'pre-1.6' || assetIndex.map_to_resources
        ? path.join(gameDirectory || paths.gameDir(), 'resources')
        : null;
  if (legacyTarget) {
    progress(report, { phase: 'assets', message: '正在映射旧版资源文件' });
    for (const [name, obj] of objects) {
      const src = path.join(paths.dirs.objects(), obj.hash.slice(0, 2), obj.hash);
      const dest = path.join(legacyTarget, ...name.split('/'));
      if (!fs.existsSync(src)) continue;
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.copyFile(src, dest).catch(() => {});
    }
  }
  return { count: objects.length, failed: result.failed };
}

async function installLoggingConfig(resolved, report) {
  const file = resolved.logging && resolved.logging.client && resolved.logging.client.file;
  if (!file) return;
  const dest = path.join(paths.dirs.assets(), 'log_configs', file.id);
  await downloadFile(file.url, dest, { sha1: file.sha1, size: file.size, useMirror: paths.loadConfig().useMirror });
  resolved._logConfigPath = dest;
}

/**
 * 安装已解析的版本（原版或加载器版本）
 */
async function installResolved(resolved, versionId, { report, skipAssets = false, versionTypeLabel } = {}) {
  const cfg = paths.loadConfig();
  const concurrency = cfg.downloadConcurrency || 16;
  const useMirror = cfg.useMirror;
  const versionDir = paths.dirs.version(versionId);
  // 继承版本（Fabric/Forge/整合包）复用父版本客户端 jar
  const jarId = resolved.jar || resolved.inheritsFrom || versionId;
  const jarPath = path.join(paths.dirs.version(jarId), `${jarId}.jar`);
  const gameDirectory = paths.gameDir(versionId);

  const result = { versionId, libraries: 0, assets: 0, natives: 0, failed: [], jarPath };

  // 1. 客户端主 jar
  if (resolved.downloads && resolved.downloads.client) {
    const client = resolved.downloads.client;
    let valid = false;
    try {
      const stat = await fsp.stat(jarPath);
      if (stat.size > 0) valid = (await fileSha1(jarPath)).toLowerCase() === String(client.sha1).toLowerCase();
    } catch {
      valid = false;
    }
    if (!valid) {
      progress(report, { phase: 'client', message: '正在下载客户端主文件', completed: 0, total: 1 });
      await downloadFile(client.url, jarPath, {
        sha1: client.sha1,
        size: client.size,
        useMirror,
        onProgress: (p) => progress(report, { ...p, phase: 'client', message: '正在下载客户端主文件' }),
      });
    }
    result.jarPath = jarPath;
  }

  // 2. 依赖库与 natives
  const { artifacts, natives } = collectLibraries(resolved);
  progress(report, {
    phase: 'libraries',
    message: `准备下载依赖库（${artifacts.length} 个）`,
    completed: 0,
    total: artifacts.length,
  });
  const queue = new DownloadQueue({ concurrency, useMirror, phase: 'libraries' });
  for (const artifact of artifacts) {
    queue.add({
      url: artifact.url,
      dest: path.join(paths.dirs.libraries(), artifact.path),
      sha1: artifact.sha1,
      size: artifact.size,
      name: artifact.path,
    });
  }
  for (const native of natives) {
    queue.add({
      url: native.url,
      dest: path.join(paths.dirs.libraries(), native.path),
      sha1: native.sha1,
      size: native.size,
      name: native.path,
    });
  }
  queue.on('progress', (p) => progress(report, { ...p, message: '正在下载依赖库' }));
  const libResult = await queue.run();
  result.libraries = artifacts.length + natives.length;
  result.failed.push(...libResult.failed);

  if (natives.length) {
    progress(report, { phase: 'natives', message: '正在解压本地库文件' });
    await extractNatives(path.join(versionDir, 'natives'), natives, report);
    result.natives = natives.length;
  }

  // 3. 资源文件
  if (!skipAssets) {
    const assets = await installAssets(resolved, { report, concurrency, useMirror, gameDirectory });
    result.assets = assets.count;
    if (assets.failed) result.failed.push(...assets.failed);
  }

  // 4. 日志配置
  await installLoggingConfig(resolved, report).catch(() => {});

  // 5. 初始化隔离的游戏目录
  for (const sub of ['mods', 'saves', 'resourcepacks', 'shaderpacks', 'config', 'logs']) {
    await fsp.mkdir(path.join(gameDirectory, sub), { recursive: true }).catch(() => {});
  }

  result.failedCount = result.failed.length;
  progress(report, {
    phase: 'done',
    message: result.failedCount ? `安装完成，但有 ${result.failedCount} 个文件下载失败` : '安装完成',
    completed: 1,
    total: 1,
  });
  return result;
}

/** 安装原版版本（含版本 json 下载与继承解析） */
async function installVersion(id, { report, skipAssets = false } = {}) {
  let local = await meta.readLocalVersionJson(id);
  if (!local) {
    progress(report, { phase: 'meta', message: `正在获取 ${id} 的版本信息`, completed: 0, total: 1 });
    local = await meta.fetchVersionJson(id);
  }
  // 先确保继承的父版本已安装，否则无法解析完整清单
  if (local.inheritsFrom) {
    const parentLocal = await meta.readLocalVersionJson(local.inheritsFrom);
    if (!parentLocal) await installVersion(local.inheritsFrom, { report, skipAssets });
  }
  const resolved = await meta.resolveVersion(id);
  // 继承版本的资源文件由父版本负责
  const shouldSkipAssets = skipAssets || Boolean(resolved.inheritsFrom);
  return installResolved(resolved, id, { report, skipAssets: shouldSkipAssets });
}

/**
 * 校验并修复版本：重新校验所有文件 SHA1，损坏或缺失的会重新下载
 */
async function repairVersion(id, { report } = {}) {
  const resolved = await meta.resolveVersion(id);
  return installResolved(resolved, id, { report });
}

module.exports = { installVersion, installResolved, repairVersion, collectLibraries, installAssets };
