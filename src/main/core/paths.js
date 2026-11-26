'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

/**
 * 启动器数据目录结构（root 下）：
 *   versions/<id>/<id>.json   版本清单与版本隔离的游戏目录
 *   libraries/                Minecraft 依赖库
 *   assets/                   资源文件（indexes + objects）
 *   runtime/                  自动下载的 Java 运行时
 *   logs/                     游戏与启动器日志
 *   config.json               启动器配置
 *   accounts.json             账号数据（经 safeStorage 加密）
 */
const state = {
  root: '',
  config: null,
};

const DEFAULT_CONFIG = {
  gameDir: '',
  isolation: true,
  memoryMin: 1024,
  memoryMax: 4096,
  jvmArgs: '',
  gameArgs: '',
  javaPath: '',
  downloadConcurrency: 16,
  useMirror: true,
  selectedVersion: '',
  closeLauncherOnGameStart: false,
  language: 'zh-CN',
  // 微软 OAuth 客户端 ID；官方启动器 ID 在部分环境下不可用时会自动回退到公共客户端
  msClientId: '00000000402b5328',
};

function init(root) {
  state.root = path.resolve(root);
  state.config = null;
}

function root() {
  if (!state.root) throw new Error('启动器路径尚未初始化');
  return state.root;
}

function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const dirs = {
  root,
  versions: () => ensureDirSync(path.join(root(), 'versions')),
  version: (id) => ensureDirSync(path.join(root(), 'versions', id)),
  libraries: () => ensureDirSync(path.join(root(), 'libraries')),
  assets: () => ensureDirSync(path.join(root(), 'assets')),
  objects: () => ensureDirSync(path.join(root(), 'assets', 'objects')),
  indexes: () => ensureDirSync(path.join(root(), 'assets', 'indexes')),
  runtime: () => ensureDirSync(path.join(root(), 'runtime')),
  logs: () => ensureDirSync(path.join(root(), 'logs')),
};

function configPath() {
  return path.join(root(), 'config.json');
}

function loadConfig() {
  if (state.config) return state.config;
  let cfg = { ...DEFAULT_CONFIG };
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    cfg = { ...cfg, ...JSON.parse(raw) };
  } catch {
    // 首次运行或配置损坏时使用默认值
  }
  if (!cfg.gameDir) cfg.gameDir = path.join(root(), 'game');
  state.config = cfg;
  return cfg;
}

function saveConfig(patch) {
  const cfg = { ...loadConfig(), ...patch };
  ensureDirSync(root());
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
  state.config = cfg;
  return cfg;
}

/** 版本隔离后的游戏目录；关闭隔离时统一使用全局 gameDir */
function gameDir(versionId) {
  const cfg = loadConfig();
  if (cfg.isolation && versionId) return dirs.version(versionId);
  return ensureDirSync(cfg.gameDir);
}

/** 版本隔离目录：始终为 versions/<id>，用于存放版本 json/jar/natives 及隔离的游戏数据 */
function instanceDir(versionId) {
  return dirs.version(versionId);
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  ensureDirSync(path.dirname(file));
  await fsp.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
  return file;
}

async function exists(file) {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  DEFAULT_CONFIG,
  init,
  root,
  dirs,
  configPath,
  loadConfig,
  saveConfig,
  gameDir,
  instanceDir,
  readJson,
  writeJson,
  exists,
  ensureDirSync,
};
