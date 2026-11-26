'use strict';

const path = require('node:path');
const fsp = require('node:fs').promises;
const paths = require('../core/paths');
const { fetchJson } = require('../core/http');
const { downloadFile } = require('../core/http');

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
const CACHE_TTL = 5 * 60 * 1000;

const state = { manifest: null, fetchedAt: 0 };

function cacheFile() {
  return path.join(paths.ensureDirSync(path.join(paths.root(), 'cache')), 'version_manifest_v2.json');
}

async function getManifest(force = false) {
  if (!force && state.manifest && Date.now() - state.fetchedAt < CACHE_TTL) return state.manifest;
  let manifest = null;
  try {
    manifest = await fetchJson(MANIFEST_URL, { useMirror: paths.loadConfig().useMirror });
    await fsp.writeFile(cacheFile(), JSON.stringify(manifest), 'utf8');
  } catch (err) {
    manifest = await paths.readJson(cacheFile());
    if (!manifest) throw new Error(`获取版本清单失败：${err.message}`);
  }
  state.manifest = manifest;
  state.fetchedAt = Date.now();
  return manifest;
}

async function listVersions({ type = 'all' } = {}) {
  const manifest = await getManifest();
  return manifest.versions.filter((v) => type === 'all' || v.type === type);
}

async function getVersionEntry(id) {
  const manifest = await getManifest();
  return manifest.versions.find((v) => v.id === id) || null;
}

function versionJsonPath(id) {
  return path.join(paths.dirs.version(id), `${id}.json`);
}

/** 读取本地已安装版本的 json（原样，不合并继承） */
async function readLocalVersionJson(id) {
  return paths.readJson(versionJsonPath(id), null);
}

function mergeArguments(parentArgs, childArgs) {
  if (!parentArgs && !childArgs) return undefined;
  return {
    game: [...(parentArgs?.game || []), ...(childArgs?.game || [])],
    jvm: [...(parentArgs?.jvm || []), ...(childArgs?.jvm || [])],
  };
}

/** 合并父版本（inheritsFrom）与子版本，得到可安装/启动的完整清单 */
function mergeVersionJson(parent, child) {
  const merged = { ...parent, ...child };
  merged.libraries = [...(parent.libraries || []), ...(child.libraries || [])];
  merged.arguments = mergeArguments(parent.arguments, child.arguments);
  if (!child.arguments && !parent.arguments && parent.minecraftArguments && !child.minecraftArguments) {
    merged.minecraftArguments = parent.minecraftArguments;
  }
  merged.downloads = { ...(parent.downloads || {}), ...(child.downloads || {}) };
  merged.assetIndex = child.assetIndex || parent.assetIndex;
  merged.assets = child.assets || parent.assets;
  merged.assetIndexId = merged.assetIndex ? merged.assetIndex.id : 'legacy';
  merged.logging = child.logging || parent.logging;
  merged.javaVersion = child.javaVersion || parent.javaVersion;
  merged._inheritsChain = [child.id, ...(parent._inheritsChain || [])];
  return merged;
}

/**
 * 解析版本（自动处理 inheritsFrom 继承链）
 */
async function resolveVersion(id, seen = new Set()) {
  if (seen.has(id)) throw new Error(`版本继承出现循环：${id}`);
  seen.add(id);
  const json = await readLocalVersionJson(id);
  if (!json) throw new Error(`本地版本不存在：${id}`);
  if (!json.inheritsFrom) {
    const result = { ...json };
    result._inheritsChain = [json.id || id];
    result.assetIndexId = json.assetIndex ? json.assetIndex.id : 'legacy';
    return result;
  }
  const parent = await resolveVersion(json.inheritsFrom, seen);
  return mergeVersionJson(parent, { ...json, id: json.id || id });
}

/** 下载版本 json 到本地（带 SHA1 校验） */
async function fetchVersionJson(id, { onProgress } = {}) {
  const entry = await getVersionEntry(id);
  if (!entry) throw new Error(`版本不存在：${id}`);
  const dest = versionJsonPath(id);
  await downloadFile(entry.url, dest, {
    sha1: entry.sha1,
    useMirror: paths.loadConfig().useMirror,
    onProgress,
  });
  return paths.readJson(dest);
}

/** 获取版本信息（优先本地，其次下载） */
async function ensureVersionJson(id, { onProgress } = {}) {
  const local = await readLocalVersionJson(id);
  if (local) return local;
  return fetchVersionJson(id, { onProgress });
}

module.exports = {
  MANIFEST_URL,
  getManifest,
  listVersions,
  getVersionEntry,
  versionJsonPath,
  readLocalVersionJson,
  resolveVersion,
  mergeVersionJson,
  fetchVersionJson,
  ensureVersionJson,
};
