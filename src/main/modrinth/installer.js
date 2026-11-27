'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const paths = require('../core/paths');
const { downloadFile } = require('../core/http');
const { DownloadQueue } = require('../core/download');
const { listZip, readEntryData } = require('../core/zip');
const meta = require('../mc/meta');
const fabric = require('../loaders/fabric');
const forge = require('../loaders/forge');
const api = require('./api');

const CONTENT_DIRS = {
  mod: 'mods',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks',
};

/**
 * 读取整合包元数据文件，文件名形如 xuecraft-pack.json / xuecraft-pack-files.json。
 * 旧版本使用 traecraft- 前缀，读取时自动回退以兼容已安装的整合包。
 */
async function readPackJson(dir, name) {
  const current = await paths.readJson(path.join(dir, `xuecraft-${name}`), null);
  if (current) return current;
  return paths.readJson(path.join(dir, `traecraft-${name}`), null);
}

function safeJoin(base, relative) {
  const target = path.resolve(base, relative.replace(/^[/\\]+/, ''));
  const root = path.resolve(base);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`非法路径：${relative}`);
  return target;
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'modpack';
}

/** 解析版本对应的原版游戏版本与加载器 */
async function versionContext(versionId) {
  const resolved = await meta.resolveVersion(versionId);
  const chain = resolved._inheritsChain || [versionId];
  const gameVersion = chain[chain.length - 1];
  const loader = /net\.fabricmc/.test(JSON.stringify(resolved.libraries || []))
    ? 'fabric'
    : /net\.neoforged/.test(JSON.stringify(resolved.libraries || []))
      ? 'neoforge'
      : /net\.minecraftforge/.test(JSON.stringify(resolved.libraries || []))
        ? 'forge'
        : 'vanilla';
  return { resolved, gameVersion, loader };
}

async function downloadVersionFile(version, dest, report) {
  const file = api.primaryFile(version);
  if (!file) throw new Error(`版本 ${version.id} 没有可下载文件`);
  await downloadFile(file.url, dest, {
    sha1: file.hashes && file.hashes.sha1,
    size: file.size,
    useMirror: false,
    onProgress: (p) =>
      report && report({ phase: 'download', message: `正在下载 ${file.filename}`, completed: p.done, total: p.total }),
  });
  return { file, dest };
}

/**
 * 安装单个资源（Mod / 资源包 / 光影 / 数据包）
 */
async function installContent({
  projectId,
  versionId,
  targetVersionId,
  contentType = 'mod',
  world = '',
  loader = '',
  report,
  visited = new Set(),
  depth = 0,
}) {
  const { gameVersion, loader: targetLoader } = await versionContext(targetVersionId);
  const versions = versionId
    ? [await api.getVersion(versionId)]
    : await api.getVersions(projectId, {
        gameVersion,
        loader: ['mod', 'modpack'].includes(contentType) ? loader || (targetLoader !== 'vanilla' ? targetLoader : '') : '',
      });
  const chosen = versions[0];
  if (!chosen) throw new Error('没有与当前版本兼容的资源版本');

  const project = await api.getProject(projectId).catch(() => ({ title: projectId, slug: projectId }));
  const gameDir = paths.gameDir(targetVersionId);
  let targetDir;
  if (contentType === 'datapack') {
    if (!world) throw new Error('请选择要安装数据包的存档');
    targetDir = path.join(gameDir, 'saves', world, 'datapacks');
  } else {
    targetDir = path.join(gameDir, CONTENT_DIRS[contentType] || 'mods');
  }
  await fsp.mkdir(targetDir, { recursive: true });

  const file = api.primaryFile(chosen);
  if (!file) throw new Error('该资源版本没有可下载文件');
  const dest = safeJoin(targetDir, file.filename);
  if (report) report({ phase: 'download', message: `正在下载 ${project.title}`, completed: 0, total: 1 });
  await downloadFile(file.url, dest, {
    sha1: file.hashes && file.hashes.sha1,
    size: file.size,
    useMirror: false,
    onProgress: (p) => report && report({ phase: 'download', message: `正在下载 ${project.title}`, completed: p.done, total: p.total }),
  });

  const installed = [{ title: project.title, filename: file.filename, path: dest }];

  // 自动安装必需的前置依赖（仅 Mod，最多深入 3 层）
  if (contentType === 'mod' && depth < 3) {
    const required = (chosen.dependencies || []).filter(
      (dep) => dep.dependency_type === 'required' && dep.project_id && !visited.has(dep.project_id)
    );
    for (const dep of required) {
      visited.add(dep.project_id);
      try {
        const depResult = await installContent({
          projectId: dep.project_id,
          versionId: dep.version_id || undefined,
          targetVersionId,
          contentType: 'mod',
          loader: loader || targetLoader,
          report,
          visited,
          depth: depth + 1,
        });
        installed.push(...depResult.installed);
      } catch (err) {
        if (report) report({ phase: 'download', message: `前置依赖安装失败：${err.message}` });
      }
    }
  }
  return { installed };
}

/** 解压整合包中的 overrides 目录到目标目录（client-overrides 优先覆盖） */
async function extractOverrides(zipBuffer, packDir) {
  const entries = listZip(zipBuffer);
  const files = [];
  let count = 0;
  const passes = [
    (name) => (name.startsWith('overrides/') ? name.slice('overrides/'.length) : null),
    (name) => (name.startsWith('client-overrides/') ? name.slice('client-overrides/'.length) : null),
  ];
  for (const pick of passes) {
    for (const entry of entries) {
      if (entry.name.endsWith('/')) continue;
      const relative = pick(entry.name);
      if (!relative) continue;
      const dest = safeJoin(packDir, relative);
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.writeFile(dest, readEntryData(zipBuffer, entry));
      files.push(relative);
      count++;
    }
  }
  return { count, files };
}

function normalizeRel(name) {
  return String(name).replace(/\\/g, '/').replace(/^\.?\//, '');
}

/** 查找已安装的同名整合包版本，用于原地更新 */
async function findExistingPackId(name, mcVersion) {
  const slug = slugify(name);
  let entries = [];
  try {
    entries = await fsp.readdir(paths.dirs.versions(), { withFileTypes: true });
  } catch {
    return '';
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packMeta = await readPackJson(path.join(paths.dirs.versions(), entry.name), 'pack.json');
    if (!packMeta) continue;
    if (packMeta.gameVersion && packMeta.gameVersion !== mcVersion) continue;
    if (slugify(packMeta.title || '') === slug) return entry.name;
  }
  return '';
}

/** 删除旧整合包中已不再包含的托管文件（存档等用户文件不受影响） */
async function removeStalePackFiles(packDir, oldManifest, keepFiles) {
  if (!oldManifest) return 0;
  const keep = new Set(keepFiles.map(normalizeRel));
  const candidates = [...(oldManifest.files || []), ...(oldManifest.overrides || [])];
  let removed = 0;
  for (const rel of candidates) {
    const clean = normalizeRel(rel);
    if (!clean || keep.has(clean)) continue;
    try {
      await fsp.rm(safeJoin(packDir, clean), { force: true });
      removed++;
    } catch {
      // 忽略无法删除的文件
    }
  }
  return removed;
}

/** 确保整合包依赖的加载器/原版已安装，返回基础版本 id */
async function ensurePackBase(deps, mcVersion, report) {
  if (deps['quilt-loader'] && !deps['fabric-loader']) {
    throw new Error('暂不支持 Quilt 整合包，请选择 Fabric / Forge / NeoForge 整合包');
  }
  if (deps['fabric-loader']) {
    const result = await fabric.installFabric(mcVersion, deps['fabric-loader'], { report });
    return result.id;
  }
  if (deps.neoforge) {
    const result = await forge.installNeoForge(mcVersion, deps.neoforge, { report });
    return result.id;
  }
  if (deps.forge) {
    const artifact = deps.forge.startsWith(`${mcVersion}-`) ? deps.forge : `${mcVersion}-${deps.forge}`;
    const result = await forge.installForge(mcVersion, artifact, { report });
    return result.id;
  }
  const result = await meta.ensureVersionJson(mcVersion);
  const installer = require('../mc/installer');
  await installer.installVersion(mcVersion, { report });
  return result.id;
}

/** 旧版安装未保存文件清单时，尝试下载旧整合包索引来推算需要清理的文件 */
async function legacyManifestFromMeta(oldMeta) {
  if (!oldMeta || !oldMeta.projectId || !oldMeta.versionId) return null;
  try {
    const version = await api.getVersion(oldMeta.versionId);
    const file = api.primaryFile(version);
    if (!file || !String(file.filename).endsWith('.mrpack')) return null;
    const cacheDir = paths.ensureDirSync(path.join(paths.root(), 'cache', 'modrinth'));
    const packPath = path.join(cacheDir, file.filename);
    await downloadFile(file.url, packPath, { sha1: file.hashes && file.hashes.sha1, size: file.size, useMirror: false });
    const buffer = await fsp.readFile(packPath);
    const indexEntry = listZip(buffer).find((e) => e.name === 'modrinth.index.json');
    if (!indexEntry) return null;
    const oldIndex = JSON.parse(readEntryData(buffer, indexEntry).toString('utf8'));
    return { files: (oldIndex.files || []).map((f) => f.path) };
  } catch {
    return null;
  }
}

/**
 * 从 .mrpack 内容安装或原地更新整合包
 */
async function installModpackBuffer(zipBuffer, { report, packMeta = {} } = {}) {
  const entries = listZip(zipBuffer);
  const indexEntry = entries.find((e) => e.name === 'modrinth.index.json');
  if (!indexEntry) throw new Error('不是有效的 Modrinth 整合包：缺少 modrinth.index.json');
  const indexJson = JSON.parse(readEntryData(zipBuffer, indexEntry).toString('utf8'));
  const deps = indexJson.dependencies || {};
  const mcVersion = deps.minecraft;
  if (!mcVersion) throw new Error('整合包未指定 Minecraft 版本');

  const title = packMeta.title || indexJson.name || 'modpack';
  const existingId = await findExistingPackId(title, mcVersion);
  const packId = existingId || `${slugify(title)}-${mcVersion}`;
  const packDir = paths.dirs.version(packId);
  const packJsonPath = path.join(packDir, `${packId}.json`);
  const updating = fs.existsSync(packJsonPath);
  const oldMeta = updating ? await readPackJson(packDir, 'pack.json') : null;
  let oldManifest = updating ? await readPackJson(packDir, 'pack-files.json') : null;
  if (updating && !oldManifest) oldManifest = await legacyManifestFromMeta(oldMeta);

  // 1. 安装对应的加载器版本
  const baseVersionId = await ensurePackBase(deps, mcVersion, report);

  // 2. 创建或复用独立的整合包版本目录
  const baseJson = await paths.readJson(path.join(paths.dirs.version(baseVersionId), `${baseVersionId}.json`), null);
  if (!baseJson) throw new Error('加载器版本文件缺失');
  await paths.writeJson(packJsonPath, { ...baseJson, id: packId, type: 'release' });
  await fsp.mkdir(path.join(packDir, 'mods'), { recursive: true });

  // 3. 下载整合包内所有文件（已存在且 SHA1 一致的文件会跳过）
  const files = (indexJson.files || []).filter((f) => !f.env || f.env.client !== 'unsupported');
  const queue = new DownloadQueue({ concurrency: 8, useMirror: false, phase: 'pack-files' });
  for (const item of files) {
    const dest = safeJoin(packDir, item.path);
    const url = (item.downloads || [])[0];
    if (!url) continue;
    queue.add({ url, dest, sha1: item.hashes && item.hashes.sha1, size: item.fileSize, name: item.path });
  }
  queue.on('progress', (p) =>
    report && report({ ...p, message: updating ? '正在更新整合包内容' : '正在下载整合包内容' })
  );
  const queueResult = await queue.run();

  // 4. 解压覆盖文件（overrides 优先）
  if (report) report({ phase: 'pack-files', message: '正在解压整合包配置与覆盖文件' });
  const overrideResult = await extractOverrides(zipBuffer, packDir);

  const managedFiles = [...files.map((f) => normalizeRel(f.path)), ...overrideResult.files];
  const removed = updating ? await removeStalePackFiles(packDir, oldManifest, managedFiles) : 0;

  // 5. 记录整合包信息与托管文件清单，供下次更新时清理旧文件
  await paths.writeJson(path.join(packDir, 'xuecraft-pack-files.json'), {
    files: files.map((f) => normalizeRel(f.path)),
    overrides: overrideResult.files,
  });
  await fsp.writeFile(path.join(packDir, 'xuecraft-pack-index.json'), JSON.stringify(indexJson, null, 2), 'utf8');
  await paths.writeJson(path.join(packDir, 'xuecraft-pack.json'), {
    projectId: packMeta.projectId || (oldMeta && oldMeta.projectId) || '',
    slug: packMeta.slug || (oldMeta && oldMeta.slug) || '',
    title,
    icon: packMeta.icon || indexJson.icon || (oldMeta && oldMeta.icon) || '',
    versionId: packMeta.versionId || indexJson.versionId || (oldMeta && oldMeta.versionId) || '',
    versionNumber: packMeta.versionNumber || indexJson.versionId || '',
    gameVersion: mcVersion,
    dependencies: deps,
    source: packMeta.source || (oldMeta && oldMeta.source) || 'modrinth',
    fileName: packMeta.fileName || (oldMeta && oldMeta.fileName) || '',
    installedAt: (oldMeta && oldMeta.installedAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const failed = queueResult.failed.length;
  if (report) {
    const action = updating ? '更新' : '安装';
    report({
      phase: 'done',
      message: failed ? `整合包${action}完成，${failed} 个文件失败` : `整合包${action}完成`,
      completed: 1,
      total: 1,
    });
  }
  return {
    versionId: packId,
    title,
    icon: packMeta.icon || (oldMeta && oldMeta.icon) || '',
    updated: updating,
    removed,
    failed,
  };
}

/**
 * 安装 Modrinth 整合包（.mrpack）；已存在同名版本时原地更新
 */
async function installModpack({ projectId, versionId, report }) {
  const project = await api.getProject(projectId);
  const versions = versionId ? [await api.getVersion(versionId)] : await api.getVersions(projectId);
  const chosen = versions[0];
  if (!chosen) throw new Error('该整合包没有可用版本');
  const file = api.primaryFile(chosen);
  if (!file || !file.filename.endsWith('.mrpack')) throw new Error('该版本不是 Modrinth 整合包格式');

  const cacheDir = paths.ensureDirSync(path.join(paths.root(), 'cache', 'modrinth'));
  const packPath = path.join(cacheDir, file.filename);
  if (report) report({ phase: 'download', message: `正在下载整合包 ${project.title}`, completed: 0, total: 1 });
  await downloadFile(file.url, packPath, {
    sha1: file.hashes && file.hashes.sha1,
    size: file.size,
    useMirror: false,
    onProgress: (p) => report && report({ phase: 'download', message: '正在下载整合包', completed: p.done, total: p.total }),
  });

  const zipBuffer = await fsp.readFile(packPath);
  return installModpackBuffer(zipBuffer, {
    report,
    packMeta: {
      projectId: project.id,
      slug: project.slug,
      title: project.title,
      icon: project.icon_url,
      versionId: chosen.id,
      versionNumber: chosen.version_number,
      source: 'modrinth',
    },
  });
}

/** 从本地 .mrpack 文件安装或更新整合包 */
async function installModpackFromFile(filePath, { report } = {}) {
  if (!filePath || !/\.mrpack$/i.test(filePath)) throw new Error('仅支持 Modrinth 整合包文件（.mrpack）');
  const stat = await fsp.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile()) throw new Error('找不到整合包文件');
  if (stat.size > 2 * 1024 * 1024 * 1024) throw new Error('整合包文件过大（超过 2GB）');
  const zipBuffer = await fsp.readFile(filePath);
  return installModpackBuffer(zipBuffer, {
    report,
    packMeta: { source: 'local', fileName: path.basename(filePath) },
  });
}

module.exports = {
  installContent,
  installModpack,
  installModpackFromFile,
  versionContext,
  CONTENT_DIRS,
};
