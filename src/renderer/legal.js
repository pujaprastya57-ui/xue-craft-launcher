'use strict';

/* 法律文档与首次启动同意流程：服务条款 / 隐私政策 / 个人信息清单 / 三方信息共享清单 */
(function () {
  const LEGAL_VERSION = '2026-11-26';

  const DOCUMENTS = [
    {
      id: 'tos',
      title: '服务条款',
      body: `
        <h4>一、协议范围</h4>
        <p>本条款由 xue Craft launcher（以下简称「本启动器」）提供。您下载、安装或使用本启动器，即表示已阅读并同意本条款及配套的《隐私政策》《个人信息清单》《三方信息共享清单》。若您不同意，请停止使用并删除本软件。</p>
        <h4>二、软件性质</h4>
        <p>本启动器是第三方非官方工具，与 Mojang Studios、Microsoft、Modrinth 均无隶属或合作关系，也未获其背书。Minecraft 及相关名称、商标归 Microsoft / Mojang Studios 所有。</p>
        <h4>三、账号与使用要求</h4>
        <ul>
          <li>您需自行拥有合法的 Minecraft 正版账号，并通过微软官方 OAuth 完成登录。</li>
          <li>不得利用本启动器绕过正版验证、传播盗版游戏、侵犯他人知识产权或从事任何违法违规行为。</li>
          <li>游戏本体文件仅从官方服务器下载到您的本机，本启动器不内置、不分发游戏本体。</li>
        </ul>
        <h4>四、第三方资源</h4>
        <p>Mod、整合包、资源包、光影等资源由 Modrinth 平台的第三方作者提供，其版权归各原作者所有。下载与使用这些资源时，您应自行遵守其许可协议；因第三方资源产生的问题由相应作者负责。</p>
        <h4>五、服务变更与中断</h4>
        <p>本启动器依赖的官方接口、镜像站与第三方平台可能发生变更、限流或停止服务，由此导致的功能不可用不构成违约。我们可能随时更新本软件与本条款。</p>
        <h4>六、免责声明</h4>
        <p>本软件按「现状」提供，不附带任何明示或默示的保证。在适用法律允许的最大范围内，因使用或无法使用本软件导致的任何间接损失（包括但不限于存档丢失、数据损坏），开发者不承担责任。请自行备份重要存档。</p>
        <h4>七、条款终止</h4>
        <p>您可随时停止使用并删除本软件。违反本条款时，我们有权终止向您提供本软件的使用许可。</p>
      `,
    },
    {
      id: 'privacy',
      title: '隐私政策',
      body: `
        <h4>一、我们如何处理信息</h4>
        <p>本启动器不设有开发者服务器，<strong>不收集、不上传、不分析</strong>您的个人信息，也不包含任何统计、广告或行为追踪代码。您的数据均保存在本机。</p>
        <h4>二、本地保存的信息</h4>
        <ul>
          <li>微软账号登录后返回的访问令牌、刷新令牌、玩家 UUID 与玩家名称；</li>
          <li>启动器设置（内存大小、Java 路径、版本隔离、下载源等）；</li>
          <li>已下载的游戏版本、资源文件、运行日志与缓存。</li>
        </ul>
        <p>上述内容仅存储于本机数据目录，卸载或删除该目录即可清除。</p>
        <h4>三、必要的网络请求</h4>
        <p>为实现登录、下载与资源检索，本启动器会与微软、Mojang、Modrinth 等服务方直接通信，此过程由您的设备直接发起，不经过开发者中转。详见《三方信息共享清单》。</p>
        <h4>四、信息安全</h4>
        <p>登录令牌仅以本地文件形式保存，不会主动发送给除微软服务方之外的任何对象。请妥善保管您的设备，避免将数据目录分享给他人。</p>
        <h4>五、您的权利</h4>
        <ul>
          <li>您可以在「账户」页随时退出登录并删除本地账号信息；</li>
          <li>您可以随时删除本机数据目录以清除全部本地数据；</li>
          <li>您可以拒绝同意本政策，但将无法继续使用本启动器。</li>
        </ul>
        <h4>六、未成年人保护</h4>
        <p>未成年人应在监护人指导与同意下使用本软件。</p>
        <h4>七、政策更新</h4>
        <p>本政策更新后会随新版本发布，并在首次启动时重新请求您的同意。</p>
      `,
    },
    {
      id: 'personal',
      title: '个人信息清单',
      body: `
        <p>以下为本启动器涉及的个人信息及其处理方式，全部仅保存在您的本机，开发者不接收。</p>
        <table>
          <thead><tr><th>信息项目</th><th>用途</th><th>存储位置</th><th>保存期限</th></tr></thead>
          <tbody>
            <tr><td>微软账号访问令牌、刷新令牌</td><td>维持登录状态、完成正版验证</td><td>本机数据目录</td><td>退出登录或删除数据目录时清除</td></tr>
            <tr><td>玩家 UUID、玩家名称</td><td>显示当前账号、启动游戏</td><td>本机数据目录</td><td>同上</td></tr>
            <tr><td>皮肤头像缓存</td><td>界面展示账号头像</td><td>本机缓存目录</td><td>清除缓存时删除</td></tr>
            <tr><td>启动器设置（内存、Java 路径、下载源等）</td><td>保存您的个性化配置</td><td>本机配置文件</td><td>修改或删除配置文件时更新</td></tr>
            <tr><td>已下载版本与资源记录</td><td>版本管理、资源安装</td><td>本机数据目录</td><td>手动删除时清除</td></tr>
            <tr><td>游戏运行日志</td><td>排查启动与运行问题</td><td>本机日志目录</td><td>手动删除时清除</td></tr>
          </tbody>
        </table>
        <p class="legal-note">说明：本启动器不收集手机号、身份证号、通讯录、位置等敏感信息，不包含任何远程上报行为。</p>
      `,
    },
    {
      id: 'sharing',
      title: '三方信息共享清单',
      body: `
        <p>为实现核心功能，本启动器会与以下第三方服务直接通信。通信由您的设备直接发起，开发者不参与、不留存。</p>
        <table>
          <thead><tr><th>第三方服务</th><th>使用场景</th><th>涉及信息</th></tr></thead>
          <tbody>
            <tr><td>Microsoft / Xbox Live 认证服务</td><td>微软账号登录与令牌刷新</td><td>账号授权信息、IP 地址、客户端标识</td></tr>
            <tr><td>Mojang / Minecraft 官方服务</td><td>正版档案校验、游戏文件与资源下载</td><td>访问令牌、IP 地址、请求的版本与文件标识</td></tr>
            <tr><td>Modrinth</td><td>资源搜索、详情查询与文件下载</td><td>检索关键词、游戏版本与加载器筛选条件、IP 地址、User-Agent</td></tr>
            <tr><td>Fabric Meta / Forge Maven</td><td>Mod 加载器版本查询与安装包下载</td><td>请求的版本号、IP 地址</td></tr>
            <tr><td>BMCLAPI 等下载镜像</td><td>官方源不可达时的文件下载回退</td><td>请求的文件路径、IP 地址</td></tr>
          </tbody>
        </table>
        <p class="legal-note">除上述为提供功能所必需的通信外，本启动器不向任何第三方共享您的个人信息；账号令牌不会发送给微软认证服务以外的对象。</p>
      `,
    },
  ];

  let mask = null;

  function closeMask() {
    if (mask) {
      mask.remove();
      mask = null;
    }
  }

  function renderDoc(maskEl, id) {
    const doc = DOCUMENTS.find((d) => d.id === id) || DOCUMENTS[0];
    maskEl.querySelector('.legal-body').innerHTML = `<h3>${doc.title}</h3>${doc.body}`;
    const body = maskEl.querySelector('.legal-body');
    body.scrollTop = 0;
    requestAnimationFrame(() => {
      body.scrollTop = 0;
    });
    maskEl.querySelectorAll('.legal-tabs button').forEach((b) => {
      b.classList.toggle('active', b.dataset.doc === doc.id);
    });
  }

  /** 构建协议弹层；consent=true 时为首次启动的强制同意模式 */
  function show({ consent = false, docId = 'tos', onAccept, onDecline } = {}) {
    closeMask();
    mask = document.createElement('div');
    mask.className = 'legal-mask';
    mask.innerHTML = `
      <div class="legal-card">
        <div class="legal-head">
          <img src="icon.png" alt="" class="legal-logo" />
          <div>
            <h2>${consent ? '使用协议与隐私政策' : '法律与隐私'}</h2>
            <p>xue Craft launcher · 更新日期 ${LEGAL_VERSION}</p>
          </div>
        </div>
        ${consent ? '<p class="legal-intro">欢迎使用。请仔细阅读以下协议，<strong>只有同意全部协议后才能继续使用本启动器</strong>；如不同意，请退出。</p>' : ''}
        <div class="legal-tabs">
          ${DOCUMENTS.map((d) => `<button type="button" data-doc="${d.id}">${d.title}</button>`).join('')}
        </div>
        <div class="legal-body"></div>
        ${
          consent
            ? `<label class="legal-agree"><input type="checkbox" id="legalAgree" /> <span>我已阅读并同意《服务条款》《隐私政策》《个人信息清单》《三方信息共享清单》</span></label>
               <div class="legal-actions">
                 <button type="button" class="ghost-btn danger" id="legalDecline">不同意并退出</button>
                 <button type="button" class="primary-btn" id="legalAccept" disabled>同意并继续</button>
               </div>`
            : `<div class="legal-actions"><button type="button" class="primary-btn" id="legalClose">关闭</button></div>`
        }
      </div>`;
    document.body.appendChild(mask);

    mask.querySelectorAll('.legal-tabs button').forEach((btn) => {
      btn.addEventListener('click', () => renderDoc(mask, btn.dataset.doc));
    });
    renderDoc(mask, docId);

    if (consent) {
      const agree = mask.querySelector('#legalAgree');
      const acceptBtn = mask.querySelector('#legalAccept');
      agree.addEventListener('change', () => {
        acceptBtn.disabled = !agree.checked;
      });
      acceptBtn.addEventListener('click', async () => {
        acceptBtn.disabled = true;
        acceptBtn.textContent = '正在保存…';
        try {
          await window.traecraft.config.save({
            legalAccepted: LEGAL_VERSION,
            legalAcceptedAt: new Date().toISOString(),
          });
          closeMask();
          onAccept?.();
        } catch (err) {
          acceptBtn.disabled = false;
          acceptBtn.textContent = '同意并继续';
        }
      });
      mask.querySelector('#legalDecline').addEventListener('click', () => {
        closeMask();
        onDecline?.();
      });
    } else {
      mask.querySelector('#legalClose').addEventListener('click', closeMask);
    }
  }

  /** 首次启动检查：未同意则弹出强制同意层，返回是否同意 */
  async function ensureAccepted() {
    let accepted = false;
    try {
      const config = await window.traecraft.config.get();
      accepted = config && config.legalAccepted === LEGAL_VERSION;
    } catch {
      accepted = false;
    }
    if (accepted) return true;
    return new Promise((resolve) => {
      show({
        consent: true,
        onAccept: () => resolve(true),
        onDecline: () => resolve(false),
      });
    });
  }

  window.TraeCraftLegal = {
    ensureAccepted,
    open: (docId) => show({ consent: false, docId }),
    isConsentVisible: () => Boolean(document.querySelector('.legal-mask')),
  };
})();
