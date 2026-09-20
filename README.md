# 未见回声 · 云端入口

固定 HTTPS 入口，玩家无需安装程序或启动本机服务。公开入口使用六位房间码邀请；对局由现有 SpacetimeDB 数据库判定，个人调查在各自浏览器内运行。

`public/` 仅包含经过白名单同步的游戏客户端、声音和许可文本。`src/worker.mjs` 只转发当前数据库的实时订阅、公开身份查询和临时身份交换。不会转发站点 Cookie、托管凭据，不能作为通用 HTTP/SQL/管理代理。云端 Gemini 尚未配置，界面明确提示，调查与双人追逐不受影响。

开发：Node 24，`npm ci --ignore-scripts`、`npm run build`、`npm test`，`npm run dev` 仅监听本机 18776。工作区中的上游游戏更新后运行 `../sync_cloud.py` 重新同步，再构建。云端源码本身独立，不依赖上级目录完成构建。

发布使用 `.openai/hosting.json` 中既有 Sites 项目，先保存并推送准确源码，再打包与发布对应版本。不要提交密钥、浏览器身份、管理配置、原始日志或本机路径。

回退时恢复上一份已保存的云端版本，不删除对局数据库。暂停发布的条件：首次连接失败率上升、无法建立同源 WebSocket、双人流程或刷新恢复回归。此时保留客户端的同一身份，允许受限的官方直连备用路径。

网络恢复覆盖同标签刷新、浏览器返回缓存页、离线后重新联网及关闭的底层连接。主动关闭标签后新开仍可能成为新玩家，不能承诺永久恢复旧房间；未验证朋友实际网络前不宣称其已恢复。所有浏览器 QA 使用静音模式。

协议依据：[Cloudflare WebSockets](https://developers.cloudflare.com/workers/runtime-apis/websockets/)、[SpacetimeDB TypeScript 客户端](https://spacetimedb.com/docs/clients/typescript/)。第三方文本保留在 `public/licenses/`。
