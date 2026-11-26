'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const USER_AGENT = 'xueCraftLauncher/1.0.0 (third-party Minecraft launcher)';
const MIRROR_HOST = 'https://bmclapi2.bangbang93.com';

/** 将官方 Mojang 地址映射到 BMCLAPI 镜像（用于官方源不可达时回退） */
function toMirror(url) {
  try {
    const u = new URL(url);
    const mirrorHosts = new Set([
      'launchermeta.mojang.com',
      'launcher.mojang.com',
      'piston-data.mojang.com',
      'piston-meta.mojang.com',
      'resources.download.minecraft.net',
      'libraries.minecraft.net',
    ]);
    if (!mirrorHosts.has(u.hostname)) return null;
    if (u.hostname === 'resources.download.minecraft.net') return MIRROR_HOST + '/assets' + u.pathname;
    if (u.hostname === 'libraries.minecraft.net') return MIRROR_HOST + '/maven' + u.pathname;
    return MIRROR_HOST + u.pathname + u.search;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, ...(options.headers || {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 请求 JSON，自动重试并在失败后回退到镜像源
 */
async function fetchJson(url, { retries = 2, timeout = 30000, useMirror = true, headers } = {}) {
  const candidates = [url];
  if (useMirror) {
    const mirrored = toMirror(url);
    if (mirrored) candidates.push(mirrored);
  }
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    for (const candidate of candidates) {
      try {
        const res = await fetchWithTimeout(candidate, { headers }, timeout);
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} - ${candidate}`);
        return await res.json();
      } catch (err) {
        lastError = err;
      }
    }
    if (attempt < retries) await sleep(500 * (attempt + 1));
  }
  throw lastError;
}

/**
 * 下载文件到 dest，支持 SHA1 校验、断点续传（简单重下）、进度回调与镜像回退
 */
async function downloadFile(
  url,
  dest,
  { sha1, size, onProgress, useMirror = true, retries = 2, timeout = 60000, signal, force = false } = {}
) {
  // 已存在且校验通过时直接复用，避免重复下载
  if (!force && sha1) {
    try {
      const stat = await fsp.stat(dest);
      if (stat.isFile() && stat.size > 0) {
        const existing = await fileSha1(dest);
        if (existing.toLowerCase() === String(sha1).toLowerCase()) {
          if (onProgress) onProgress({ done: stat.size, total: stat.size, url });
          return { path: dest, sha1: existing, size: stat.size, skipped: true };
        }
      }
    } catch {
      // 文件不存在或不完整，继续下载
    }
  }

  const candidates = [url];
  if (useMirror) {
    const mirrored = toMirror(url);
    if (mirrored) candidates.push(mirrored);
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    for (const candidate of candidates) {
      const tmp = `${dest}.part`;
      try {
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        const res = await fetchWithTimeout(candidate, { signal }, timeout);
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} ${res.statusText} - ${candidate}`);

        const total = Number(res.headers.get('content-length') || size || 0);
        let done = 0;
        const hash = crypto.createHash('sha1');
        const body = Readable.fromWeb(res.body);
        const file = fs.createWriteStream(tmp);
        body.on('data', (chunk) => {
          done += chunk.length;
          hash.update(chunk);
          if (onProgress) onProgress({ done, total, url: candidate });
        });
        await pipeline(body, file);

        const digest = hash.digest('hex');
        if (sha1 && digest.toLowerCase() !== String(sha1).toLowerCase()) {
          throw new Error(`SHA1 校验失败: ${path.basename(dest)}`);
        }
        await fsp.rename(tmp, dest);
        return { path: dest, sha1: digest, size: done };
      } catch (err) {
        lastError = err;
        await fsp.rm(tmp, { force: true }).catch(() => {});
        if (err.name === 'AbortError') throw err;
      }
    }
    if (attempt < retries) await sleep(800 * (attempt + 1));
  }
  throw lastError;
}

async function downloadBuffer(url, options = {}) {
  const res = await fetchWithTimeout(url, options, options.timeout || 30000);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} - ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fileSha1(file) {
  const hash = crypto.createHash('sha1');
  await pipeline(fs.createReadStream(file), new (require('node:stream').Writable)({
    write(chunk, _enc, cb) {
      hash.update(chunk);
      cb();
    },
  }));
  return hash.digest('hex');
}

function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

module.exports = { USER_AGENT, MIRROR_HOST, toMirror, fetchJson, downloadFile, downloadBuffer, fileSha1, sha1, sleep };
