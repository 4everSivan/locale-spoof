# 🛡️ Locale & WebRTC Consistency

> **Chrome 扩展 (Manifest V3)**：深度对齐代理节点的时区、语言与物理地理坐标，彻底阻断 WebRTC 真实 IP 泄漏（完美支持 TUN 模式），注入 Canvas 噪点微扰以打破跨站指纹追踪，并支持基于站点的快捷白名单启停。

---

## ✨ 核心特性

### 1. 🌐 时区与语言深度伪装 (Timezone & Locale Spoofing)
- **解决痛点**：跨国访问或使用代理节点时，本地 OS 时区与语言往往直接暴露真实环境（如 Claude / ChatGPT 首屏问候语错位、网站展示非节点本地时间）。
- **深度原型链拦截**：
  - 拦截 `Date.prototype.getTimezoneOffset`、`getHours`、`getMinutes`、`getSeconds`、`getDate`、`getDay`、`getFullYear` 等所有本地时间 Getter。
  - 拦截 `Date.prototype.toString`、`toDateString`、`toTimeString`、`toLocaleString` 以及 `Date.parse` 与构造函数。
  - 拦截 `Intl.DateTimeFormat`、`Intl.NumberFormat`、`Intl.Collator` 等全部 `Intl` 构造函数，默认时区与语言自动对齐。
  - 伪装 `navigator.language` 与 `navigator.languages`。

### 2. 🛡️ WebRTC 真实 IP 防泄漏 (TUN 增强)
- **解决痛点**：在 Clash / Surge / Mihomo 等代理客户端开启 **TUN 模式** 时，Chrome 通常处于 `DIRECT` 直连状态，此时常规基于代理的 WebRTC 插件往往失效，容易通过 STUN/TURN 请求与候选者暴露内网/公网真实真实 IP。
- **双层纵深防御**：
  - **JS 原型层**：拦截 `RTCPeerConnection` 的 SDP 处理、ICE Candidate 事件过滤与 `getStats()` 报告清洗，抹除所有私网与原生公网 host/srflx IP。
  - **浏览器策略层**：联动 Chrome Privacy API 设置 `disable_non_proxied_udp`。

### 3. 📍 物理地理坐标 (GPS / Geolocation) 伪装
- **精准对齐**：自动拦截 `navigator.geolocation.getCurrentPosition` 和 `watchPosition`。
- **原型真实性**：返回标准的 `GeolocationPosition` 与 `GeolocationCoordinates` 原型对象，经纬度精准对应所选节点城市（默认水牛城/纽约：`42.8864° N, 78.8784° W`）。

### 4. 🎨 Canvas & WebGL 画布噪点微扰
- **打破指纹追踪**：在 `CanvasRenderingContext2D.prototype.getImageData`、`toDataURL`、`toBlob` 以及 WebGL `readPixels` 中注入微小的同站确定性噪点微扰。
- **平滑无感**：像素微扰仅发生于最低有效位（LSB），肉眼完全无感，既能打破跨站 Canvas/WebGL 指纹库关联，又避免因反复读取触发浏览器的性能警告。

### 5. 📋 智能单站白名单机制
- **默认全网防护**：默认对所有网站开启安全伪装。
- **单站一键启停**：在弹窗中针对当前网站（如内网系统、本地开发、或需要原生国内环境的网站）一键关闭，自动记入白名单。
- **智能域名匹配**：支持主域名与子域名关联匹配（如将 `bilibili.com` 加入白名单，自动覆盖其所有 API 及二级域名）。
- **统一抽屉管理**：可随时在弹窗的白名单管理抽屉中查看与一键移出。

### 6. 🔒 极高隐蔽性与兼容性 (Stealth & Compatibility)
- **原生反检测保护**：全面保护所有被 Hook 方法的 `Function.prototype.toString`、`.name`、`.length`，对抗主流自动化指纹检测库对 `[native code]` 的扫描。
- **安全隔离架构**：Isolated World 与 Main World 之间采用基于随机密钥的 **MAC 签名消息信道**，杜绝页面恶意脚本伪造关闭指令。
- **严格遵循 CSP & Trusted Types**：原生兼容 Stripe 支付组件、GitHub、Google 等配置了严格内容安全策略（CSP）与可信类型（Trusted Types）的现代网页。

---

## 🖥️ 扩展面板与功能预览

点击浏览器工具栏的 🛡️ 图标即可呼出控制面板：

* **全局总开关**：一键暂停或恢复全局伪装扩展。
* **当前网站状态卡片**：清晰展示当前站点的域名、运行状态及单站启停开关。
* **实时看板**：
  * 当前模拟的市区与位置（如 `Buffalo, New York`）
  * IANA 时区标识（如 `America/New_York`）与 UTC 偏移
  * 当地当前时间（支持点击在 12 小时制 / 24 小时制之间切换）
  * 物理 GPS 经纬度与生效语言
* **常用节点预设 & 自定义配置**：
  * 内置常用地区预设：纽约 (美东)、水牛城、洛杉矶 (美西)、伦敦 (英国)、东京 (日本)、新加坡、香港等。
  * 支持自定义任意 IANA 时区、经纬度、城市名称与 Locale。
* **白名单网站管理抽屉**：可视化标签展示与快捷删除。
* **标签页 Badge 状态提示**：
  * 🟢 **ON**：当前网页正在保护中
  * ⚪ **OFF**：当前网页处于白名单放行状态或全局已暂停

---

## 📦 安装与使用方法

1. **下载或克隆本仓库**：
   ```bash
   git clone https://github.com/4everSivan/locale-spoof.git
   ```

2. **在 Chrome 中加载**：
   1. 打开 Chrome 浏览器，在地址栏输入并进入：
      ```text
      chrome://extensions/
      ```
   2. 开启右上角的 **“开发者模式” (Developer mode)**。
   3. 点击左上角的 **“加载已解压的扩展程序” (Load unpacked)**。
   4. 选择本项目所在的文件目录（包含 `manifest.json` 的文件夹）。

3. **固定到工具栏**：
   - 点击浏览器右上角拼图图标（扩展管理），将 **Locale & WebRTC Consistency**（🛡️ 图标）固定在工具栏，即可随时点击使用。

---

## 📂 项目结构

```text
locale-spoof/
├── manifest.json       # Chrome 扩展 Manifest V3 核心清单
├── background.js       # Service Worker：管理徽标 Badge、WebRTC 隐私策略及状态同步
├── content.js          # 隔离世界脚本：生成 MAC 握手密钥并建立通信桥梁
├── inject.js           # 主世界注入引擎：底层原型链 Hook、时区/WebRTC/Canvas/GPS 伪装
├── popup.html          # 扩展弹窗界面结构
├── popup.css           # 弹窗样式表（现代化暗色/明色微质感卡片布局）
├── popup.js            # 弹窗交互控制逻辑、动态时钟、预设切换与白名单管理
├── icons/              # 16px、48px、128px 盾牌图标
└── README.md           # 项目使用与技术说明文档
```

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源。
