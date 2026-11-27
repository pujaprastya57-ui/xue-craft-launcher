'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);
const EVENTS = ['progress', 'game:log', 'game:exit', 'auth:state', 'auth:error', 'auth:status'];

contextBridge.exposeInMainWorld('xuecraft', {
  info: () => invoke('app:info'),

  config: {
    get: () => invoke('config:get'),
    save: (patch) => invoke('config:save', patch),
    pickDir: () => invoke('config:pickDir'),
    pickJava: () => invoke('config:pickJava'),
  },

  java: {
    detect: () => invoke('java:detect'),
    download: (major) => invoke('java:download', major),
  },

  auth: {
    loginBrowser: () => invoke('auth:loginBrowser'),
    loginDevice: () => invoke('auth:loginDevice'),
    accounts: () => invoke('auth:accounts'),
    setActive: (uuid) => invoke('auth:setActive', uuid),
    logout: (uuid) => invoke('auth:logout', uuid),
  },

  manifest: (type) => invoke('mc:manifest', type),
  installVersion: (id) => invoke('mc:install', id),
  repairVersion: (id) => invoke('mc:repair', id),

  versions: {
    local: () => invoke('versions:local'),
    detail: (id) => invoke('versions:detail', id),
    remove: (id) => invoke('versions:delete', id),
    saves: (id) => invoke('versions:saves', id),
    openDir: (id) => invoke('versions:openDir', id),
  },

  loaders: {
    fabricVersions: (mc) => invoke('loaders:fabricVersions', mc),
    forgeVersions: (mc) => invoke('loaders:forgeVersions', mc),
    neoForgeVersions: (mc) => invoke('loaders:neoForgeVersions', mc),
    install: (payload) => invoke('loaders:install', payload),
  },

  modrinth: {
    search: (options) => invoke('modrinth:search', options),
    project: (id) => invoke('modrinth:project', id),
    versions: (payload) => invoke('modrinth:versions', payload),
    install: (payload) => invoke('modrinth:install', payload),
    pickPackFile: () => invoke('modrinth:pickPackFile'),
    installPackFile: (filePath) => invoke('modrinth:installPackFile', filePath),
  },

  // 拖拽文件时获取本地路径（Electron 32+ 已移除 File.path）
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },

  game: {
    launch: (versionId) => invoke('game:launch', versionId),
    openFolder: (versionId) => invoke('game:openFolder', versionId),
  },

  logs: {
    openDir: () => invoke('logs:openDir'),
    latest: (versionId) => invoke('logs:latest', versionId),
  },

  updater: {
    current: () => invoke('updater:current'),
    pickInstaller: () => invoke('updater:pickInstaller'),
    applyInstaller: (filePath) => invoke('updater:applyInstaller', filePath),
  },

  openExternal: (url) => invoke('shell:openExternal', url),

  on(channel, callback) {
    if (!EVENTS.includes(channel)) return () => {};
    const listener = (_event, data) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
