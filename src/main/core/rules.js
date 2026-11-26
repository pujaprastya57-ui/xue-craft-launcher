'use strict';

const os = require('node:os');

/** 当前系统信息，映射为 Mojang 规则使用的命名 */
function currentOs() {
  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
  let arch = 'x86';
  if (process.arch === 'x64') arch = 'x86_64';
  else if (process.arch === 'arm64') arch = 'arm64';
  else if (process.arch === 'ia32') arch = 'x86';
  return {
    name: platform,
    arch,
    version: os.release(),
    // Mojang 原生库分类器中的位数标识
    bits: process.arch === 'ia32' ? '32' : '64',
  };
}

function matchOs(ruleOs, sys) {
  if (!ruleOs) return true;
  if (ruleOs.name && ruleOs.name !== sys.name) return false;
  if (ruleOs.arch && ruleOs.arch !== sys.arch) return false;
  if (ruleOs.version) {
    try {
      if (!new RegExp(ruleOs.version).test(sys.version)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function matchFeatures(ruleFeatures, features) {
  if (!ruleFeatures) return true;
  return Object.entries(ruleFeatures).every(([key, value]) => Boolean(features[key]) === Boolean(value));
}

/**
 * 计算规则是否允许。规则按顺序生效，最后一条匹配的规则决定结果；无匹配时默认禁止。
 */
function evaluateRules(rules, features = {}, sys = currentOs()) {
  if (!Array.isArray(rules) || rules.length === 0) return true;
  let allowed = false;
  for (const rule of rules) {
    if (!matchOs(rule.os, sys)) continue;
    if (!matchFeatures(rule.features, features)) continue;
    allowed = rule.action === 'allow';
  }
  return allowed;
}

/** maven 坐标转仓库路径：group:artifact:version[:classifier][@ext] */
function mavenToPath(name) {
  const [coords, extPart] = String(name).split('@');
  const parts = coords.split(':');
  const [group, artifact, version, classifier] = parts;
  const ext = extPart || 'jar';
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${ext}`;
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${file}`;
}

/** 解析依赖库的 artifact 下载信息（兼容仅有 maven 坐标 + url 的旧/第三方库） */
function libraryArtifact(lib) {
  if (lib.downloads && lib.downloads.artifact) {
    const a = lib.downloads.artifact;
    return {
      path: a.path || mavenToPath(lib.name),
      url: a.url,
      sha1: a.sha1,
      size: a.size,
    };
  }
  if (lib.name && lib.url) {
    const rel = mavenToPath(lib.name);
    return { path: rel, url: `${lib.url.replace(/\/$/, '')}/${rel}`, sha1: null, size: 0 };
  }
  return null;
}

/** 解析旧版本 natives 分类器（1.19 之前的 LWJGL2 等） */
function libraryNative(lib, sys = currentOs()) {
  if (!lib.natives || !lib.natives[sys.name]) return null;
  const classifier = lib.natives[sys.name].replace('${arch}', sys.bits);
  const entry = lib.downloads && lib.downloads.classifiers ? lib.downloads.classifiers[classifier] : null;
  if (entry && entry.url) {
    return { path: entry.path, url: entry.url, sha1: entry.sha1, size: entry.size, classifier, lib };
  }
  if (lib.url) {
    const rel = mavenToPath(`${lib.name}:${classifier}`);
    return { path: rel, url: `${lib.url.replace(/\/$/, '')}/${rel}`, sha1: null, size: 0, classifier, lib };
  }
  return null;
}

module.exports = { currentOs, evaluateRules, mavenToPath, libraryArtifact, libraryNative };
