'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const paths = require('../core/paths');
const { evaluateRules, libraryArtifact, currentOs } = require('../core/rules');
const meta = require('./meta');
const { ensureJava } = require('./java');

const LAUNCHER_NAME = 'xue Craft launcher';
const LAUNCHER_VERSION = '1.0.0';

/** 拆分带引号的参数字符串 */
function splitArgs(text) {
  const result = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = regex.exec(text || ''))) result.push(match[1] ?? match[2] ?? match[3]);
  return result;
}

function substitute(value, mapping) {
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{([^}]+)\}/g, (whole, key) => (key in mapping ? String(mapping[key]) : whole));
}

/** 展开现代版本 arguments 数组（支持规则与 ${} 占位符） */
function expandArguments(list, mapping) {
  const features = {};
  const sys = currentOs();
  const out = [];
  for (const item of list || []) {
    if (typeof item === 'string') {
      out.push(substitute(item, mapping));
      continue;
    }
    if (item && typeof item === 'object' && item.value) {
      if (!evaluateRules(item.rules, features, sys)) continue;
      const values = Array.isArray(item.value) ? item.value : [item.value];
      for (const v of values) out.push(substitute(v, mapping));
    }
  }
  return out;
}

/** 收集 classpath（按规则过滤） */
function buildClasspath(resolved, versionId) {
  const sys = currentOs();
  const entries = [];
  // Forge / NeoForge 1.17+ 由 Bootstraplauncher 自行构建 minecraft 模块，
  // 原版客户端 jar 若同时出现在 classpath 会造成模块包冲突，必须排除
  const usesBootstrap = resolved.mainClass === 'cpw.mods.bootstraplauncher.BootstrapLauncher';
  const jarId = resolved.jar || resolved.inheritsFrom || versionId;
  const clientJar = path.join(paths.dirs.version(jarId), `${jarId}.jar`);
  for (const lib of resolved.libraries || []) {
    if (!evaluateRules(lib.rules, {}, sys)) continue;
    const artifact = libraryArtifact(lib);
    if (!artifact) continue;
    const file = path.join(paths.dirs.libraries(), artifact.path);
    if (fs.existsSync(file) && !entries.includes(file)) entries.push(file);
  }
  if (!usesBootstrap && fs.existsSync(clientJar) && !entries.includes(clientJar)) entries.push(clientJar);
  return entries;
}

/** 在继承链中寻找已解压的 natives 目录 */
function resolveNativesDir(resolved, versionId) {
  const chain = [versionId, ...(resolved._inheritsChain || [])];
  for (const id of chain) {
    const dir = path.join(paths.dirs.versions(), id, 'natives');
    try {
      if (fs.readdirSync(dir).length > 0) return dir;
    } catch {
      // 目录不存在则继续查找父版本
    }
  }
  return path.join(paths.dirs.version(versionId), 'natives');
}

/**
 * 构建启动参数
 */
async function buildLaunch(versionId, account, { onProgress } = {}) {
  const cfg = paths.loadConfig();
  const resolved = await meta.resolveVersion(versionId);
  const javaMajor = (resolved.javaVersion && resolved.javaVersion.majorVersion) || 8;
  const java = await ensureJava(javaMajor, { onProgress });
  const gameDir = paths.gameDir(versionId);
  const nativesDir = path.join(paths.dirs.versions(), versionId, 'natives');
  fs.mkdirSync(nativesDir, { recursive: true });
  const classpath = buildClasspath(resolved, versionId);
  // 下载尚未完成或文件缺失时给出明确提示，避免启动后只报 ClassNotFound
  const usesBootstrap = resolved.mainClass === 'cpw.mods.bootstraplauncher.BootstrapLauncher';
  if (!classpath.length) {
    throw new Error('版本文件尚未下载完成，请等待下载结束或在「版本管理」中点击「修复」');
  }
  if (!usesBootstrap) {
    const jarId = resolved.jar || resolved.inheritsFrom || versionId;
    const clientJar = path.join(paths.dirs.version(jarId), `${jarId}.jar`);
    if (!fs.existsSync(clientJar)) {
      throw new Error(`版本「${jarId}」的客户端主文件缺失，请在「版本管理」中点击「修复」后重试`);
    }
  }
  const sep = process.platform === 'win32' ? ';' : ':';
  const nativeDirPath = resolveNativesDir(resolved, versionId);
  const assetIndexName = resolved.assetIndexId || (resolved.assetIndex && resolved.assetIndex.id) || 'legacy';

  const mapping = {
    auth_player_name: account.name || 'Player',
    version_name: versionId,
    game_directory: gameDir,
    assets_root: path.join(paths.root(), 'assets'),
    game_assets: path.join(paths.root(), 'assets', 'virtual', assetIndexName),
    assets_index_name: assetIndexName,
    auth_uuid: String(account.uuid || '').replace(/-/g, ''),
    auth_access_token: account.accessToken || '',
    auth_session: `token:${account.accessToken || ''}:${String(account.uuid || '').replace(/-/g, '')}`,
    user_type: 'msa',
    version_type: resolved.type || 'release',
    user_properties: '{}',
    clientid: '00000000402b5328',
    auth_xuid: account.xuid || '',
    launcher_name: LAUNCHER_NAME,
    launcher_version: LAUNCHER_VERSION,
    natives_directory: nativeDirPath,
    library_directory: paths.dirs.libraries(),
    classpath: classpath.join(sep),
    classpath_separator: sep,
  };

  const jvmArgs = [];
  if (cfg.memoryMin) jvmArgs.push(`-Xms${cfg.memoryMin}M`);
  if (cfg.memoryMax) jvmArgs.push(`-Xmx${cfg.memoryMax}M`);
  jvmArgs.push('-Dlog4j2.formatMsgNoLookups=true');
  jvmArgs.push(`-Dminecraft.launcher.brand=${LAUNCHER_NAME}`);
  jvmArgs.push(`-Dminecraft.launcher.version=${LAUNCHER_VERSION}`);

  if (resolved.arguments && Array.isArray(resolved.arguments.jvm)) {
    jvmArgs.push(...expandArguments(resolved.arguments.jvm, mapping));
    const logCfg = resolved.logging && resolved.logging.client;
    if (logCfg && logCfg.argument && logCfg.file) {
      const logFile = path.join(paths.dirs.assets(), 'log_configs', logCfg.file.id);
      if (fs.existsSync(logFile)) jvmArgs.push(substitute(logCfg.argument, { path: logFile }));
    }
    if (!jvmArgs.some((a) => a.includes('-Djava.library.path'))) {
      jvmArgs.push(`-Djava.library.path=${nativeDirPath}`);
    }
    if (!jvmArgs.some((a) => a === '-cp' || a === '-classpath')) {
      jvmArgs.push('-cp', classpath.join(sep));
    }
  } else {
    if (resolved.logging && resolved.logging.client && resolved.logging.client.argument) {
      const logConfig = path.join(paths.dirs.assets(), 'log_configs', resolved.logging.client.file.id);
      jvmArgs.push(resolved.logging.client.argument.replace('${path}', logConfig));
    }
    jvmArgs.push(`-Djava.library.path=${nativeDirPath}`, '-cp', classpath.join(sep));
  }

  if (cfg.jvmArgs) jvmArgs.push(...splitArgs(cfg.jvmArgs));

  let gameArgs;
  if (resolved.arguments && Array.isArray(resolved.arguments.game)) {
    gameArgs = expandArguments(resolved.arguments.game, mapping);
  } else {
    gameArgs = splitArgs(resolved.minecraftArguments || '').map((a) => substitute(a, mapping));
  }
  if (cfg.gameArgs) gameArgs.push(...splitArgs(cfg.gameArgs));

  const args = [...jvmArgs, resolved.mainClass, ...gameArgs];
  return {
    javaPath: java.path,
    javaMajor: java.major,
    args,
    cwd: gameDir,
    classpath,
    versionId,
  };
}

/**
 * 启动游戏，返回子进程；日志写入 logs 目录并回调
 */
async function launchGame(versionId, account, { onLog, onExit, onProgress } = {}) {
  if (!account || !account.accessToken) throw new Error('请先登录微软账号');
  const launch = await buildLaunch(versionId, account, { onProgress });
  const logDir = paths.dirs.logs();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(logDir, `${versionId}-${stamp}.log`);
  const stream = fs.createWriteStream(logFile, { flags: 'a' });
  stream.write(`[xueCraft] Java: ${launch.javaPath}\n`);
  stream.write(`[xueCraft] 工作目录: ${launch.cwd}\n`);
  stream.write(`[xueCraft] 启动参数: ${launch.args.join(' ')}\n\n`);

  const child = spawn(launch.javaPath, launch.args, {
    cwd: launch.cwd,
    windowsHide: true,
    env: { ...process.env },
  });

  const emit = (line, streamName) => {
    stream.write(line + '\n');
    if (onLog) onLog({ versionId, line, stream: streamName });
  };

  let buffer = '';
  const handle = (chunk, name) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) if (line.trim()) emit(line, name);
  };
  child.stdout.on('data', (c) => handle(c, 'stdout'));
  child.stderr.on('data', (c) => handle(c, 'stderr'));
  child.on('error', (err) => emit(`[启动失败] ${err.message}`, 'stderr'));
  child.on('exit', (code, signal) => {
    if (buffer.trim()) emit(buffer, 'stdout');
    stream.end();
    if (onExit) onExit({ versionId, code, signal, logFile });
  });

  return { pid: child.pid, logFile, launch, child };
}

module.exports = { buildLaunch, launchGame, buildClasspath, splitArgs };
