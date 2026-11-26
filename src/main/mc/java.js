'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const paths = require('../core/paths');
const { fetchJson, downloadFile } = require('../core/http');
const { extractZipFile } = require('../core/zip');
const { DownloadQueue } = require('../core/download');

const ADOPTIUM_API = 'https://api.adoptium.net/v3/assets/latest';
// Mojang 官方 Java 运行时清单（与官方启动器一致，作为 Adoptium 不可用时的回退）
const JAVA_RUNTIME_ALL = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';
const cache = { list: null };

function runVersion(exe) {
  try {
    const res = spawnSync(exe, ['-version'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    const text = `${res.stdout || ''}\n${res.stderr || ''}`;
    const match = text.match(/version "(\d+)(?:\.(\d+))?/);
    if (!match) return null;
    const first = Number(match[1]);
    // 1.8.0_xxx 形式的主版本号为 8
    const major = first === 1 && match[2] ? Number(match[2]) : first;
    return { major, raw: text.trim().split(/\r?\n/)[0] };
  } catch {
    return null;
  }
}

function javaExeIn(dir) {
  // 使用 java.exe 以便捕获 -version 输出；启动时通过 windowsHide 隐藏控制台
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidate = path.join(dir, 'bin', exe);
  return fs.existsSync(candidate) ? candidate : null;
}

/** 在目录中递归查找 Java 主目录（最多 3 层，兼容 runtime/temurin-17/jdk-17.x 结构） */
function scanJavaHomes(root, depth = 2, out = []) {
  if (!root || !fs.existsSync(root)) return out;
  if (javaExeIn(root)) {
    out.push(root);
    return out;
  }
  if (depth <= 0) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) scanJavaHomes(path.join(root, entry.name), depth - 1, out);
  }
  return out;
}

function commonJavaDirs() {
  const env = process.env;
  const dirs = [];
  if (env.JAVA_HOME) dirs.push(env.JAVA_HOME);
  const roots = [
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Microsoft',
    'C:\\Program Files\\Amazon Corretto',
    'C:\\Program Files\\Zulu',
    'C:\\Program Files\\BellSoft',
    path.join(env.LOCALAPPDATA || '', 'Programs', 'Eclipse Adoptium'),
    path.join(env.LOCALAPPDATA || '', 'Programs', 'Microsoft'),
    path.join(paths.root(), 'runtime'),
  ];
  for (const root of roots) scanJavaHomes(root, 2, dirs);
  return dirs;
}

/** 扫描本机可用的 Java（含启动器自动下载的运行时） */
function detectInstalled({ rescan = false } = {}) {
  if (cache.list && !rescan) return cache.list;
  const found = [];
  const seen = new Set();
  const push = (exe) => {
    if (!exe || seen.has(exe)) return;
    seen.add(exe);
    const info = runVersion(exe);
    if (info) found.push({ path: exe, major: info.major, version: info.raw });
  };

  const configured = paths.loadConfig().javaPath;
  if (configured) {
    push(fs.existsSync(configured) && configured.endsWith('.exe') ? configured : javaExeIn(configured));
  }

  for (const dir of commonJavaDirs()) push(javaExeIn(dir));

  const where = spawnSync('where', ['java'], { encoding: 'utf8', windowsHide: true });
  if (where.stdout) {
    for (const line of where.stdout.split(/\r?\n/).filter(Boolean)) {
      push(path.join(path.dirname(line.trim()), process.platform === 'win32' ? 'javaw.exe' : 'java'));
    }
  }

  found.sort((a, b) => b.major - a.major);
  cache.list = found;
  return found;
}

/** 选择满足要求的最佳 Java：优选取主版本完全一致的，其次取更高的 */
function pickJava(major) {
  const list = detectInstalled();
  if (!list.length) return null;
  const exact = list.filter((j) => j.major === major);
  if (exact.length) return exact[0];
  const higher = list.filter((j) => j.major > major).sort((a, b) => a.major - b.major);
  if (higher.length) return higher[0];
  return null;
}

/** 使用 Mojang 官方运行时清单下载 Java（与官方启动器一致，支持镜像回退） */
async function downloadMojangRuntime(major, { onProgress } = {}) {
  const all = await fetchJson(JAVA_RUNTIME_ALL, { useMirror: true, retries: 2, timeout: 20000 });
  const platform =
    process.platform === 'win32'
      ? process.arch === 'arm64'
        ? 'windows-arm64'
        : 'windows-x64'
      : process.platform === 'darwin'
        ? process.arch === 'arm64'
          ? 'mac-os-arm64'
          : 'mac-os'
        : 'linux';
  const components = all[platform] || {};
  const rank = { alpha: 1, beta: 2, gamma: 3, delta: 4, epsilon: 5 };
  const parseJavaMajor = (name) => {
    const text = String(name || '');
    if (/^1\.8/.test(text)) return 8;
    return parseInt(text, 10) || 0;
  };
  const runtimeRank = (name) => {
    if (name === 'jre-legacy') return 9;
    const match = name.match(/-(alpha|beta|gamma|delta|epsilon)$/);
    return match ? rank[match[1]] : 0;
  };
  const candidates = Object.entries(components)
    .filter(([name, entries]) => name !== 'minecraft-java-exe' && !name.endsWith('-snapshot') && Array.isArray(entries) && entries[0])
    .map(([name, entries]) => ({
      name,
      info: entries[0],
      javaMajor: parseJavaMajor(entries[0].version?.name),
      rank: runtimeRank(name),
    }))
    .sort((a, b) => a.javaMajor - b.javaMajor || b.rank - a.rank);
  const sameMajor = candidates.filter((c) => c.javaMajor === major);
  const chosen =
    (sameMajor.length ? sameMajor[0] : null) ||
    candidates.find((c) => c.javaMajor >= major) ||
    candidates[candidates.length - 1];
  if (!chosen) throw new Error(`Mojang 未提供 Java ${major} 的运行时`);

  if (onProgress) onProgress({ phase: 'java-download', message: `正在下载 Mojang Java ${chosen.info.version.name}`, completed: 0, total: 1 });
  const manifest = await fetchJson(chosen.info.manifest.url, { useMirror: true, retries: 2, timeout: 20000 });
  const targetDir = path.join(paths.dirs.runtime(), `mojang-${chosen.name}`);
  const entries = Object.entries(manifest.files || {}).filter(([, f]) => f.type === 'file' && f.downloads && f.downloads.raw);

  const queue = new DownloadQueue({ concurrency: paths.loadConfig().downloadConcurrency || 16, useMirror: true, phase: 'java-download' });
  for (const [name, file] of entries) {
    queue.add({
      url: file.downloads.raw.url,
      dest: path.join(targetDir, ...name.split('/')),
      sha1: file.downloads.raw.sha1,
      size: file.downloads.raw.size,
      name,
    });
  }
  queue.on('progress', (p) =>
    onProgress && onProgress({ ...p, message: `正在下载 Java ${chosen.info.version.name}` })
  );
  const result = await queue.run();
  if (result.failed.length) throw new Error(`Java 运行时下载失败（${result.failed.length} 个文件）`);

  const exe = javaExeIn(targetDir);
  if (!exe) throw new Error('Mojang Java 运行时缺少可执行文件');
  cache.list = null;
  return { path: exe, major, version: runVersion(exe)?.raw || `Java ${major}` };
}

/** 自动下载 Adoptium Temurin JRE/JDK */
async function downloadAdoptium(major, { onProgress } = {}) {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  const url =
    `${ADOPTIUM_API}/${major}/hotspot?os=windows&architecture=${arch}` +
    `&image_type=jdk&vendor=eclipse&project=jdk`;
  const assets = await fetchJson(url, { useMirror: false, retries: 1, timeout: 20000 });
  const binary = Array.isArray(assets) ? assets[0]?.binary : assets?.binary;
  const pkg = binary?.package;
  if (!pkg || !pkg.link) throw new Error(`未找到 Java ${major} 的下载地址`);

  const runtimeRoot = paths.dirs.runtime();
  const zipPath = path.join(runtimeRoot, `temurin-${major}-${arch}.zip`);
  if (onProgress) onProgress({ phase: 'java-download', message: `正在下载 Java ${major}`, completed: 0, total: 1 });
  await downloadFile(pkg.link, zipPath, {
    sha1: pkg.checksum,
    size: pkg.size,
    useMirror: false,
    retries: 1,
    timeout: 30000,
    onProgress: (p) =>
      onProgress && onProgress({ phase: 'java-download', message: `正在下载 Java ${major}`, completed: p.done, total: p.total }),
  });

  const targetDir = path.join(runtimeRoot, `temurin-${major}`);
  await fs.promises.mkdir(targetDir, { recursive: true });
  if (onProgress) onProgress({ phase: 'java-extract', message: `正在解压 Java ${major}`, completed: 0, total: 1 });
  await extractZipFile(zipPath, targetDir);

  // 解压后通常存在一层 jdk-xx 目录
  let binDir = targetDir;
  if (!fs.existsSync(path.join(binDir, 'bin'))) {
    for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
      if (entry.isDirectory() && fs.existsSync(path.join(targetDir, entry.name, 'bin'))) {
        binDir = path.join(targetDir, entry.name);
        break;
      }
    }
  }
  const exe = javaExeIn(binDir);
  if (!exe) throw new Error('Java 解压后未找到可执行文件');
  await fs.promises.rm(zipPath, { force: true }).catch(() => {});
  cache.list = null;
  return { path: exe, major, version: runVersion(exe)?.raw || `Java ${major}` };
}

/** 自动下载 Java：优先 Mojang 官方运行时，失败时回退 Adoptium */
async function downloadJava(major, { onProgress } = {}) {
  try {
    return await downloadMojangRuntime(major, { onProgress });
  } catch (err) {
    if (onProgress) {
      onProgress({
        phase: 'java-download',
        message: `Mojang 运行时下载失败（${err.message}），改用 Adoptium`,
        completed: 0,
        total: 1,
      });
    }
    return downloadAdoptium(major, { onProgress });
  }
}

/** 确保存在满足版本要求的 Java */
async function ensureJava(major, { onProgress } = {}) {
  const existing = pickJava(major);
  if (existing) return existing;
  const installed = await downloadJava(major, { onProgress });
  detectInstalled({ rescan: true });
  return installed;
}

module.exports = { detectInstalled, pickJava, ensureJava, downloadJava, runVersion };
