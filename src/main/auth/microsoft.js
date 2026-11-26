'use strict';

const path = require('node:path');
const fsp = require('node:fs').promises;
const paths = require('../core/paths');
const { sleep } = require('../core/http');

// 官方 Minecraft 启动器客户端 ID（MSA 应用）
const CLIENT_ID = '00000000402b5328';
// 设备代码流的 scope（设备代码需在设置中填写自有的 Entra 应用 ID）
const SCOPE = 'XboxLive.signin offline_access';
const AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';

// 官方 MSA 登录（浏览器授权码流），与官方启动器网页登录一致
const LIVE_AUTHORIZE = 'https://login.live.com/oauth20_authorize.srf';
const LIVE_TOKEN = 'https://login.live.com/oauth20_token.srf';
const LIVE_REDIRECT = 'https://login.live.com/oauth20_desktop.srf';
const LIVE_SCOPE = 'service::user.auth.xboxlive.com::MBI_SSL';

const vault = {
  encrypt: (text) => Buffer.from(text, 'utf8').toString('base64'),
  decrypt: (text) => Buffer.from(text, 'base64').toString('utf8'),
};

/** 由主进程注入 Electron safeStorage，实现账号令牌加密存储 */
function setVault(impl) {
  Object.assign(vault, impl);
}

function accountsPath() {
  return path.join(paths.root(), 'accounts.json');
}

async function readStore() {
  const raw = await paths.readJson(accountsPath(), null);
  if (!raw) return { accounts: [], activeId: '' };
  try {
    const plain = vault.decrypt(raw.vault || '');
    const data = JSON.parse(plain || '{}');
    return { accounts: data.accounts || [], activeId: data.activeId || '' };
  } catch {
    return { accounts: [], activeId: '' };
  }
}

async function writeStore(store) {
  await paths.writeJson(accountsPath(), { vault: vault.encrypt(JSON.stringify(store)) });
  return store;
}

async function postForm(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'xueCraftLauncher/1.0.0',
    },
    body: new URLSearchParams(params).toString(),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function postJson(url, data, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'xueCraftLauncher/1.0.0',
      ...headers,
    },
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.errorMessage || body.error_description || `请求失败 (HTTP ${res.status})`);
    err.details = body;
    throw err;
  }
  return body;
}

/** 构造微软官方登录页地址（浏览器授权码流） */
function buildAuthorizeUrl() {
  const url = new URL(LIVE_AUTHORIZE);
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', LIVE_SCOPE);
  url.searchParams.set('redirect_uri', LIVE_REDIRECT);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

/**
 * 使用浏览器授权码完成登录：登录窗口捕获 code 后由主进程换取令牌
 */
async function loginWithLiveCode(code) {
  const res = await postForm(LIVE_TOKEN, {
    client_id: CLIENT_ID,
    code,
    grant_type: 'authorization_code',
    redirect_uri: LIVE_REDIRECT,
    scope: LIVE_SCOPE,
  });
  if (!res.ok) {
    throw new Error(res.body.error_description || res.body.error || '微软登录失败，请重试');
  }
  const mc = await authenticateWithXbox(res.body.access_token);
  const account = {
    ...mc,
    refreshToken: res.body.refresh_token,
    flow: 'live',
    expiresAt: Date.now() + (mc.expiresIn || 86400) * 1000,
    addedAt: new Date().toISOString(),
  };
  delete account.expiresIn;
  const store = await readStore();
  const rest = store.accounts.filter((a) => a.uuid !== account.uuid);
  store.accounts = [account, ...rest];
  store.activeId = account.uuid;
  await writeStore(store);
  return publicAccount(account);
}

/**
 * 申请设备代码（需要支持设备代码流的 Entra 应用，默认官方 MSA 客户端 ID 不可用时会给出提示）
 */
async function requestDeviceCode(clientIdOverride) {
  const clientId = clientIdOverride || paths.loadConfig().msClientId || CLIENT_ID;
  const res = await postForm(`${AUTHORITY}/devicecode`, { client_id: clientId, scope: SCOPE });
  if (res.ok) {
    return {
      deviceCode: res.body.device_code,
      userCode: res.body.user_code,
      verificationUri: res.body.verification_uri,
      expiresIn: res.body.expires_in,
      interval: res.body.interval || 5,
      message: res.body.message,
      clientId,
    };
  }
  const description = res.body.error_description || '';
  if (/AADSTS700016/.test(description) || res.body.error === 'unauthorized_client') {
    throw new Error(
      '该客户端 ID 无法使用设备代码登录：官方 Minecraft 客户端未在 Microsoft Entra 注册。请改用「浏览器登录」，或在设置中填写你自有的、已开启设备代码流的 Entra 应用 ID。'
    );
  }
  throw new Error(description || '无法获取设备代码，请检查网络');
}

function mapXstsError(body) {
  const xerr = String(body.XErr || '');
  if (xerr === '2148916233') return '该微软账号还没有 Xbox 档案，请先在 xbox.com 创建档案（免费）后重试。';
  if (xerr === '2148916238') return '该账号为未成年人账号，需要先加入 Microsoft 家庭组。';
  if (xerr === '2148916235') return '该账号所在地区不支持 Xbox Live。';
  if (xerr === '2148916227') return '该微软账号已被 Xbox Live 封禁。';
  return body.Message || 'Xbox Live 认证失败';
}

async function authenticateWithXbox(msAccessToken) {
  const xbl = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: {
      AuthMethod: 'RPS',
      SiteName: 'user.auth.xboxlive.com',
      RpsTicket: `d=${msAccessToken}`,
    },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  });

  let xsts;
  try {
    xsts = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    });
  } catch (err) {
    throw new Error(mapXstsError(err.details || {}));
  }

  const uhs = xsts.DisplayClaims.xui[0].uhs;
  const xuid = xsts.DisplayClaims.xui[0].xid;
  const mc = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
    identityToken: `XBL3.0 x=${uhs};${xsts.Token}`,
  });

  const profileRes = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: `Bearer ${mc.access_token}`, 'User-Agent': 'xueCraftLauncher/1.0.0' },
  });
  if (profileRes.status === 404) {
    throw new Error('该账号未拥有 Minecraft: Java Edition，请先购买正版。');
  }
  if (!profileRes.ok) throw new Error(`获取 Minecraft 档案失败 (HTTP ${profileRes.status})`);
  const profile = await profileRes.json();

  return {
    accessToken: mc.access_token,
    expiresIn: mc.expires_in,
    uuid: profile.id,
    name: profile.name,
    xuid: xuid || '',
    skins: profile.skins || [],
    capes: profile.capes || [],
  };
}

function publicAccount(account) {
  return {
    id: account.uuid,
    name: account.name,
    uuid: account.uuid,
    xuid: account.xuid || '',
    expiresAt: account.expiresAt || 0,
    skins: account.skins || [],
    capes: account.capes || [],
  };
}

/** 轮询设备代码，登录成功后保存账号 */
async function pollForAccount(deviceCode, { interval = 5, expiresIn = 900, clientId = CLIENT_ID, onStatus } = {}) {
  const deadline = Date.now() + expiresIn * 1000;
  let wait = interval;
  while (Date.now() < deadline) {
    await sleep(wait * 1000);
    const res = await postForm(`${AUTHORITY}/token`, {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: clientId,
      device_code: deviceCode,
    });
    if (res.ok) {
      if (onStatus) onStatus({ phase: 'xbox', message: '正在验证 Xbox 账号…' });
      const mc = await authenticateWithXbox(res.body.access_token);
      const account = {
        ...mc,
        refreshToken: res.body.refresh_token,
        msClientId: clientId,
        flow: 'device',
        expiresAt: Date.now() + (mc.expiresIn || 86400) * 1000,
        addedAt: new Date().toISOString(),
      };
      delete account.expiresIn;
      const store = await readStore();
      const rest = store.accounts.filter((a) => a.uuid !== account.uuid);
      store.accounts = [account, ...rest];
      store.activeId = account.uuid;
      await writeStore(store);
      return publicAccount(account);
    }
    const error = res.body.error;
    if (error === 'authorization_pending') continue;
    if (error === 'slow_down') {
      wait += 5;
      continue;
    }
    if (error === 'expired_token') throw new Error('设备代码已过期，请重新获取。');
    if (error === 'authorization_declined') throw new Error('登录请求被拒绝。');
    throw new Error(res.body.error_description || '登录失败');
  }
  throw new Error('登录超时，请重新获取设备代码。');
}

async function refreshAccount(account) {
  if (!account.refreshToken) throw new Error('账号缺少刷新令牌，请重新登录');
  let res;
  if ((account.flow || 'live') === 'device') {
    res = await postForm(`${AUTHORITY}/token`, {
      grant_type: 'refresh_token',
      client_id: account.msClientId || CLIENT_ID,
      scope: SCOPE,
      refresh_token: account.refreshToken,
    });
  } else {
    res = await postForm(LIVE_TOKEN, {
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      scope: LIVE_SCOPE,
      redirect_uri: LIVE_REDIRECT,
      refresh_token: account.refreshToken,
    });
  }
  if (!res.ok) throw new Error(res.body.error_description || '登录令牌刷新失败，请重新登录');
  const mc = await authenticateWithXbox(res.body.access_token);
  const updated = {
    ...account,
    ...mc,
    refreshToken: res.body.refresh_token || account.refreshToken,
    expiresAt: Date.now() + (mc.expiresIn || 86400) * 1000,
  };
  delete updated.expiresIn;
  const store = await readStore();
  store.accounts = store.accounts.map((a) => (a.uuid === updated.uuid ? updated : a));
  await writeStore(store);
  return updated;
}

/** 获取可用的登录账号（自动刷新过期令牌） */
async function getAccountForLaunch() {
  const store = await readStore();
  const active = store.accounts.find((a) => a.uuid === store.activeId) || store.accounts[0];
  if (!active) throw new Error('请先登录微软账号');
  if (active.expiresAt && active.expiresAt - Date.now() < 120 * 1000) {
    return refreshAccount(active);
  }
  return active;
}

async function listAccounts() {
  const store = await readStore();
  return { accounts: store.accounts.map(publicAccount), activeId: store.activeId };
}

async function setActive(uuid) {
  const store = await readStore();
  if (!store.accounts.some((a) => a.uuid === uuid)) throw new Error('账号不存在');
  store.activeId = uuid;
  await writeStore(store);
  return listAccounts();
}

async function removeAccount(uuid) {
  const store = await readStore();
  store.accounts = store.accounts.filter((a) => a.uuid !== uuid);
  if (store.activeId === uuid) store.activeId = store.accounts[0]?.uuid || '';
  await writeStore(store);
  return listAccounts();
}

async function startLogin({ onStatus } = {}) {
  const code = await requestDeviceCode();
  if (onStatus) onStatus({ phase: 'waiting', message: '等待浏览器授权' });
  const account = await pollForAccount(code.deviceCode, {
    interval: code.interval,
    expiresIn: code.expiresIn,
    clientId: code.clientId,
    onStatus,
  });
  return account;
}

module.exports = {
  CLIENT_ID,
  LIVE_REDIRECT,
  setVault,
  buildAuthorizeUrl,
  loginWithLiveCode,
  requestDeviceCode,
  pollForAccount,
  startLogin,
  refreshAccount,
  getAccountForLaunch,
  listAccounts,
  setActive,
  removeAccount,
  authenticateWithXbox,
};
