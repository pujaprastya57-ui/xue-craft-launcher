'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const zlib = require('node:zlib');

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function findEocd(buffer) {
  const min = Math.max(0, buffer.length - 0xffff - 22);
  for (let i = buffer.length - 22; i >= min; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  throw new Error('不是有效的 ZIP 文件（未找到目录结尾）');
}

/** 读取 ZIP 中央目录 */
function listZip(buffer) {
  const eocd = findEocd(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) break;
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const rawName = buffer.subarray(offset + 46, offset + 46 + nameLen);
    const name = (flags & 0x800 ? rawName.toString('utf8') : rawName.toString('utf8')).replace(/\\/g, '/');
    entries.push({ name, method, flags, compressedSize, uncompressedSize, localOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntryData(buffer, entry) {
  const offset = entry.localOffset;
  if (buffer.readUInt32LE(offset) !== LOCAL_SIGNATURE) throw new Error(`ZIP 本地头损坏: ${entry.name}`);
  const nameLen = buffer.readUInt16LE(offset + 26);
  const extraLen = buffer.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLen + extraLen;
  const data = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error(`不支持的 ZIP 压缩方式: ${entry.method} (${entry.name})`);
}

/** 安全解析目标路径，阻止 ../ 路径穿越 */
function safeJoin(destDir, entryName) {
  const normalized = path.normalize(entryName).replace(/^([/\\])+/, '');
  const target = path.resolve(destDir, normalized);
  const base = path.resolve(destDir);
  if (target !== base && !target.startsWith(base + path.sep)) throw new Error(`非法的压缩包路径: ${entryName}`);
  return target;
}

/**
 * 解压 ZIP 到目录
 * @param {Buffer} buffer zip 数据
 * @param {string} destDir 目标目录
 * @param {{filter?: (name:string)=>boolean, overwrite?: boolean}} options
 */
async function extractZipBuffer(buffer, destDir, { filter, overwrite = true } = {}) {
  const entries = listZip(buffer);
  let count = 0;
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue;
    if (filter && !filter(entry.name)) continue;
    const target = safeJoin(destDir, entry.name);
    if (!overwrite) {
      try {
        await fsp.access(target);
        continue;
      } catch {
        // 文件不存在，继续写入
      }
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, readEntryData(buffer, entry));
    count++;
  }
  return count;
}

async function extractZipFile(zipPath, destDir, options) {
  const buffer = await fsp.readFile(zipPath);
  return extractZipBuffer(buffer, destDir, options);
}

module.exports = { listZip, readEntryData, extractZipBuffer, extractZipFile };
