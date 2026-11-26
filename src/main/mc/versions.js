'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const paths = require('../core/paths');

function detectLoader(json) {
  const libs = (json.libraries || []).map((l) => l.name || '').join(' ');
  if (json.inheritsFrom && /net\.fabricmc/.test(libs)) return 'fabric';
  if (json.inheritsFrom && /net\.neoforged/.test(libs)) return 'neoforge';
  if (json.inheritsFrom && /net\.minecraftforge/.test(libs)) return 'forge';
  if (json.inheritsFrom) return 'loader';
  return null;
}

async function dirSize(dir) {
  let total = 0;
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += await dirSize(full);
      else if (entry.isFile()) total += (await fsp.stat(full)).size;
    }
  } catch {
    // 忽略无法读取的文件
  }
  return total;
}

/** 扫描本地已安装版本 */
async function listLocalVersions() {
  const dir = paths.dirs.versions();
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const result = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    const jsonPath = path.join(dir, id, `${id}.json`);
    const json = await paths.readJson(jsonPath, null);
    if (!json) continue;
    const stat = await fsp.stat(jsonPath).catch(() => null);
    result.push({
      id,
      type: json.type || (json.inheritsFrom ? 'modified' : 'release'),
      loader: detectLoader(json),
      gameVersion: json.inheritsFrom || json.id || id,
      mainClass: json.mainClass || '',
      releaseTime: json.releaseTime || (stat ? stat.mtime.toISOString() : ''),
      installedAt: stat ? stat.mtime.toISOString() : '',
      hasJar:
        fs.existsSync(path.join(dir, id, `${id}.jar`)) ||
        fs.existsSync(path.join(paths.dirs.versions(), json.inheritsFrom || id, `${json.inheritsFrom || id}.jar`)),
    });
  }
  result.sort((a, b) => String(b.installedAt).localeCompare(String(a.installedAt)));
  return result;
}

async function versionDetail(id) {
  const json = await paths.readJson(path.join(paths.dirs.version(id), `${id}.json`), null);
  if (!json) return null;
  return { ...json, size: await dirSize(paths.dirs.version(id)) };
}

/** 删除版本目录（不影响共享的库与资源） */
async function deleteVersion(id) {
  if (!id || /[\\/]/.test(id)) throw new Error('非法的版本名称');
  const dir = path.join(paths.dirs.versions(), id);
  if (!fs.existsSync(dir)) throw new Error(`版本不存在：${id}`);
  await fsp.rm(dir, { recursive: true, force: true });
  return { id };
}

/** 列出某个版本游戏目录下的存档 */
async function listSaves(versionId) {
  const savesDir = path.join(paths.gameDir(versionId), 'saves');
  try {
    const entries = await fsp.readdir(savesDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

module.exports = { listLocalVersions, versionDetail, deleteVersion, listSaves, dirSize };
