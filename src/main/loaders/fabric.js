'use strict';

const path = require('node:path');
const paths = require('../core/paths');
const { fetchJson } = require('../core/http');
const meta = require('../mc/meta');
const installer = require('../mc/installer');

const FABRIC_META = 'https://meta.fabricmc.net/v2';

async function listFabricLoaders(gameVersion) {
  const data = await fetchJson(`${FABRIC_META}/versions/loader/${encodeURIComponent(gameVersion)}`, { useMirror: false });
  return data.map((item) => ({
    version: item.loader.version,
    stable: Boolean(item.loader.stable),
  }));
}

async function fetchFabricProfile(gameVersion, loaderVersion) {
  return fetchJson(
    `${FABRIC_META}/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`,
    { useMirror: false }
  );
}

/** 安装 Fabric：写入加载器版本 json 并补齐依赖库 */
async function installFabric(gameVersion, loaderVersion, { report } = {}) {
  if (typeof report === 'function') report({ phase: 'loader', message: `正在获取 Fabric ${loaderVersion} 配置` });
  const profile = await fetchFabricProfile(gameVersion, loaderVersion);
  const id = profile.id || `fabric-loader-${loaderVersion}-${gameVersion}`;
  profile.id = id;
  profile.inheritsFrom = gameVersion;

  const versionDir = paths.dirs.version(id);
  await paths.writeJson(path.join(versionDir, `${id}.json`), profile);

  // 先确保原版完整安装
  const vanilla = await meta.readLocalVersionJson(gameVersion);
  if (!vanilla) {
    if (typeof report === 'function') report({ phase: 'loader', message: `正在安装原版 ${gameVersion}` });
    await installer.installVersion(gameVersion, { report });
  }
  const result = await installer.installVersion(id, { report });
  return { id, loader: 'fabric', gameVersion, loaderVersion, result };
}

module.exports = { listFabricLoaders, installFabric, fetchFabricProfile };
