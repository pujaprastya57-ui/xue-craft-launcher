'use strict';

/* 核心模块自检（不依赖 Electron）：node scripts/selftest.js */

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const zlib = require('node:zlib');
const assert = require('node:assert');

const paths = require('../src/main/core/paths');
const rules = require('../src/main/core/rules');
const { listZip, readEntryData, extractZipBuffer } = require('../src/main/core/zip');
const meta = require('../src/main/mc/meta');
const modrinthApi = require('../src/main/modrinth/api');
const fabric = require('../src/main/loaders/fabric');

paths.init(path.join(os.tmpdir(), 'xuecraft-selftest'));

function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
  }
  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

/** 构造一个 stored（不压缩）ZIP 用于验证解析器 */
function buildStoredZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const local = Buffer.alloc(30 + nameBuf.length + data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    data.copy(local, 30 + nameBuf.length);
    locals.push(local);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length, 8);
  end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

async function main() {
  const results = [];
  const check = async (name, fn) => {
    const started = Date.now();
    try {
      await fn();
      results.push({ name, ok: true, ms: Date.now() - started });
      console.log(`PASS  ${name} (${Date.now() - started}ms)`);
    } catch (err) {
      results.push({ name, ok: false, error: err.message });
      console.log(`FAIL  ${name}: ${err.message}`);
    }
  };

  await check('配置初始化', async () => {
    const cfg = paths.saveConfig({ memoryMax: 6144 });
    assert.equal(cfg.memoryMax, 6144);
    assert.ok(paths.gameDir('1.20.1').includes('1.20.1'));
  });

  await check('Maven 路径解析', async () => {
    assert.equal(
      rules.mavenToPath('net.fabricmc:fabric-loader:0.16.9'),
      'net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar'
    );
    assert.equal(
      rules.mavenToPath('org.lwjgl:lwjgl:3.3.1:natives-windows'),
      'org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-windows.jar'
    );
  });

  await check('系统规则计算', async () => {
    const sys = rules.currentOs();
    assert.equal(rules.evaluateRules([{ action: 'allow' }]), true);
    assert.equal(rules.evaluateRules([{ action: 'allow', os: { name: 'osx' } }]), false);
    assert.equal(
      rules.evaluateRules([{ action: 'disallow', os: { name: 'osx' } }, { action: 'allow' }]),
      true
    );
    assert.equal(
      rules.evaluateRules([{ action: 'allow', os: { name: 'windows' } }], {}, sys),
      sys.name === 'windows'
    );
  });

  await check('ZIP 解析与解压', async () => {
    const zip = buildStoredZip({ 'mods/demo.txt': 'hello minecraft', 'overrides/config/a.json': '{"a":1}' });
    const entries = listZip(zip);
    assert.equal(entries.length, 2);
    assert.equal(readEntryData(zip, entries[0]).toString(), 'hello minecraft');
    const dir = path.join(paths.root(), 'zip-test');
    await extractZipBuffer(zip, dir);
    assert.equal(fs.readFileSync(path.join(dir, 'mods', 'demo.txt'), 'utf8'), 'hello minecraft');
  });

  let releaseCount = 0;
  await check('Mojang 版本清单', async () => {
    const versions = await meta.listVersions({ type: 'release' });
    releaseCount = versions.length;
    assert.ok(versions.length > 100, `版本数量异常: ${versions.length}`);
    assert.ok(versions.some((v) => v.id === '1.20.1'));
  });

  await check('Fabric 加载器列表', async () => {
    const list = await fabric.listFabricLoaders('1.20.1');
    assert.ok(list.length > 0);
    assert.ok(list[0].version.includes('.'));
  });

  await check('Modrinth 搜索', async () => {
    const data = await modrinthApi.search({ query: 'sodium', type: 'mod', gameVersion: '1.20.1', loader: 'fabric' });
    assert.ok(data.total > 0);
    assert.ok(data.hits[0].title);
  });

  await check('Modrinth 版本与下载信息', async () => {
    const versions = await modrinthApi.getVersions('sodium', { gameVersion: '1.20.1', loader: 'fabric' });
    assert.ok(versions.length > 0);
    const file = modrinthApi.primaryFile(versions[0]);
    assert.ok(file && file.url && file.hashes.sha1);
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n完成：${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
