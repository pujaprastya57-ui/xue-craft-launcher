'use strict';

/* global xuecraft */

const api = window.xuecraft;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  info: null,
  config: {},
  accounts: [],
  activeId: '',
  versions: [],
  manifest: [],
  manifestType: 'release',
  selectedVersion: '',
  downloadTab: 'vanilla',
  loadedLoaderMc: '',
  running: false,
  installing: false,
  modrinth: {
    type: 'mod',
    query: '',
    gameVersion: '',
    loader: '',
    sort: 'relevance',
    offset: 0,
    hits: [],
    total: 0,
    loading: false,
  },
  modal: { projectId: '', project: null, versions: [], selectedVersionId: '' },
};

const VIEW_META = {
  home: ['启动游戏', '选择版本，一键进入世界'],
  versions: ['版本管理', '修复、删除与打开本地版本目录'],
  download: ['下载游戏', '原版全版本与 Mod 加载器安装'],
  modrinth: ['资源中心', 'Mod、整合包、资源包、光影与数据包'],
  account: ['账户', '微软正版账号登录与切换'],
  settings: ['设置', '内存、Java、版本隔离与下载选项'],
};

/* ---------------- 工具函数 ---------------- */
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = Number(n);
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function friendlyError(err) {
  const msg = String((err && err.message) || err || '未知错误');
  return msg.replace(/Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
}

function toast(message, type = 'info', timeout = 3600) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toastRoot').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-6px)';
    el.style.transition = '0.2s';
    setTimeout(() => el.remove(), 220);
  }, timeout);
}

function setStatus(text, kind = '') {
  const pill = $('#statusPill');
  pill.className = `status-pill ${kind}`;
  pill.querySelector('span').textContent = text;
}

/** 下载/安装进行中禁用启动，避免与安装任务互相等待 */
function setInstalling(flag, label = '') {
  state.installing = flag;
  if (flag && label) setStatus(label, 'busy');
  syncLaunchButton();
}

function syncLaunchButton() {
  const btn = $('#btnLaunch');
  if (!btn) return;
  btn.disabled = state.installing || !selectedVersionInfo();
}

/** 开始一个下载/安装任务；已有任务进行中时提示并返回 false */
function beginInstall(label) {
  if (state.installing) {
    toast('正在下载或安装，请等待当前任务完成', 'error');
    return false;
  }
  setInstalling(true, label);
  return true;
}

function loaderName(version) {
  if (!version) return '原版';
  const map = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt', loader: '加载器' };
  return map[version.loader] || '原版';
}

function loaderBadgeClass(loader) {
  if (loader === 'fabric') return 'green';
  if (loader === 'forge') return 'blue';
  if (loader === 'neoforge') return 'purple';
  return 'orange';
}

function selectedVersionInfo() {
  return state.versions.find((v) => v.id === state.selectedVersion) || null;
}

function activeAccount() {
  return state.accounts.find((a) => a.uuid === state.activeId) || state.accounts[0] || null;
}

const AVATAR_SERVICES = [
  (id, size) => `https://mc-heads.net/avatar/${id}/${size}`,
  (id, size) => `https://crafatar.com/avatars/${id}?size=${size}&overlay`,
  (id, size) => `https://minotar.net/helm/${id}/${size}.png`,
  (id, size) => `https://visage.surgeplay.com/face/${size}/${id}`,
];

function skinHeadUrl(skin) {
  const url = String((skin && skin.url) || '');
  return url ? url.replace(/^http:\/\//i, 'https://') : '';
}

/**
 * 渲染账号头像：优先用微软档案里的皮肤贴图裁出头部，
 * 加载失败时依次回退到第三方头像服务，全部失败则显示名字首字母。
 */
function mountAvatar(el, account) {
  if (!el) return;
  el.innerHTML = '';
  el.classList.remove('skin-head');
  el.style.backgroundImage = '';
  el.style.backgroundSize = '';
  el.style.backgroundPosition = '';
  const initial = account && account.name ? String(account.name).slice(0, 1).toUpperCase() : '?';
  el.textContent = initial;
  if (!account || !account.uuid) return;

  const uuid = String(account.uuid).replace(/-/g, '');
  const size = el.clientWidth || (el.classList.contains('small') ? 32 : 36);
  const skinUrl = skinHeadUrl((account.skins || [])[0]);
  const sources = [];
  if (skinUrl) sources.push({ type: 'skin', url: skinUrl });
  for (const make of AVATAR_SERVICES) sources.push({ type: 'image', url: make(uuid, size) });

  let index = 0;
  const tryNext = () => {
    if (index >= sources.length || !el.isConnected) return;
    const source = sources[index++];
    const img = new Image();
    img.onload = () => {
      if (!el.isConnected) return;
      el.textContent = '';
      if (source.type === 'skin') {
        // 皮肤贴图按 8 倍缩放，裁剪头部与帽子层
        el.classList.add('skin-head');
        const scale = size * 8;
        el.style.backgroundImage = `url("${source.url}"), url("${source.url}")`;
        el.style.backgroundSize = `${scale}px ${scale}px`;
        el.style.backgroundPosition = `-${size}px -${size}px, -${size * 5}px -${size}px`;
      } else {
        const node = document.createElement('img');
        node.src = source.url;
        node.alt = '';
        el.appendChild(node);
      }
    };
    img.onerror = () => tryNext();
    img.src = source.url;
  };
  tryNext();
}

/* ---------------- 导航 ---------------- */
function switchView(view) {
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  const [title, subtitle] = VIEW_META[view] || ['', ''];
  $('#viewTitle').textContent = title;
  $('#viewSubtitle').textContent = subtitle;
  if (view === 'versions') refreshVersions();
  if (view === 'modrinth' && state.modrinth.hits.length === 0) searchModrinth(true);
  if (view === 'download') ensureLoaderMcOptions();
  if (view === 'account') renderAccounts();
}

/* ---------------- 初始化 ---------------- */
async function init() {
  bindEvents();
  subscribeEvents();
  // 首次启动必须同意服务条款与隐私政策，否则退出
  const accepted = await window.XueCraftLegal.ensureAccepted();
  if (!accepted) {
    window.close();
    return;
  }
  try {
    const info = await api.info();
    state.info = info;
    state.config = info.config || {};
    state.accounts = info.accounts || [];
    state.activeId = info.activeId || '';
    state.versions = info.versions || [];
    state.selectedVersion =
      (state.config.selectedVersion && state.versions.some((v) => v.id === state.config.selectedVersion)
        ? state.config.selectedVersion
        : state.versions[0]?.id) || '';
    $('#rootInfo').textContent = info.root;
    $('#aboutRoot').textContent = info.root;
    $('#footerVersion').textContent = `xue Craft v${info.appVersion || '1.1.0'} · 正版登录`;
    $('#aboutVersion').textContent = `xue Craft launcher ${info.appVersion || '1.1.0'}`;
    renderJavaInfo(info.java || []);
    renderSettings();
    renderAll();
    await loadManifest('release');
    loadModrinthVersionFilter();
    searchModrinth(true);
  } catch (err) {
    toast(`初始化失败：${friendlyError(err)}`, 'error', 6000);
  }
}

function renderAll() {
  renderAccounts();
  renderVersions();
  renderManifest();
  renderSettingsValues();
}

/* ---------------- 账户 ---------------- */
function renderAccounts() {
  const account = activeAccount();
  const name = account ? account.name : '未登录';
  const sub = account ? '微软正版账号' : '点击登录微软账号';

  const mini = $('#accountMini');
  mini.querySelector('#miniName').textContent = name;
  mini.querySelector('#miniSub').textContent = sub;
  const miniAvatar = $('#miniAvatar');
  mountAvatar(miniAvatar, account);

  $('#launchAccountName').textContent = name;
  $('#launchAccountSub').textContent = account ? '正版账号 · 已就绪' : '需要微软正版账号才能进入服务器';
  mountAvatar($('#launchAvatar'), account);
  $('#btnLoginQuick').textContent = account ? '切换账号' : '登录';

  $('#accountCount').textContent = state.accounts.length ? `${state.accounts.length} 个账号` : '';
  const list = $('#accountList');
  if (!state.accounts.length) {
    list.innerHTML = '<div class="empty">还没有登录账号，请先使用浏览器登录微软账号。</div>';
    return;
  }
  list.innerHTML = state.accounts
    .map(
      (a) => `
      <div class="account-card ${a.uuid === state.activeId ? 'active' : ''}">
        <div class="avatar" data-account-avatar="${esc(a.uuid)}"></div>
        <div class="info">
          <strong>${esc(a.name)}</strong>
          <span>${a.uuid === state.activeId ? '当前使用' : '已登录'} · ${esc(String(a.uuid).slice(0, 8))}…</span>
        </div>
        ${a.uuid === state.activeId
          ? '<span class="badge green">使用中</span>'
          : `<button class="ghost-btn slim" data-account-action="switch" data-uuid="${esc(a.uuid)}">切换</button>`}
        <button class="ghost-btn slim danger" data-account-action="logout" data-uuid="${esc(a.uuid)}">退出</button>
      </div>`
    )
    .join('');
  $$('[data-account-avatar]').forEach((el) => {
    const account = state.accounts.find((a) => a.uuid === el.dataset.accountAvatar);
    mountAvatar(el, account);
  });
}

async function startBrowserLogin() {
  const btn = $('#btnLoginBrowser');
  btn.disabled = true;
  $('#deviceCodeBox').classList.add('hidden');
  setStatus('等待登录', 'busy');
  try {
    await api.auth.loginBrowser();
    setStatus('已登录');
    renderAccounts();
  } catch (err) {
    setStatus('登录失败', 'error');
    toast(`登录失败：${friendlyError(err)}`, 'error', 7000);
  } finally {
    btn.disabled = false;
  }
}

async function startDeviceLogin() {
  const btn = $('#btnLoginDevice');
  btn.disabled = true;
  $('#deviceCodeBox').classList.remove('hidden');
  $('#deviceCode').textContent = '······';
  $('#deviceCodeStatus').textContent = '正在向微软申请设备代码…';
  try {
    const code = await api.auth.loginDevice();
    $('#deviceCode').textContent = code.userCode;
    $('#deviceCodeStatus').textContent = '请在浏览器中输入该代码完成登录，授权后将自动完成';
    $('#btnOpenLogin').dataset.url = code.verificationUri || 'https://microsoft.com/link';
    setStatus('等待登录', 'busy');
  } catch (err) {
    $('#deviceCodeStatus').textContent = friendlyError(err);
    toast(`设备代码登录不可用：${friendlyError(err)}`, 'error', 8000);
    btn.disabled = false;
  }
}

/* ---------------- 版本与首页 ---------------- */
function renderVersions() {
  const select = $('#launchVersionSelect');
  if (!state.versions.length) {
    select.innerHTML = '<option value="">尚未安装任何版本</option>';
    select.disabled = true;
  } else {
    select.disabled = false;
    select.innerHTML = state.versions
      .map((v) => `<option value="${esc(v.id)}" ${v.id === state.selectedVersion ? 'selected' : ''}>${esc(v.id)}（${loaderName(v)} · ${esc(v.gameVersion)}）</option>`)
      .join('');
  }

  const info = selectedVersionInfo();
  if (info) {
    $('#heroVersion').textContent = info.id;
    $('#heroGameVersion').textContent = info.loader
      ? `${loaderName(info)} · Minecraft ${info.gameVersion}`
      : `Minecraft ${info.gameVersion}`;
    $('#heroLoader').textContent = loaderName(info);
  } else {
    $('#heroVersion').textContent = '尚未安装版本';
    $('#heroGameVersion').textContent = '请前往「下载游戏」安装原版或 Mod 加载器';
    $('#heroLoader').textContent = '未就绪';
  }
  syncLaunchButton();

  $('#isolationInfo').textContent = state.config.isolation ? '已开启' : '已关闭';
  $('#memoryLabel').textContent = `${state.config.memoryMax || 4096} MB`;
  const range = $('#memoryRange');
  range.value = state.config.memoryMax || 4096;

  $('#versionCount').textContent = `${state.versions.length} 个版本`;
  const list = $('#versionList');
  if (!state.versions.length) {
    list.innerHTML = '<div class="empty">还没有安装版本，去「下载游戏」安装一个吧。</div>';
    return;
  }
  list.innerHTML = state.versions
    .map(
      (v) => `
      <div class="version-row">
        <span class="badge ${loaderBadgeClass(v.loader)}">${loaderName(v)}</span>
        <div class="version-main">
          <strong>${esc(v.id)}</strong>
          <div class="meta">
            <span>Minecraft ${esc(v.gameVersion)}</span>
            <span>安装于 ${formatDate(v.installedAt)}</span>
            <span>${v.hasJar ? '主文件完整' : '主文件缺失'}</span>
          </div>
        </div>
        <div class="row-actions">
          <button class="ghost-btn slim" data-action="launch" data-id="${esc(v.id)}">启动</button>
          <button class="ghost-btn slim" data-action="repair" data-id="${esc(v.id)}">修复</button>
          <button class="ghost-btn slim" data-action="open" data-id="${esc(v.id)}">打开目录</button>
          <button class="ghost-btn slim danger" data-action="delete" data-id="${esc(v.id)}">删除</button>
        </div>
      </div>`
    )
    .join('');
}

async function refreshVersions() {
  try {
    state.versions = await api.versions.local();
    if (!state.versions.some((v) => v.id === state.selectedVersion)) {
      state.selectedVersion = state.versions[0]?.id || '';
      await api.config.save({ selectedVersion: state.selectedVersion });
    }
    renderVersions();
    renderManifest();
  } catch (err) {
    toast(`读取版本失败：${friendlyError(err)}`, 'error');
  }
}

async function deleteVersionRow(id) {
  if (!window.confirm(`确定删除版本「${id}」吗？该版本隔离目录中的存档与 mods 也会被删除。`)) return;
  try {
    await api.versions.remove(id);
    toast('版本已删除', 'success');
    await refreshVersions();
  } catch (err) {
    toast(`删除失败：${friendlyError(err)}`, 'error');
  }
}

/* ---------------- 原版下载清单 ---------------- */
async function loadManifest(type = state.manifestType) {
  state.manifestType = type;
  try {
    const all = await api.manifest('all');
    state.manifest = type === 'all' ? all : all.filter((v) => v.type === type);
    if (type === 'all') state.manifest = all;
    renderManifest();
  } catch (err) {
    toast(`加载版本清单失败：${friendlyError(err)}`, 'error', 5000);
  }
}

function installedIds() {
  return new Set(state.versions.map((v) => v.id));
}

function renderManifest() {
  const list = $('#manifestList');
  if (!list) return;
  const installed = installedIds();
  const keyword = ($('#versionSearch').value || '').trim().toLowerCase();
  let items = state.manifest;
  if (keyword) items = items.filter((v) => v.id.toLowerCase().includes(keyword));
  if (!items.length) {
    list.innerHTML = '<div class="empty">没有匹配的版本</div>';
    return;
  }
  list.innerHTML = items
    .slice(0, 400)
    .map((v) => {
      const isInstalled = installed.has(v.id);
      return `
      <div class="version-item">
        <span class="id">${esc(v.id)}</span>
        <span class="type-tag">${v.type === 'release' ? '正式版' : v.type === 'snapshot' ? '快照' : '旧版'}</span>
        <span class="date">${formatDate(v.releaseTime)}</span>
        <span class="install-state ${isInstalled ? 'done' : ''}">${isInstalled ? '已安装' : ''}</span>
        <button class="ghost-btn slim" data-install="${esc(v.id)}" ${isInstalled ? 'disabled' : ''}>${isInstalled ? '已安装' : '安装'}</button>
      </div>`;
    })
    .join('');
}

async function installVanilla(id) {
  if (!beginInstall('安装中')) return;
  try {
    const result = await api.installVersion(id);
    if (result.failedCount) toast(`安装完成，${result.failedCount} 个文件失败，可稍后「修复」`, 'info', 5000);
    else toast(`${id} 安装完成`, 'success');
    await refreshVersions();
    if (!state.selectedVersion) {
      state.selectedVersion = id;
      await api.config.save({ selectedVersion: id });
      renderVersions();
    }
    setStatus('就绪');
  } catch (err) {
    setStatus('安装失败', 'error');
    toast(`安装失败：${friendlyError(err)}`, 'error', 6000);
  } finally {
    setInstalling(false);
  }
}

/* ---------------- 加载器 ---------------- */
function ensureLoaderMcOptions() {
  const select = $('#loaderMcVersion');
  if (select.options.length > 1) return;
  const releases = state.manifest.filter((v) => v.type === 'release').map((v) => v.id);
  const all = state.manifest.map((v) => v.id);
  const options = Array.from(new Set([...releases, ...all]));
  select.innerHTML = options.map((id) => `<option value="${esc(id)}">${esc(id)}</option>`).join('');
  if (state.selectedVersion) {
    const info = selectedVersionInfo();
    const base = info ? info.gameVersion : '';
    if (base) select.value = base;
  }
  loadLoaderVersions();
}

async function loadLoaderVersions() {
  const mc = $('#loaderMcVersion').value;
  const type = $('#loaderType').value;
  const select = $('#loaderVersion');
  const hint = $('#loaderHint');
  if (!mc) return;
  select.innerHTML = '<option>加载中…</option>';
  select.disabled = true;
  hint.textContent = '正在获取加载器版本列表…';
  try {
    let data;
    let recommended = '';
    if (type === 'fabric') {
      data = (await api.loaders.fabricVersions(mc)).map((v) => ({ value: v.version, label: v.version + (v.stable ? '（稳定）' : '') }));
    } else if (type === 'forge') {
      const result = await api.loaders.forgeVersions(mc);
      recommended = result.recommended || '';
      data = result.versions.map((v) => ({ value: v.artifact, label: v.loader }));
    } else {
      const result = await api.loaders.neoForgeVersions(mc);
      recommended = result.recommended || '';
      data = result.versions.map((v) => ({ value: v.artifact, label: v.loader }));
    }
    if (!data.length) {
      select.innerHTML = '<option value="">无可用版本</option>';
      select.disabled = true;
      hint.textContent = `${mc} 没有找到可用的 ${type} 版本`;
      return;
    }
    select.disabled = false;
    select.innerHTML = data.map((d) => `<option value="${esc(d.value)}">${esc(d.label)}</option>`).join('');
    if (recommended) {
      const match = data.find((d) => d.value.endsWith(recommended) || d.value === recommended);
      if (match) select.value = match.value;
    }
    hint.textContent = `已找到 ${data.length} 个可用版本，推荐安装最新稳定版。`;
  } catch (err) {
    select.innerHTML = '<option value="">获取失败</option>';
    hint.textContent = `获取版本失败：${friendlyError(err)}`;
  }
}

async function installLoader() {
  const mc = $('#loaderMcVersion').value;
  const type = $('#loaderType').value;
  const version = $('#loaderVersion').value;
  if (!mc || !version) return;
  if (!beginInstall('安装加载器')) return;
  $('#btnInstallLoader').disabled = true;
  try {
    const result = await api.loaders.install({ type, mc, version });
    toast(`${loaderName({ loader: type })} 安装完成`, 'success');
    await refreshVersions();
    if (result && result.id) {
      state.selectedVersion = result.id;
      await api.config.save({ selectedVersion: result.id });
      renderVersions();
    }
    setStatus('就绪');
  } catch (err) {
    setStatus('安装失败', 'error');
    toast(`加载器安装失败：${friendlyError(err)}`, 'error', 8000);
  } finally {
    $('#btnInstallLoader').disabled = false;
    setInstalling(false);
  }
}

/* ---------------- Modrinth ---------------- */
function loadModrinthVersionFilter() {
  const select = $('#modrinthGameVersion');
  const releases = state.manifest.filter((v) => v.type === 'release').slice(0, 80);
  select.innerHTML =
    '<option value="">所有游戏版本</option>' +
    releases.map((v) => `<option value="${esc(v.id)}">${esc(v.id)}</option>`).join('');
}

async function searchModrinth(reset = false) {
  const m = state.modrinth;
  if (m.loading) return;
  if (reset) {
    m.offset = 0;
    m.hits = [];
  }
  m.loading = true;
  $('#btnModrinthSearch').disabled = true;
  if (!m.hits.length) $('#modrinthResults').innerHTML = '<div class="empty">正在搜索 Modrinth…</div>';
  const zh = window.XueCraftZh.translateQuery(m.query);
  const hint = $('#modrinthHint');
  if (hint) {
    hint.textContent = zh.changed
      ? `已将中文关键词转换为：${zh.query}`
      : '支持中文搜索，会自动转换为 Modrinth 英文检索词。资源名称与简介由作者填写，常见资源已内置中文名称。';
  }
  try {
    const data = await api.modrinth.search({
      query: zh.query,
      type: m.type,
      gameVersion: m.gameVersion,
      loader: m.loader,
      offset: m.offset,
      limit: 20,
      sort: m.sort,
    });
    m.total = data.total;
    m.hits = reset ? data.hits : m.hits.concat(data.hits);
    m.offset += data.hits.length;
    renderModrinth();
  } catch (err) {
    $('#modrinthResults').innerHTML = `<div class="empty">搜索失败：${esc(friendlyError(err))}</div>`;
  } finally {
    m.loading = false;
    $('#btnModrinthSearch').disabled = false;
  }
}

function renderModrinth() {
  const m = state.modrinth;
  const list = $('#modrinthResults');
  if (!m.hits.length) {
    const chineseQuery = /[\u4e00-\u9fff]/.test(m.query);
    list.innerHTML = chineseQuery
      ? '<div class="empty">没有找到匹配资源。可尝试常见中文关键词，如「优化」「机械动力」「光影」「暮色森林」。</div>'
      : '<div class="empty">没有找到资源，试试更换筛选条件。</div>';
    return;
  }
  list.innerHTML = m.hits
    .map((hit) => {
      const zh = window.XueCraftZh.knownFor(hit.slug, hit.title);
      const title = zh ? zh.zh : hit.title;
      const desc = (zh && zh.desc) || hit.description || '';
      const enTitle = zh && zh.zh !== hit.title ? `<span class="resource-en">${esc(hit.title)}</span>` : '';
      return `
      <div class="resource-card" data-project="${esc(hit.slug || hit.id)}">
        <div class="resource-icon">${hit.icon ? `<img src="${esc(hit.icon)}" alt="" onerror="this.remove()" />` : '✦'}</div>
        <div class="resource-body">
          <strong>${esc(title)}</strong>${enTitle}
          <p>${esc(desc)}</p>
          <div class="resource-stats">
            <span>↓ ${Number(hit.downloads || 0).toLocaleString('en-US')}</span>
            <span>♥ ${Number(hit.follows || 0).toLocaleString('en-US')}</span>
            <span>${esc(hit.author || '')}</span>
          </div>
        </div>
      </div>`;
    })
    .join('');
  $('#btnLoadMore').style.display = m.hits.length < m.total ? '' : 'none';
}

async function openProjectModal(projectId) {
  try {
    const project = await api.modrinth.project(projectId);
    const info = selectedVersionInfo();
    const gameVersion = info ? info.gameVersion : '';
    const loader = info && info.loader && info.loader !== 'loader' ? info.loader : '';
    let versions = [];
    try {
      versions = await api.modrinth.versions({
        projectId: project.id,
        gameVersion: state.modrinth.type === 'modpack' ? '' : gameVersion,
        loader: ['mod', 'modpack'].includes(state.modrinth.type) ? loader : '',
      });
      if (!versions.length) {
        versions = await api.modrinth.versions({ projectId: project.id });
      }
    } catch {
      versions = [];
    }
    state.modal = { projectId: project.id, project, versions, selectedVersionId: versions[0]?.id || '' };

    const type = state.modrinth.type;
    const needTarget = type !== 'modpack';
    const targetOptions = state.versions
      .map((v) => `<option value="${esc(v.id)}" ${v.id === state.selectedVersion ? 'selected' : ''}>${esc(v.id)}（${esc(v.gameVersion)}）</option>`)
      .join('');

    const zh = window.XueCraftZh.knownFor(project.slug, project.title);
    const projectTitle = zh ? zh.zh : project.title;
    const projectDesc = (zh && zh.desc) || project.description || '';
    const enTitle = zh && zh.zh !== project.title ? `<span class="resource-en">${esc(project.title)}</span>` : '';

    const html = `
      <div class="modal">
        <div class="modal-head">
          <div class="resource-icon">${project.icon_url ? `<img src="${esc(project.icon_url)}" alt="" onerror="this.remove()" />` : '✦'}</div>
          <div style="flex:1">
            <h3>${esc(projectTitle)}</h3>${enTitle}
            <p>${esc(projectDesc)}</p>
            <div class="chip-row" style="margin-top:8px">
              <span class="chip">${esc(type === 'mod' ? 'Mod' : type === 'modpack' ? '整合包' : type === 'resourcepack' ? '资源包' : type === 'shader' ? '光影' : '数据包')}</span>
              <span class="chip">↓ ${Number(project.downloads || 0).toLocaleString('en-US')}</span>
              ${(project.loaders || []).slice(0, 4).map((l) => `<span class="chip">${esc(window.XueCraftZh.loaderName(l))}</span>`).join('')}
              ${(project.categories || []).slice(0, 4).map((c) => `<span class="chip">${esc(window.XueCraftZh.categoryName(c))}</span>`).join('')}
            </div>
          </div>
          <button class="icon-btn" data-close-modal>×</button>
        </div>

        ${needTarget && state.versions.length
          ? `<div class="modal-section">
              <h4>安装到版本</h4>
              <select id="mdTarget">${targetOptions || '<option value="">暂无本地版本</option>'}</select>
            </div>`
          : ''}
        ${needTarget && !state.versions.length ? '<div class="modal-section"><h4>安装到版本</h4><div class="hint">请先安装至少一个游戏版本。</div></div>' : ''}
        <div class="modal-section" id="mdWorldWrap" style="display:none">
          <h4>选择存档（数据包）</h4>
          <select id="mdWorld"></select>
        </div>

        <div class="modal-section">
          <h4>选择资源版本${versions.length ? '' : '（暂无可用版本）'}</h4>
          <div id="mdVersions">
            ${versions
              .slice(0, 30)
              .map(
                (v) => `
                <label class="version-option ${v.id === versions[0]?.id ? 'selected' : ''}" data-version-option="${esc(v.id)}">
                  <div class="v-main">
                    <strong>${esc(v.version_number)}</strong>
                    <span>${esc((v.game_versions || []).slice(0, 4).join(', '))} · ${esc((v.loaders || []).map((l) => window.XueCraftZh.loaderName(l)).join(', '))}</span>
                  </div>
                  <span class="badge">${esc(window.XueCraftZh.versionTypeName(v.version_type))}</span>
                </label>`
              )
              .join('')}
          </div>
        </div>

        <div class="hint" style="margin-bottom:12px">资源版权归原作者所有，安装或使用前请确认其许可协议；本启动器与 Modrinth 无隶属关系。</div>

        <div class="modal-actions">
          <button class="ghost-btn" data-close-modal>取消</button>
          <button class="primary-btn" id="mdInstall" ${versions.length ? '' : 'disabled'}>${type === 'modpack' ? '安装整合包' : '安装'}</button>
        </div>
      </div>`;
    openModal(html);

    if (type === 'datapack' && state.selectedVersion) {
      await loadWorldOptions($('#mdTarget')?.value || state.selectedVersion);
    }
  } catch (err) {
    toast(`加载项目失败：${friendlyError(err)}`, 'error', 5000);
  }
}

/** 读取指定版本存档列表，用于数据包安装 */
async function loadWorldOptions(versionId) {
  const wrap = $('#mdWorldWrap');
  const select = $('#mdWorld');
  if (!wrap || !select) return;
  wrap.style.display = '';
  try {
    const saves = await api.versions.saves(versionId);
    select.innerHTML = saves.length
      ? saves.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')
      : '<option value="">该版本暂无存档</option>';
  } catch {
    select.innerHTML = '<option value="">读取存档失败</option>';
  }
}

async function installFromModal() {
  const { project, versions, selectedVersionId } = state.modal;
  if (!project) return;
  const version = versions.find((v) => v.id === selectedVersionId) || versions[0];
  if (!version) return;
  const type = state.modrinth.type;
  const payload = { projectId: project.id, versionId: version.id, contentType: type };
  if (type !== 'modpack') {
    const target = $('#mdTarget')?.value || state.selectedVersion;
    if (!target) {
      toast('请先安装游戏版本', 'error');
      return;
    }
    payload.targetVersionId = target;
    if (type === 'mod') {
      const info = state.versions.find((v) => v.id === target);
      if (!info || info.loader === 'vanilla' || !info.loader) {
        toast('该版本为原版，安装 Mod 前请先安装 Fabric/Forge/NeoForge', 'error', 5000);
        return;
      }
      payload.loader = info.loader;
    }
    if (type === 'datapack') {
      payload.world = $('#mdWorld')?.value || '';
      if (!payload.world) {
        toast('请先选择存档', 'error');
        return;
      }
    }
  }
  $('#mdInstall').disabled = true;
  if (!beginInstall(type === 'modpack' ? '安装整合包' : '安装资源')) {
    $('#mdInstall').disabled = false;
    return;
  }
  try {
    const result = await api.modrinth.install(payload);
    toast(type === 'modpack' ? '整合包安装完成' : '资源安装完成', 'success');
    closeModal();
    await refreshVersions();
    if (type === 'modpack' && result && result.versionId) {
      state.selectedVersion = result.versionId;
      await api.config.save({ selectedVersion: result.versionId });
      renderVersions();
    }
  } catch (err) {
    toast(`安装失败：${friendlyError(err)}`, 'error', 7000);
  } finally {
    const btn = $('#mdInstall');
    if (btn) btn.disabled = false;
    setInstalling(false);
  }
}

/* ---------------- 整合包导入 / 更新 ---------------- */
function packFileName(filePath) {
  return String(filePath).split(/[\\/]/).pop() || '整合包.mrpack';
}

function confirmPackImport(filePath) {
  if (!/\.mrpack$/i.test(filePath)) {
    toast('仅支持 Modrinth 整合包文件（.mrpack）', 'error', 5000);
    return;
  }
  if (state.installing) {
    toast('正在下载或安装，请等待当前任务完成', 'error');
    return;
  }
  openModal(`
    <div class="modal">
      <div class="modal-head">
        <div style="flex:1"><h3>导入 / 更新整合包</h3><p>${esc(packFileName(filePath))}</p></div>
        <button class="icon-btn" data-close-modal>×</button>
      </div>
      <div class="modal-section">
        <p class="muted" style="font-size:12.5px;line-height:1.8">
          启动器会读取整合包内的 modrinth.index.json，并自动安装所需的 Minecraft 版本、加载器与依赖。<br>
          若已存在同名整合包版本，将原地覆盖更新并清理旧版本文件，<b>无需先删除旧版本</b>；<br>
          存档（saves）、日志与崩溃报告不会被删除。
        </p>
      </div>
      <div class="modal-actions">
        <button class="ghost-btn" data-close-modal>取消</button>
        <button class="primary-btn" id="btnConfirmPack">开始导入</button>
      </div>
    </div>`);
  $('#btnConfirmPack').addEventListener('click', () => installPackFromPath(filePath));
}

async function installPackFromPath(filePath) {
  if (!beginInstall('导入整合包')) return;
  closeModal();
  showProgress({ scope: 'modrinth', title: '整合包', message: '正在读取整合包…', completed: 0, total: 1 });
  try {
    const result = await api.modrinth.installPackFile(filePath);
    toast(result && result.updated ? `整合包已更新：${result.title}` : `整合包已安装：${packFileName(filePath)}`, 'success', 5200);
    await refreshVersions();
    if (result && result.versionId) {
      state.selectedVersion = result.versionId;
      await api.config.save({ selectedVersion: result.versionId });
      renderVersions();
    }
    setStatus('就绪');
  } catch (err) {
    setStatus('导入失败', 'error');
    toast(`整合包导入失败：${friendlyError(err)}`, 'error', 8000);
  } finally {
    setInstalling(false);
    hideProgressLater();
  }
}

async function pickPackFile() {
  if (state.installing) {
    toast('正在下载或安装，请等待当前任务完成', 'error');
    return;
  }
  try {
    const filePath = await api.modrinth.pickPackFile();
    if (filePath) confirmPackImport(filePath);
  } catch (err) {
    toast(`选择文件失败：${friendlyError(err)}`, 'error');
  }
}

async function importUpdaterFile() {
  if (state.installing) {
    toast('正在下载或安装，请等待当前任务完成', 'error');
    return;
  }
  try {
    const filePath = await api.updater.pickInstaller();
    if (filePath) await applyUpdater(filePath);
  } catch (err) {
    toast(`导入更新包失败：${friendlyError(err)}`, 'error', 7000);
  }
}

async function applyUpdater(filePath) {
  try {
    toast('正在校验更新包版本…', 'info', 2500);
    const result = await api.updater.applyInstaller(filePath);
    if (result && result.applying) {
      toast('已开始更新，启动器即将关闭并自动安装新版本', 'success', 7000);
    }
  } catch (err) {
    toast(`更新失败：${friendlyError(err)}`, 'error', 8000);
  }
}

/* ---------------- 启动 ---------------- */
function appendConsole(line) {
  const box = $('#console1');
  if (box.textContent === '等待启动…') box.textContent = '';
  box.textContent += `${line}\n`;
  const lines = box.textContent.split('\n');
  if (lines.length > 600) box.textContent = lines.slice(-600).join('\n');
  box.scrollTop = box.scrollHeight;
}

async function launchSelected() {
  const id = state.selectedVersion;
  if (!id) {
    toast('请先选择版本', 'error');
    switchView('download');
    return;
  }
  if (state.installing) {
    toast('正在下载或安装，请等待完成后再启动游戏', 'error', 5000);
    return;
  }
  if (!activeAccount()) {
    toast('请先登录微软正版账号', 'error');
    switchView('account');
    return;
  }
  $('#btnLaunch').disabled = true;
  setStatus('准备启动', 'busy');
  $('#console1').textContent = '';
  appendConsole(`[xueCraft] ${new Date().toLocaleTimeString()} 正在准备启动 ${id}…`);
  try {
    const result = await api.game.launch(id);
    state.running = true;
    setStatus('游戏运行中', 'busy');
    appendConsole(`[xueCraft] 已启动，PID ${result.pid}，日志：${result.logFile}`);
    toast('游戏已启动', 'success');
  } catch (err) {
    setStatus('启动失败', 'error');
    appendConsole(`[错误] ${friendlyError(err)}`);
    toast(`启动失败：${friendlyError(err)}`, 'error', 7000);
  } finally {
    $('#btnLaunch').disabled = false;
  }
}

/* ---------------- 设置 ---------------- */
function renderJavaInfo(javaList) {
  if (!javaList || !javaList.length) {
    $('#javaInfo').textContent = '未检测到（将自动下载）';
  } else {
    $('#javaInfo').textContent = `Java ${javaList[0].major}`;
  }
  renderJavaSelect(javaList || []);
}

function renderJavaSelect(javaList) {
  const select = $('#setJavaPath');
  if (!select) return;
  const configured = state.config.javaPath || '';
  const options = ['<option value="">自动检测 / 自动下载</option>'];
  const seen = new Set();
  for (const j of javaList || []) {
    if (seen.has(j.path)) continue;
    seen.add(j.path);
    options.push(`<option value="${esc(j.path)}">Java ${j.major} · ${esc(j.path)}</option>`);
  }
  if (configured && !seen.has(configured)) {
    options.push(`<option value="${esc(configured)}">${esc(configured)}</option>`);
  }
  select.innerHTML = options.join('');
  select.value = configured;
  $('#javaHint').textContent = javaList && javaList.length
    ? `已检测到 ${javaList.length} 个 Java 运行时，启动时会自动选择匹配版本。`
    : '未检测到 Java，启动时将自动下载 Temurin 运行时。';
}

function renderSettingsValues() {
  const c = state.config;
  $('#setGameDir').value = c.gameDir || '';
  $('#setMemoryMin').value = c.memoryMin || 1024;
  $('#setMemoryMax').value = c.memoryMax || 4096;
  $('#setJvmArgs').value = c.jvmArgs || '';
  $('#setGameArgs').value = c.gameArgs || '';
  $('#setConcurrency').value = c.downloadConcurrency || 16;
  $('#setMsClientId').value = c.msClientId || '';
  $('#setMirror').checked = c.useMirror !== false;
  $('#setIsolation').checked = c.isolation !== false;
  $('#aboutRoot').textContent = state.info ? state.info.root : '-';
  $('#rootInfo').textContent = state.info ? state.info.root : '-';
}

function renderSettings() {
  renderSettingsValues();
  if (state.info) renderJavaSelect(state.info.java || []);
}

async function saveSettings() {
  const patch = {
    gameDir: $('#setGameDir').value,
    memoryMin: Number($('#setMemoryMin').value) || 1024,
    memoryMax: Number($('#setMemoryMax').value) || 4096,
    jvmArgs: $('#setJvmArgs').value.trim(),
    gameArgs: $('#setGameArgs').value.trim(),
    downloadConcurrency: Math.min(64, Math.max(1, Number($('#setConcurrency').value) || 16)),
    useMirror: $('#setMirror').checked,
    isolation: $('#setIsolation').checked,
    javaPath: $('#setJavaPath').value,
    msClientId: $('#setMsClientId').value.trim() || '00000000402b5328',
  };
  if (patch.memoryMax < patch.memoryMin) {
    toast('最大内存不能小于最小内存', 'error');
    return;
  }
  try {
    state.config = await api.config.save(patch);
    renderSettingsValues();
    renderVersions();
    toast('设置已保存', 'success');
  } catch (err) {
    toast(`保存失败：${friendlyError(err)}`, 'error');
  }
}

/* ---------------- 样式辅助：弹窗与进度 ---------------- */
function openModal(html) {
  const root = $('#modalRoot');
  root.innerHTML = html;
  root.classList.add('open');
}

function closeModal() {
  const root = $('#modalRoot');
  root.classList.remove('open');
  root.innerHTML = '';
}

function showProgress(p) {
  const card = $('#progressCard');
  card.classList.remove('hidden');
  $('#progressTitle').textContent = p.title || p.scope || '任务';
  $('#progressMsg').textContent = p.message || p.phase || '处理中…';
  const total = Number(p.total || 0);
  const done = Number(p.completed || 0);
  let percent = 0;
  if (total > 0) percent = Math.min(100, Math.round((done / total) * 100));
  else if (p.bytesTotal) percent = Math.min(100, Math.round((p.bytesDone / p.bytesTotal) * 100));
  $('#progressFill').style.width = `${percent}%`;
  $('#progressPercent').textContent = `${percent}%`;
  $('#progressCount').textContent = total ? `${done} / ${total}` : p.bytesTotal ? `${formatBytes(p.bytesDone || 0)} / ${formatBytes(p.bytesTotal)}` : '';
}

function hideProgressLater(delay = 900) {
  setTimeout(() => $('#progressCard').classList.add('hidden'), delay);
}

/* ---------------- 事件绑定 ---------------- */
function bindEvents() {
  $$('[data-legal]').forEach((btn) => {
    btn.addEventListener('click', () => window.XueCraftLegal.open(btn.dataset.legal));
  });
  $$('.nav-item').forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.view)));

  $('#launchVersionSelect').addEventListener('change', async (e) => {
    state.selectedVersion = e.target.value;
    renderVersions();
    try {
      await api.config.save({ selectedVersion: state.selectedVersion });
    } catch {
      // 保存失败不影响本次使用
    }
  });

  $('#btnLaunch').addEventListener('click', launchSelected);
  $('#btnOpenGameDir').addEventListener('click', () => {
    if (state.selectedVersion) api.game.openFolder(state.selectedVersion);
  });
  $('#btnVersionOptions').addEventListener('click', () => switchView('versions'));
  $('#btnLoginQuick').addEventListener('click', () => switchView('account'));
  $('#accountMini').addEventListener('click', () => switchView('account'));

  $('#memoryRange').addEventListener('input', (e) => {
    $('#memoryLabel').textContent = `${e.target.value} MB`;
  });
  $('#memoryRange').addEventListener('change', async (e) => {
    try {
      state.config = await api.config.save({ memoryMax: Number(e.target.value) });
    } catch (err) {
      toast(`保存内存设置失败：${friendlyError(err)}`, 'error');
    }
  });

  $('#btnLogs').addEventListener('click', openLatestLog);
  $('#btnOpenLogsInline').addEventListener('click', openLatestLog);
  $('#btnClearConsole').addEventListener('click', () => {
    $('#console1').textContent = '等待启动…';
  });
  $('#btnRefreshAll').addEventListener('click', async () => {
    await refreshVersions();
    await loadManifest(state.manifestType);
    toast('已刷新', 'success', 1600);
  });

  $('#btnRefreshVersions').addEventListener('click', refreshVersions);
  $('#btnImportPack').addEventListener('click', pickPackFile);
  $('#btnImportUpdater').addEventListener('click', importUpdaterFile);

  // 拖入 .mrpack：直接安装，或原地更新同名整合包；拖入 xueCraft 安装包：覆盖升级
  let dragDepth = 0;
  const hasFileDrag = (event) =>
    Boolean(event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files'));
  window.addEventListener('dragenter', (e) => {
    if (!hasFileDrag(e)) return;
    e.preventDefault();
    dragDepth++;
    $('#dropOverlay').classList.remove('hidden');
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFileDrag(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $('#dropOverlay').classList.add('hidden');
  });
  window.addEventListener('drop', async (e) => {
    if (!hasFileDrag(e)) return;
    e.preventDefault();
    dragDepth = 0;
    $('#dropOverlay').classList.add('hidden');
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    if (files.length > 1) {
      toast('一次只能导入一个整合包', 'error');
      return;
    }
    const file = files[0];
    const filePath = api.getPathForFile(file) || file.path || '';
    if (!filePath) {
      toast('无法读取拖入文件的路径，请改用界面上的导入按钮', 'error', 6000);
      return;
    }
    if (/\.exe$/i.test(file.name) && /xue\s*-?\s*craft|traecraft/i.test(file.name)) {
      await applyUpdater(filePath);
      return;
    }
    if (!/\.mrpack$/i.test(file.name)) {
      toast('仅支持 Modrinth 整合包（.mrpack）或 xue Craft launcher 安装包（.exe）', 'error', 6000);
      return;
    }
    confirmPackImport(filePath);
  });

  $('#versionList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'launch') {
      state.selectedVersion = id;
      await api.config.save({ selectedVersion: id });
      renderVersions();
      switchView('home');
      launchSelected();
    } else if (action === 'repair') {
      if (!beginInstall('校验修复中')) return;
      btn.disabled = true;
      try {
        await api.repairVersion(id);
        toast('修复完成', 'success');
        setStatus('就绪');
      } catch (err) {
        setStatus('修复失败', 'error');
        toast(`修复失败：${friendlyError(err)}`, 'error', 6000);
      } finally {
        btn.disabled = false;
        setInstalling(false);
      }
    } else if (action === 'open') {
      api.versions.openDir(id);
    } else if (action === 'delete') {
      deleteVersionRow(id);
    }
  });

  $('#downloadTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    $$('#downloadTabs button').forEach((b) => b.classList.toggle('active', b === btn));
    state.downloadTab = btn.dataset.tab;
    $$('#view-download .tab-panel').forEach((p) =>
      p.classList.toggle('active', p.id === `tab-${state.downloadTab}`)
    );
    if (state.downloadTab === 'loader') ensureLoaderMcOptions();
  });

  $('#releaseFilter').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-type]');
    if (!btn) return;
    $$('#releaseFilter button').forEach((b) => b.classList.toggle('active', b === btn));
    loadManifest(btn.dataset.type);
  });

  let searchTimer = null;
  $('#versionSearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderManifest, 160);
  });
  $('#btnRefreshManifest').addEventListener('click', async () => {
    await loadManifest(state.manifestType);
    toast('版本清单已刷新', 'success', 1600);
  });

  $('#manifestList').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-install]');
    if (!btn || btn.disabled) return;
    const id = btn.dataset.install;
    btn.disabled = true;
    btn.textContent = '安装中';
    installVanilla(id);
  });

  $('#loaderMcVersion').addEventListener('change', loadLoaderVersions);
  $('#loaderType').addEventListener('change', loadLoaderVersions);
  $('#btnInstallLoader').addEventListener('click', installLoader);
  $('#loaderMcVersion').addEventListener('focus', ensureLoaderMcOptions, { once: true });

  $('#modrinthTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-type]');
    if (!btn) return;
    $$('#modrinthTabs button').forEach((b) => b.classList.toggle('active', b === btn));
    state.modrinth.type = btn.dataset.type;
    const loaderSelect = $('#modrinthLoader');
    loaderSelect.disabled = !['mod', 'modpack'].includes(state.modrinth.type);
    searchModrinth(true);
  });

  $('#btnModrinthSearch').addEventListener('click', () => {
    state.modrinth.query = $('#modrinthSearch').value.trim();
    state.modrinth.gameVersion = $('#modrinthGameVersion').value;
    state.modrinth.loader = $('#modrinthLoader').value;
    state.modrinth.sort = $('#modrinthSort').value;
    searchModrinth(true);
  });
  $('#modrinthSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#btnModrinthSearch').click();
  });
  $('#modrinthGameVersion').addEventListener('change', () => $('#btnModrinthSearch').click());
  $('#modrinthLoader').addEventListener('change', () => $('#btnModrinthSearch').click());
  $('#modrinthSort').addEventListener('change', () => $('#btnModrinthSearch').click());
  $('#btnLoadMore').addEventListener('click', () => searchModrinth(false));

  $('#modrinthResults').addEventListener('click', (e) => {
    const card = e.target.closest('[data-project]');
    if (card) openProjectModal(card.dataset.project);
  });

  $('#modalRoot').addEventListener('click', (e) => {
    if (e.target === $('#modalRoot')) closeModal();
    if (e.target.closest('[data-close-modal]')) closeModal();
    const option = e.target.closest('[data-version-option]');
    if (option) {
      $$('#mdVersions .version-option').forEach((o) => o.classList.remove('selected'));
      option.classList.add('selected');
      state.modal.selectedVersionId = option.dataset.versionOption;
    }
    if (e.target.id === 'mdTarget' && state.modrinth.type === 'datapack') {
      loadWorldOptions(e.target.value);
    }
    if (e.target.id === 'mdInstall') installFromModal();
  });

  $('#btnLoginBrowser').addEventListener('click', startBrowserLogin);
  $('#btnLoginDevice').addEventListener('click', startDeviceLogin);
  $('#btnCopyCode').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('#deviceCode').textContent);
      toast('代码已复制', 'success', 1600);
    } catch {
      toast('复制失败，请手动选择复制', 'error');
    }
  });
  $('#btnOpenLogin').addEventListener('click', () => {
    const url = $('#btnOpenLogin').dataset.url || 'https://microsoft.com/link';
    api.openExternal(url);
  });
  $('#accountList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-account-action]');
    if (!btn) return;
    const { accountAction, uuid } = btn.dataset;
    try {
      const result = accountAction === 'switch' ? await api.auth.setActive(uuid) : await api.auth.logout(uuid);
      state.accounts = result.accounts;
      state.activeId = result.activeId;
      renderAccounts();
      toast(accountAction === 'switch' ? '已切换账号' : '已退出账号', 'success', 1800);
    } catch (err) {
      toast(`操作失败：${friendlyError(err)}`, 'error');
    }
  });

  $('#btnSaveSettings').addEventListener('click', saveSettings);
  $('#btnPickGameDir').addEventListener('click', async () => {
    const dir = await api.config.pickDir();
    if (dir) $('#setGameDir').value = dir;
  });
  $('#btnPickJava').addEventListener('click', async () => {
    const file = await api.config.pickJava();
    if (file) {
      const select = $('#setJavaPath');
      const option = document.createElement('option');
      option.value = file;
      option.textContent = file;
      select.appendChild(option);
      select.value = file;
    }
  });
  $('#btnRescanJava').addEventListener('click', async () => {
    try {
      const list = await api.java.detect();
      renderJavaInfo(list);
      toast(`检测到 ${list.length} 个 Java`, 'success', 1800);
    } catch (err) {
      toast(`检测失败：${friendlyError(err)}`, 'error');
    }
  });

  $('#btnHideProgress').addEventListener('click', () => $('#progressCard').classList.add('hidden'));
}

async function openLatestLog() {
  const id = state.selectedVersion;
  if (id) {
    try {
      const log = await api.logs.latest(id);
      if (log.content) {
        openModal(`
          <div class="modal">
            <div class="modal-head">
              <div style="flex:1"><h3>最近一次启动日志</h3><p>${esc(log.name)}</p></div>
              <button class="icon-btn" data-close-modal>×</button>
            </div>
            <pre class="console" style="height:52vh">${esc(log.content)}</pre>
            <div class="modal-actions"><button class="ghost-btn" data-close-modal>关闭</button></div>
          </div>`);
        return;
      }
    } catch {
      // 日志读取失败时直接打开日志目录
    }
  }
  api.logs.openDir();
}

/* ---------------- 主进程事件 ---------------- */
function subscribeEvents() {
  api.on('progress', (p) => {
    showProgress(p);
    if (p.phase === 'done') {
      hideProgressLater(1100);
      if (p.scope === 'install' || p.scope === 'repair' || p.scope === 'loader' || p.scope === 'modrinth') {
        refreshVersions();
      }
      if (p.scope === 'launch') setStatus('就绪');
    }
  });

  api.on('game:log', (data) => {
    if (data.versionId === state.selectedVersion) appendConsole(data.line);
  });

  api.on('game:exit', (data) => {
    state.running = false;
    setStatus('游戏已退出');
    appendConsole(`[xueCraft] 游戏进程已退出（code=${data.code}），日志：${data.logFile}`);
  });

  api.on('auth:state', (payload) => {
    state.accounts = payload.accounts || [];
    state.activeId = payload.activeId || '';
    renderAccounts();
    $('#btnLoginDevice').disabled = false;
    $('#btnLoginBrowser').disabled = false;
    $('#deviceCodeBox').classList.add('hidden');
    setStatus('已登录');
    const account = activeAccount();
    toast(account ? `欢迎，${account.name}` : '登录成功', 'success');
  });

  api.on('auth:error', (payload) => {
    $('#btnLoginDevice').disabled = false;
    $('#deviceCodeStatus').textContent = payload.message;
    setStatus('登录失败', 'error');
    toast(payload.message, 'error', 6000);
  });

  api.on('auth:status', (payload) => {
    if (payload.message) $('#deviceCodeStatus').textContent = payload.message;
  });
}

window.addEventListener('DOMContentLoaded', init);
