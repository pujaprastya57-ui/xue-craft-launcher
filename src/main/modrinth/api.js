'use strict';

const { fetchJson } = require('../core/http');

const API = 'https://api.modrinth.com/v2';
const USER_AGENT = 'xueCraftLauncher/1.0.0 (Minecraft Launcher)';

async function api(path, params) {
  const url = new URL(API + path);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    }
  }
  return fetchJson(url.toString(), { useMirror: false, headers: { 'User-Agent': USER_AGENT }, retries: 2 });
}

const LOADERS = ['fabric', 'forge', 'neoforge', 'quilt'];

/**
 * 搜索 Modrinth 资源
 * @param {{query?:string,type?:string,gameVersion?:string,loader?:string,offset?:number,limit?:number,sort?:string}} options
 */
async function search({ query = '', type = 'mod', gameVersion = '', loader = '', offset = 0, limit = 20, sort = 'relevance' } = {}) {
  const facets = [[`project_type:${type}`]];
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  if (loader && ['mod', 'modpack'].includes(type)) facets.push([`categories:${loader}`]);
  const index = sort === 'downloads' ? 'downloads' : sort === 'newest' ? 'newest' : sort === 'updated' ? 'updated' : 'relevance';
  const data = await api('/search', {
    query,
    limit: String(limit),
    offset: String(offset),
    index,
    facets: JSON.stringify(facets),
  });
  return {
    total: data.total_hits,
    hits: (data.hits || []).map((hit) => ({
      id: hit.project_id,
      slug: hit.slug,
      title: hit.title,
      description: hit.description,
      type: hit.project_type,
      icon: hit.icon_url,
      downloads: hit.downloads,
      follows: hit.follows,
      categories: hit.categories,
      versions: hit.versions,
      author: hit.author,
      dateModified: hit.date_modified,
    })),
  };
}

async function getProject(idOrSlug) {
  return api(`/project/${encodeURIComponent(idOrSlug)}`);
}

/** 获取项目的版本列表，可按游戏版本/加载器过滤 */
async function getVersions(idOrSlug, { gameVersion, loader } = {}) {
  const versions = await api(`/project/${encodeURIComponent(idOrSlug)}/version`);
  return versions.filter((v) => {
    if (gameVersion && !(v.game_versions || []).includes(gameVersion)) return false;
    if (loader && !(v.loaders || []).includes(loader)) return false;
    return true;
  });
}

async function getVersion(versionId) {
  return api(`/version/${encodeURIComponent(versionId)}`);
}

function primaryFile(version) {
  const files = version.files || [];
  return files.find((f) => f.primary) || files[0] || null;
}

module.exports = { API, LOADERS, search, getProject, getVersions, getVersion, primaryFile };
