'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { spawn } = require('node:child_process');
const paths = require('../core/paths');
const { downloadFile, fetchJson } = require('../core/http');
const meta = require('../mc/meta');
const installer = require('../mc/installer');
const java = require('../mc/java');

const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'xueCraftLauncher/1.0.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} - ${url}`);
  return res.text();
}

function parseMavenVersions(xml) {
  return Array.from(xml.matchAll(/<version>([^<]+)<\/version>/g)).map((m) => m[1].trim());
}

/** 从 NeoForge 版本号推导对应的 Minecraft 版本 */
function neoForgeToMinecraft(version) {
  const [a, b] = version.split('.');
  if (!a || !b) return '';
  return b === '0' ? `1.${a}` : `1.${a}.${b}`;
}

async function listForgeVersions(mcVersion) {
  const xml = await fetchText(`${FORGE_MAVEN}/maven-metadata.xml`);
  const versions = parseMavenVersions(xml)
    .filter((v) => v.startsWith(`${mcVersion}-`))
    .map((v) => ({ artifact: v, loader: v.slice(mcVersion.length + 1) }));
  let recommended = '';
  try {
    const promos = await fetchJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json', {
      useMirror: false,
    });
    const promo = promos.promos?.[`${mcVersion}-recommended`] || promos.promos?.[`${mcVersion}-latest`];
    if (promo) recommended = promo;
  } catch {
    // 推荐版本获取失败时忽略
  }
  // 版本倒序（新的在前）
  versions.sort((a, b) => b.loader.localeCompare(a.loader, undefined, { numeric: true }));
  return { versions, recommended };
}

async function listNeoForgeVersions(mcVersion) {
  const xml = await fetchText(`${NEOFORGE_MAVEN}/maven-metadata.xml`);
  const all = parseMavenVersions(xml);
  const filtered = mcVersion
    ? all.filter((v) => neoForgeToMinecraft(v) === mcVersion)
    : all;
  filtered.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return { versions: filtered.map((v) => ({ artifact: v, loader: v })), recommended: filtered[0] || '' };
}

function runInstallerJar(javaPath, jarPath, targetDir, { report } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(javaPath, ['-jar', jarPath, '--installClient', targetDir], {
      cwd: targetDir,
      windowsHide: true,
    });
    let tail = '';
    const handle = (chunk) => {
      const text = chunk.toString('utf8');
      tail = (tail + text).slice(-4000);
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed && report) report({ phase: 'installer', message: trimmed, log: true });
      }
    };
    child.stdout.on('data', handle);
    child.stderr.on('data', handle);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('安装器运行超时'));
    }, 20 * 60 * 1000);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`安装器退出码 ${code}\n${tail.slice(-1200)}`));
    });
  });
}

async function ensureLauncherProfiles() {
  const file = path.join(paths.root(), 'launcher_profiles.json');
  if (!fs.existsSync(file)) {
    await fsp.writeFile(
      file,
      JSON.stringify({ profiles: {}, settings: {}, version: 3 }, null, 2),
      'utf8'
    );
  }
}

async function ensureVanilla(mcVersion, report) {
  const existing = await meta.readLocalVersionJson(mcVersion);
  if (existing) return;
  if (report) report({ phase: 'loader', message: `正在安装原版 ${mcVersion}` });
  await installer.installVersion(mcVersion, { report });
}

/** 安装 Forge / NeoForge（调用官方安装器） */
async function installForgeLike({
  mcVersion,
  artifactVersion,
  distributor,
  report,
}) {
  const isNeo = distributor === 'neoforge';
  const baseUrl = isNeo ? NEOFORGE_MAVEN : FORGE_MAVEN;
  const fileName = isNeo ? `neoforge-${artifactVersion}-installer.jar` : `forge-${artifactVersion}-installer.jar`;
  const url = `${baseUrl}/${artifactVersion}/${fileName}`;

  if (report) report({ phase: 'loader', message: `正在准备 ${isNeo ? 'NeoForge' : 'Forge'} ${artifactVersion}` });
  await ensureVanilla(mcVersion, report);

  const versionJson = await meta.ensureVersionJson(mcVersion);
  const javaMajor = (versionJson.javaVersion && versionJson.javaVersion.majorVersion) || 8;
  const javaInfo = await java.ensureJava(javaMajor, {
    onProgress: (p) => report && report({ ...p, phase: 'java' }),
  });

  const cacheDir = paths.ensureDirSync(path.join(paths.root(), 'cache', 'installers'));
  const jarPath = path.join(cacheDir, fileName);
  if (report) report({ phase: 'loader', message: `正在下载安装器 ${fileName}` });
  await downloadFile(url, jarPath, {
    useMirror: false,
    onProgress: (p) => report && report({ ...p, message: '正在下载安装器' }),
  });

  await ensureLauncherProfiles();
  if (report) report({ phase: 'loader', message: '正在运行官方安装器（可能需要几分钟）' });
  await runInstallerJar(javaInfo.path, jarPath, paths.root(), { report });

  const expectedId = isNeo ? `neoforge-${artifactVersion}` : `${mcVersion}-forge-${artifactVersion.replace(`${mcVersion}-`, '')}`;
  const versionDir = path.join(paths.dirs.versions(), expectedId);
  if (!fs.existsSync(path.join(versionDir, `${expectedId}.json`))) {
    throw new Error(`安装器执行完成，但未找到版本 ${expectedId}`);
  }

  if (report) report({ phase: 'loader', message: '正在校验加载器依赖库' });
  const result = await installer.installVersion(expectedId, { report });
  return {
    id: expectedId,
    loader: distributor,
    gameVersion: mcVersion,
    loaderVersion: artifactVersion,
    result,
  };
}

async function installForge(mcVersion, artifactVersion, options = {}) {
  return installForgeLike({ mcVersion, artifactVersion, distributor: 'forge', ...options });
}

async function installNeoForge(mcVersion, version, options = {}) {
  return installForgeLike({ mcVersion, artifactVersion: version, distributor: 'neoforge', ...options });
}

module.exports = {
  listForgeVersions,
  listNeoForgeVersions,
  installForge,
  installNeoForge,
  neoForgeToMinecraft,
};
