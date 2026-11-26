'use strict';

/* Modrinth 中文支持：
 * 1. 中文关键词 → 英文检索词（Modrinth 只索引英文内容）
 * 2. 常见资源的中文名称与中文简介
 * 3. 分类、加载器、版本类型的中文名称
 */
(function () {
  /** 常见资源中文名与简介，键为规范化后的 slug / 标题（仅保留小写字母和数字） */
  const KNOWN = {
    sodium: { zh: '钠', desc: '专注于渲染优化的性能 Mod，大幅提升帧率、减少卡顿，兼容大多数整合包。' },
    lithium: { zh: '锂', desc: '优化游戏逻辑与实体运算，在不改变玩法的前提下提升性能。' },
    phosphor: { zh: '磷', desc: '优化光照计算，减少区块加载时的卡顿。' },
    indium: { zh: '铟', desc: '钠的附加组件，为部分 Mod 提供 Fabric 渲染 API 兼容支持。' },
    iris: { zh: '虹膜', desc: 'Fabric 平台的光影加载器，支持大多数 OptiFine 光影包。' },
    optifine: { zh: '高清修复', desc: '经典的综合优化与光影支持 Mod，提供丰富的画面设置。' },
    create: { zh: '机械动力', desc: '以旋转动力与机械结构为核心的科技 Mod，可搭建复杂的自动化装置。' },
    farmersdelight: { zh: '农夫乐事', desc: '扩展农业与烹饪系统，新增大量食材、料理与厨具。' },
    jei: { zh: '物品管理器（JEI）', desc: '查看物品用途与合成配方，整合包必备的配方查询工具。' },
    justenoughitems: { zh: '物品管理器（JEI）', desc: '查看物品用途与合成配方，整合包必备的配方查询工具。' },
    rei: { zh: 'REI 配方查看器', desc: '配方查询与物品管理，JEI 的现代替代品。' },
    roughlyenoughitems: { zh: 'REI 配方查看器', desc: '配方查询与物品管理，JEI 的现代替代品。' },
    emi: { zh: 'EMI 配方查看器', desc: '轻量快速的配方查看器，界面简洁。' },
    appleskin: { zh: '苹果皮', desc: '显示饥饿值与饱和度等详细状态信息。' },
    jade: { zh: '玉（方块信息）', desc: '准星指向方块或实体时显示详细信息。' },
    wthit: { zh: 'WTHIT 方块信息', desc: '准星指向方块时显示其详细信息。' },
    mousetweaks: { zh: '鼠标微调', desc: '改进背包内用鼠标拖动整理物品的操作。' },
    controlling: { zh: '按键管理', desc: '搜索与定位按键绑定，快速解决按键冲突。' },
    toastcontrol: { zh: '弹窗控制', desc: '控制游戏内提示弹窗（成就、配方解锁等）。' },
    architectury: { zh: 'Architectury 前置库', desc: '跨加载器开发的 API 库，许多 Mod 的前置依赖。' },
    fabricapi: { zh: 'Fabric API', desc: 'Fabric 模组生态的基础 API 前置库，绝大多数 Fabric Mod 依赖它。' },
    entityculling: { zh: '实体剔除', desc: '跳过视线外实体的渲染，提升帧率。' },
    ferritecore: { zh: '铁氧体核心', desc: '优化内存占用，减少游戏运行时的内存消耗。' },
    modmenu: { zh: '模组菜单', desc: '在游戏内查看与配置已安装的模组。' },
    immediatelyfast: { zh: '即时渲染优化', desc: '优化即时渲染模式，显著提升界面与实体渲染性能。' },
    yetanotherconfiglib: { zh: 'YACL 配置库', desc: '现代化的配置界面库，许多 Mod 的前置依赖。' },
    yacl: { zh: 'YACL 配置库', desc: '现代化的配置界面库，许多 Mod 的前置依赖。' },
    fabriclanguagekotlin: { zh: 'Fabric Kotlin 语言库', desc: '为 Fabric Mod 提供 Kotlin 语言支持的库。' },
    entitytexturefeatures: { zh: '实体纹理特性（ETF）', desc: '支持实体随机纹理与表情等材质特性。' },
    sodiumextra: { zh: '钠扩展', desc: '为钠补充额外的画面与性能设置选项。' },
    continuity: { zh: '连续材质', desc: '支持连接纹理，让方块贴图自然衔接。' },
    lambdynamiclights: { zh: '动态光源', desc: '手持或放置光源时实时照亮周围环境。' },
    lambdynlights: { zh: '动态光源', desc: '手持或放置光源时实时照亮周围环境。' },
    betterf3: { zh: 'BetterF3 调试屏', desc: '更美观、可自定义的 F3 调试信息界面。' },
    memoryleakfix: { zh: '内存泄漏修复', desc: '修复原版与部分 Mod 的内存泄漏问题。' },
    modernfix: { zh: '现代修复', desc: '综合优化启动速度与内存占用。' },
    embeddium: { zh: 'Embeddium 渲染优化', desc: 'Forge / NeoForge 平台上的渲染优化模组。' },
    rubidium: { zh: '铷', desc: 'Forge 平台的渲染优化模组（钠的移植版）。' },
    oculus: { zh: 'Oculus 光影', desc: 'Forge 平台的光影加载器。' },
    clothconfig: { zh: '布匹配置', desc: '许多 Mod 依赖的配置界面库。' },
    geckolib: { zh: 'GeckoLib 动画库', desc: '为 Mod 提供 3D 动画支持的前置库。' },
    curios: { zh: '饰品栏', desc: '新增饰品装备栏位，支持众多饰品类 Mod。' },
    patchouli: { zh: '帕秋莉手册', desc: '游戏内手册与指南书系统，整合包文档的常用库。' },
    kubejs: { zh: 'KubeJS', desc: '用脚本自定义整合包内容与配方。' },
    crafttweaker: { zh: 'CraftTweaker', desc: '通过脚本修改配方与游戏内容的工具。' },
    ftbquests: { zh: 'FTB 任务', desc: '整合包任务系统，提供任务线与奖励。' },
    ftbteams: { zh: 'FTB 队伍', desc: 'FTB 任务与队伍协作的配套库。' },
    lootr: { zh: '战利品独立', desc: '让箱子里的战利品对每位玩家独立生成。' },
    comforts: { zh: '舒适睡眠', desc: '新增睡袋等便携睡眠道具。' },
    travelersbackpack: { zh: '旅行者背包', desc: '可升级的背包，随身携带更多物品。' },
    sophisticatedbackpacks: { zh: '精致背包', desc: '功能丰富的可升级背包系统。' },
    ironchest: { zh: '铁箱子', desc: '提供更多容量与材质的箱子。' },
    constructionwand: { zh: '建筑法杖', desc: '快速批量建造与拆除方块的建筑法杖。' },
    buildinggadgets: { zh: '建筑小工具', desc: '快速复制与搭建结构的建筑辅助工具。' },
    handcrafted: { zh: '手工家具', desc: '精致的家具与装饰物件。' },
    chipped: { zh: '凿子', desc: '海量方块变体，丰富建筑装饰选择。' },
    xaerosminimap: { zh: 'Xaero 小地图', desc: '功能强大的小地图 Mod，显示地形、实体与路径点。' },
    xaerosworldmap: { zh: 'Xaero 世界地图', desc: '可缩放的全屏世界地图，标记探索区域。' },
    journeymap: { zh: '旅行地图', desc: '经典小地图与世界地图，支持路径点与共享。' },

    twilightforest: { zh: '暮色森林', desc: '经典的冒险维度 Mod，探索充满谜题与 BOSS 的暮色森林。' },
    aether: { zh: '天境', desc: '天空维度冒险 Mod，在云端岛屿上探索、战斗与建造。' },
    divinerpg: { zh: '虚无世界', desc: '新增大量维度、生物与装备的大型冒险 Mod。' },
    botania: { zh: '植物魔法', desc: '以花朵与魔力为核心的魔法科技 Mod，用植物实现自动化。' },
    bloodmagic: { zh: '血魔法', desc: '以生命与祭坛为核心的魔法 Mod，可搭建自动化仪式。' },
    astralsorcery: { zh: '星辉魔法', desc: '以星象与星座为力量来源的魔法 Mod。' },
    thaumcraft: { zh: '神秘时代', desc: '经典魔法 Mod，研究要素、炼金与傀儡。' },
    arsnouveau: { zh: '新生魔艺', desc: '以法术书写与魔灵为核心的魔法 Mod。' },
    apotheosis: { zh: '神化', desc: '强化附魔、刷怪与物品词条系统。' },
    projecte: { zh: '等价交换', desc: '通过 EMC 值转换物品，实现资源等价交换。' },
    avaritia: { zh: '无尽贪婪', desc: '新增高阶材料与强力装备，适合后期整合包。' },

    mekanism: { zh: '通用机械', desc: '大型科技 Mod，包含矿石处理、能源、机器与传送系统。' },
    immersiveengineering: { zh: '沉浸工程', desc: '写实风格的科技 Mod，提供多方块机器、电力与运输系统。' },
    industrialcraft: { zh: '工业时代', desc: '经典工业科技 Mod，以电力、机器与自动化生产为核心。' },
    appliedenergistics2: { zh: '应用能源 2', desc: '强大的存储与自动化网络，用 ME 系统管理海量物品。' },
    refinedstorage: { zh: '精致存储', desc: '简洁易用的数字存储网络，功能类似应用能源 2。' },
    storagedrawers: { zh: '抽屉', desc: '高效整理大量同类物品的抽屉存储 Mod。' },
    thermalexpansion: { zh: '热力膨胀', desc: '经典的机器与能源科技 Mod，机器升级体系完善。' },
    tinkersconstruct: { zh: '匠魂', desc: '自定义工具与武器锻造系统，自由组合材料打造装备。' },
    forestry: { zh: '林业', desc: '养蜂、树木培育与自动农场的经典 Mod。' },
    enderio: { zh: '末影接口', desc: '导管传输物品、流体与能量的科技 Mod。' },
    gregtech: { zh: '格雷科技', desc: '硬核科技 Mod，拥有极其复杂的加工链与机器。' },
    nuclearcraft: { zh: '核电工艺', desc: '核能发电与相关机器设备的科技 Mod。' },
    draconicevolution: { zh: '龙之进化', desc: '高阶能量与装备系统，后期科技向 Mod。' },
    railcraft: { zh: '铁路', desc: '扩展铁路运输与矿车系统的经典 Mod。' },

    mysticalagriculture: { zh: '神秘农业', desc: '种植各类资源种子，稳定产出矿物与材料。' },
    pamsharvestcraft: { zh: '潘马斯农场', desc: '新增大量农作物、食材与料理。' },
    sereneseasons: { zh: '宁静季节', desc: '加入四季变化，影响作物生长与天气。' },
    spiceoflife: { zh: '生活调味料', desc: '让重复食用同种食物效果递减，鼓励饮食多样。' },
    cookingforblockheads: { zh: '方块烹饪', desc: '提供厨房多方块结构与烹饪辅助。' },

    betternether: { zh: '更好的下界', desc: '重制下界维度，新增生物群系、结构与材料。' },
    betterend: { zh: '更好的末地', desc: '重制末地维度，新增生物群系、结构与装备。' },
    whendungeonsarise: { zh: '地牢浮现之时', desc: '在世界中生成大型精美的冒险地牢与结构。' },
    biomesoplenty: { zh: '超多生物群系', desc: '新增大量生物群系、树木与方块。' },
    ohthebiomesyoullgo: { zh: '你将去的生物群系', desc: '新增丰富的生物群系与自然景观。' },
    terralith: { zh: 'Terralith 地形', desc: '用原版方块重塑地形，生成壮观的自然景观。' },
    distanthorizons: { zh: '遥远的地平线', desc: '突破视距限制，渲染远处地形，画面更开阔。' },
    alexsmobs: { zh: 'Alex 的生物', desc: '新增大量设计精良的动物与怪物，生态更丰富。' },
    alexscaves: { zh: 'Alex 的洞穴', desc: '新增多个洞穴生物群系与独特的怪物。' },
    iceandfire: { zh: '冰与火之歌', desc: '加入巨龙、神话生物与对应装备的冒险 Mod。' },
    epicfight: { zh: '史诗战斗', desc: '重制战斗动作与动画，带来动作游戏般的战斗体验。' },
    cobblemon: { zh: '方块宝可梦', desc: '在 Minecraft 中捕捉、培养与对战宝可梦。' },
    quark: { zh: '夸克', desc: '大量实用小功能与方块优化，贴近原版体验。' },
    supplementaries: { zh: '附属品', desc: '丰富原版风格的装饰方块与实用小道具。' },
    minecolonies: { zh: '我的殖民地', desc: '招募村民建造并管理属于你的殖民地。' },
    waystones: { zh: '传送石碑', desc: '放置传送石碑，实现远距离快速传送。' },
    mobgrindingutils: { zh: '刷怪塔实用设备', desc: '提供刷怪与经验收集的实用机器。' },
    torchmaster: { zh: '火把大师', desc: '限制火把周围的刷怪，方便控制怪物生成。' },

    complementaryshaders: { zh: '互补光影', desc: '广受欢迎的写实光影，画质与性能平衡出色。' },
    complementaryreimagined: { zh: '互补光影（重构版）', desc: '互补光影的重构版本，画面更精致。' },
    bslshaders: { zh: 'BSL 光影', desc: '经典写实光影，画面柔和、色调自然。' },
    sildursvibrantshaders: { zh: 'Sildur 鲜艳光影', desc: '色彩鲜艳、风格明快的热门光影。' },
    seus: { zh: 'SEUS 光影', desc: '经典写实光影系列，画面真实细腻。' },
    chocapic13: { zh: '巧克力光影', desc: '老牌光影，风格清新、配置友好。' },
    makeupultrafastshaders: { zh: '极速光影', desc: '主打低配可用的轻量光影。' },
    photonshader: { zh: 'Photon 光影', desc: '高质量写实光影，细节丰富。' },
    blisshaders: { zh: 'Bliss 光影', desc: '柔和唯美的写实光影。' },
    rethinkingvoxels: { zh: '重构体素', desc: '体积光照与云层表现突出的光影。' },

    faithful: { zh: '忠实材质包', desc: '在保留原版风格的前提下提升材质分辨率。' },
    patrix: { zh: '帕特里克斯材质包', desc: '高清写实材质包，细节丰富。' },
    staytrue: { zh: '保持真实材质包', desc: '贴近原版的高清材质包，风格自然。' },
  };

  /** 中文关键词 → 英文检索词（按长度倒序匹配，长的优先） */
  const RAW_TERMS = [
    // 常用名词
    ['性能优化', 'optimization performance'],
    ['优化', 'optimization performance'],
    ['帧数', 'fps performance'],
    ['帧率', 'fps performance'],
    ['光影', 'shaders'],
    ['着色器', 'shaders'],
    ['材质包', 'resource pack'],
    ['资源包', 'resource pack'],
    ['数据包', 'datapack'],
    ['整合包', 'modpack'],
    ['小地图', 'minimap'],
    ['世界地图', 'world map'],
    ['物品管理器', 'recipe viewer'],
    ['配方', 'recipe'],
    ['合成', 'crafting'],
    ['背包', 'backpack inventory'],
    ['储存', 'storage'],
    ['存储', 'storage'],
    ['能源', 'energy'],
    ['电力', 'energy'],
    ['机械', 'machinery technology'],
    ['科技', 'technology'],
    ['魔法', 'magic'],
    ['冒险', 'adventure'],
    ['探索', 'exploration'],
    ['建筑', 'building'],
    ['装饰', 'decoration'],
    ['家具', 'furniture'],
    ['食物', 'food'],
    ['料理', 'cooking'],
    ['烹饪', 'cooking'],
    ['农业', 'farming agriculture'],
    ['农场', 'farming'],
    ['生物群系', 'biomes'],
    ['生物', 'mobs'],
    ['怪物', 'mobs'],
    ['地形', 'worldgen terrain'],
    ['维度', 'dimension'],
    ['下界', 'nether'],
    ['末地', 'end'],
    ['主世界', 'overworld'],
    ['村庄', 'village'],
    ['地牢', 'dungeon'],
    ['遗迹', 'structures'],
    ['结构', 'structures'],
    ['武器', 'weapons'],
    ['盔甲', 'armor'],
    ['装备', 'equipment'],
    ['工具', 'tools'],
    ['附魔', 'enchantment'],
    ['药水', 'potion'],
    ['村民', 'villager'],
    ['任务', 'quests'],
    ['经济', 'economy'],
    ['社交', 'social'],
    ['服务器', 'server'],
    ['客户端', 'client'],
    ['内存', 'memory'],
    ['修复', 'fix patch'],
    ['补丁', 'patch'],
    ['前置', 'library api'],
    ['库', 'library'],
    ['配置', 'config'],
    ['汉化', 'translation chinese'],
    ['中文', 'translation chinese'],
    ['动态光源', 'dynamic lights'],
    ['光影加载器', 'shader loader'],
    ['光影包', 'shaders'],
    ['家具装饰', 'furniture decoration'],

    // 常见资源中文名
    ['钠', 'sodium'],
    ['锂', 'lithium'],
    ['磷', 'phosphor'],
    ['铟', 'indium'],
    ['虹膜', 'iris'],
    ['高清修复', 'optifine'],
    ['机械动力', 'create'],
    ['农夫乐事', 'farmers delight'],
    ['物品管理器', 'just enough items'],
    ['旅行地图', 'journeymap'],
    ['暮色森林', 'twilight forest'],
    ['天境', 'aether'],
    ['虚无世界', 'divine rpg'],
    ['植物魔法', 'botania'],
    ['血魔法', 'blood magic'],
    ['星辉魔法', 'astral sorcery'],
    ['神秘时代', 'thaumcraft'],
    ['新生魔艺', 'ars nouveau'],
    ['神化', 'apotheosis'],
    ['等价交换', 'projecte'],
    ['无尽贪婪', 'avaritia'],
    ['热力膨胀', 'thermal expansion'],
    ['通用机械', 'mekanism'],
    ['沉浸工程', 'immersive engineering'],
    ['工业时代', 'industrial craft'],
    ['应用能源', 'applied energistics'],
    ['精致存储', 'refined storage'],
    ['抽屉', 'storage drawers'],
    ['匠魂', 'tinkers construct'],
    ['林业', 'forestry'],
    ['末影接口', 'ender io'],
    ['格雷科技', 'gregtech'],
    ['核电工艺', 'nuclearcraft'],
    ['龙之进化', 'draconic evolution'],
    ['神秘农业', 'mystical agriculture'],
    ['潘马斯', 'pam harvestcraft'],
    ['宁静季节', 'serene seasons'],
    ['生活调味料', 'spice of life'],
    ['更好的下界', 'better nether'],
    ['更好的末地', 'better end'],
    ['地牢浮现', 'when dungeons arise'],
    ['超多生物群系', 'biomes o plenty'],
    ['你将去的生物群系', 'oh the biomes youll go'],
    ['遥远的地平线', 'distant horizons'],
    ['冰与火', 'ice and fire'],
    ['史诗战斗', 'epic fight'],
    ['宝可梦', 'cobblemon'],
    ['夸克', 'quark'],
    ['凿子', 'chipped'],
    ['附属品', 'supplementaries'],
    ['亚历克斯的生物', 'alexs mobs'],
    ['我的殖民地', 'minecolonies'],
    ['传送石碑', 'waystones'],
    ['火把大师', 'torchmaster'],
    ['布匹配置', 'cloth config'],
    ['饰品栏', 'curios'],
    ['帕秋莉', 'patchouli'],
    ['互补光影', 'complementary shaders'],
    ['巧克力光影', 'chocapic'],
    ['极速光影', 'makeup ultra fast shaders'],
    ['怀旧光影', 'nostalgia shaders'],
    ['忠实材质包', 'faithful'],
    ['保持真实', 'stay true'],
  ];

  const TERMS = RAW_TERMS.map(([zh, en]) => [zh, en]).sort((a, b) => b[0].length - a[0].length);

  const CATEGORY_ZH = {
    adventure: '冒险', decoration: '装饰', economy: '经济', equipment: '装备',
    food: '食物', 'game-mechanics': '游戏机制', library: '前置库', magic: '魔法',
    optimization: '优化', social: '社交', storage: '存储', technology: '科技',
    transportation: '交通', utility: '实用工具', worldgen: '世界生成',
    cursed: '怪诞', minigame: '小游戏', mobs: '生物',
    audio: '音效', blocks: '方块', entities: '实体', environment: '环境', fonts: '字体',
    gui: '界面', items: '物品', locale: '语言', models: '模型', textures: '材质',
    atmosphere: '氛围', bloom: '泛光', cartoon: '卡通', 'colored-lighting': '彩色光照',
    fancy: '华丽', foliage: '植被', lighting: '光照', 'path-tracing': '路径追踪',
    pbr: 'PBR 材质', reflections: '反射', shadows: '阴影', 'vanilla-like': '原版风格',
    'semi-realistic': '半写实', realistic: '写实',
  };

  const LOADER_ZH = {
    fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt',
    liteloader: 'LiteLoader', rift: 'Rift', modloader: 'ModLoader',
    bukkit: 'Bukkit', spigot: 'Spigot', paper: 'Paper', purpur: 'Purpur',
    folia: 'Folia', bungeecord: 'BungeeCord', velocity: 'Velocity', waterfall: 'Waterfall',
    datapack: '数据包', minecraft: '原版',
  };

  const VERSION_TYPE_ZH = { release: '正式版', beta: '测试版', alpha: '内测版' };

  function normalize(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /** 查找常见资源的中文名称与简介 */
  function knownFor(slug, title) {
    const bySlug = normalize(slug);
    const byTitle = normalize(title);
    if (bySlug && KNOWN[bySlug]) return KNOWN[bySlug];
    if (byTitle && KNOWN[byTitle]) return KNOWN[byTitle];
    let bestKey = '';
    for (const key of Object.keys(KNOWN)) {
      if (key.length >= 5 && bySlug.includes(key) && key.length > bestKey.length) bestKey = key;
    }
    return bestKey ? KNOWN[bestKey] : null;
  }

  /**
   * 把中文检索词转换为 Modrinth 可用的英文检索词
   * @returns {{query: string, changed: boolean, unmatched: boolean}}
   */
  function translateQuery(input) {
    const text = String(input || '').trim();
    if (!text || !/[\u4e00-\u9fff]/.test(text)) return { query: text, changed: false, unmatched: false };
    let out = '';
    let index = 0;
    let matched = false;
    while (index < text.length) {
      const hit = TERMS.find(([zh]) => text.startsWith(zh, index));
      if (hit) {
        out += ` ${hit[1]} `;
        index += hit[0].length;
        matched = true;
        continue;
      }
      const ch = text[index];
      if (/[a-zA-Z0-9.\-]/.test(ch) || /\s/.test(ch)) out += ch;
      index += 1;
    }
    const cleaned = out.replace(/\s+/g, ' ').trim();
    if (!cleaned) return { query: text, changed: false, unmatched: true };
    return { query: cleaned, changed: cleaned.toLowerCase() !== text.toLowerCase(), unmatched: false };
  }

  function categoryName(value) {
    return CATEGORY_ZH[value] || value;
  }

  function loaderName(value) {
    return LOADER_ZH[value] || value;
  }

  function versionTypeName(value) {
    return VERSION_TYPE_ZH[value] || value;
  }

  window.TraeCraftZh = { knownFor, translateQuery, categoryName, loaderName, versionTypeName };
})();
