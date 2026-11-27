# xue Craft launcher

当前最新版本：v1.5.3

基于 Electron 的第三方非官方 Minecraft Windows 启动器，提供微软正版账号登录、游戏版本管理、加载器安装、Modrinth 资源检索与整合包更新等功能。

[下载最新发行版](https://github.com/pujaprastya57-ui/xue-craft-launcher/releases/latest) · [查看 v1.5.3 发布说明](https://github.com/pujaprastya57-ui/xue-craft-launcher/releases/tag/v1.5.3) · [☕ 爱发电支持](https://ifdian.net/a/nxueingnb)

## 功能

- 微软正版账号登录、账号切换与皮肤头像显示
- Minecraft 原版全版本下载、版本隔离与 Java 环境管理
- Fabric、Forge、NeoForge 加载器安装
- Modrinth Mod 与整合包检索，支持中文检索词和常见资源中文名称
- 拖入 `.mrpack` 整合包原地更新，保留存档、日志等用户数据
- 安装与下载任务互斥，避免游戏文件未就绪时重复启动
- 下载期间显示 Windows 任务栏进度
- 导入启动器安装包进行原地覆盖升级
- 绿色化运行：账号、存档、游戏文件与全部缓存都只写入安装目录，不污染 C 盘
- 内置服务条款、隐私政策、个人信息清单和三方信息共享清单

## 下载与使用

### 安装版（推荐）

下载 `xueCraft-Setup-1.5.3.exe`，运行后按照安装向导操作。安装版支持桌面快捷方式、开始菜单快捷方式和自定义安装目录。

**安装目录即数据目录**：你选择的安装文件夹（例如 `D:\Games\xueCraft`）会同时存放程序与全部数据，建议直接选在非 C 盘。

### 便携版

下载 `xueCraft-1.5.3-portable.exe`，无需安装即可运行。数据保存在该 exe 所在文件夹的 `data` 子目录中，适合放在 U 盘或移动硬盘随身携带。

首次启动时需要阅读并同意内置法律与隐私条款。若旧版本的更新器存在异常，可直接运行最新安装版覆盖安装，无需先卸载旧版。

### 从旧版本升级（数据目录迁移）

自 v1.5.3 起，所有用户数据与缓存统一放在安装目录下的 `data` 文件夹中，不再写入 `%APPDATA%`。

首次启动时会自动把旧版本遗留在 `%APPDATA%\xueCraft` 或 `%APPDATA%\TraeCraft` 的数据迁移过来，账号、存档与配置不会丢失。升级前请先关闭正在运行的旧版启动器，避免文件被占用导致迁移失败；若迁移失败，启动器会继续使用旧目录并弹窗提示，数据不受影响，关闭旧版启动器后重启即可完成迁移。

> 注意：如果安装到了 `C:\Program Files` 等需要管理员权限的目录，启动器会提示目录不可写并退出。此时请以管理员身份运行，或重新安装到有写入权限的目录。

## 本地开发

### 环境要求

- Windows 10/11 x64
- Node.js 22 或更高版本
- npm

### 安装与启动

```powershell
npm install
npm start
```

### 检查与构建

```powershell
# 核心模块自检
npm run selftest

# Electron 界面冒烟测试
npm run smoke

# 构建 NSIS 安装版与便携版
npm run dist
```

构建结果默认输出到 `dist/`。`node_modules/`、`dist/`、日志和本地环境文件已通过 `.gitignore` 排除。

## 目录结构

```text
src/main/       主进程、游戏安装、账号登录、下载与更新逻辑
src/preload/    主进程与渲染进程之间的安全桥接
src/renderer/   界面、样式、中文资源词典与法律文本
scripts/        自检与图标处理脚本
build/          安装包图标等构建资源
```

## 用户数据

账号、配置、游戏版本、存档、Java 运行时以及全部缓存都保存在**安装目录**内：

```text
<安装目录>\data            安装版：你安装时选择的文件夹
<exe 所在目录>\data        便携版：与 exe 同级
```

目录结构示例：

```text
D:\Games\xueCraft\
├─ xue Craft launcher.exe   程序本体
├─ locales / *.dll ...      程序运行库
└─ data\                    全部用户数据与缓存
   ├─ accounts.json         账号（safeStorage 加密）
   ├─ config.json           启动器配置
   ├─ versions/             游戏版本与版本隔离的存档
   ├─ libraries/ assets/    游戏依赖与资源
   ├─ runtime/              自动下载的 Java
   ├─ logs/                 日志
   ├─ .cache/               Electron / Chromium 缓存、崩溃转储
   └─ .temp/                临时文件
```

覆盖安装启动器不会主动清除 `data` 目录。账号配置中包含敏感登录信息，请勿公开分享。升级前建议备份重要存档。

旧版本使用的 `%APPDATA%\xueCraft` 或 `%APPDATA%\TraeCraft` 会在首次启动 v1.5.3 时自动迁移到上述目录，迁移成功后旧目录即被清空删除。

## 支持本项目

如果 xue Craft launcher 对你有帮助，欢迎到 [爱发电主页](https://ifdian.net/a/nxueingnb) 请我喝杯咖啡 ☕。你的支持是持续维护、修复问题和加入新功能的动力。

## 声明与许可

- 本项目是第三方非官方启动器，不隶属于 Mojang Studios 或 Microsoft，也未获得其背书。
- Minecraft、Mojang 及相关名称和素材的权利归各自权利人所有。
- 本项目不内置 Minecraft 游戏资源，不提供游戏账号或破解功能。
- Modrinth 资源的名称、简介、图标及文件版权归相应作者所有，使用时请遵守资源页面的许可条款。
- 当前项目标记为 `UNLICENSED`，尚未选择开源许可证。公开仓库不代表授予复制、修改、再分发或商业使用许可。
