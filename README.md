# 未见回声 · Unseen Echoes

声音探索游戏：Nebula Dark 序章 → 找雨教程 → 双人追逐 → Pinewood Inn 个人调查。

**[打开游戏](https://unseen-echoes-play.yuki6666.chatgpt.site)**

玩家打开同一个网址即可游玩。双人关卡先填写名字，再创建房间并复制邀请链接；双方选择不同角色，准备后开局。双方同意重开时回到原房间，重新选择角色和准备。追逐结束，各自进入旅馆调查，证据与个人对话互不共享。

## 当前游戏

| 章节 | 玩法 |
|---|---|
| 序章 | 原 Nebula Dark 星云背景与中文叙事 |
| 找雨教程 | 雨、鸟鸣和火声的空间定位；中央粒子、Gemini 文字/短语音与回复光效 |
| 双人追逐 | 8×8 米无物理墙体的场地；监管者听方向心跳，求生者听移动脚步；找到电机后循雨声到出口按 E 离开 |
| 旅馆调查 | 两层空间、门与楼梯、三位证人的录音、事件录音、个人 Gemini 对话与推理判定 |

教程以外，每位玩家每局有 5 次 E 交互尝试，成功交互也计次；重开恢复。追逐第五次若未成功抓捕或逃脱，则由对手获胜。旅馆第五次成功的证词或录音可继续播放，之后仍可讨论和提交推理，但不能再执行第六次交互。

↑/↓ 前后移动，←/→ 转向，E 交互；教程与旅馆可用 F 操作门。按 P 暂停，语音关卡可按住 V 录音。声音从主动开始后播放；后台/暂停会停止。语音输入最长 12 秒。

各章节沿用开场的 Nebula Dark 风格。点击序章画面或按 Enter/Space 进入下一句；教程不设逐项教学，只在左侧显示按键表，并保留右侧指南针。追逐与旅馆共用中央路径图和右侧指南针，行走约一米后逐渐显示走过的路径，不预先显示目标或对手。旅馆先拆开信封阅读案件，再进入调查；最新版推理支持相对方向提示和可随时接管的短程导航协助。

## 本地运行

需要 Node.js 24。运行 `npm ci`，复制 `.dev.vars.example` 为 `.dev.vars`，配置已有 Gemini/ElevenLabs 密钥及随机的 `GAME_SESSION_SECRET`。这些值只在服务端使用，不能写进 public 或提交。

```sh
npm run build
npm run dev
```

本地入口为 http://127.0.0.1:18776/ 。联机端点在 `connection.json`，默认使用当前既有 Maincloud。个人关卡不把证据或对话提交到多人数据库。

缺少 Gemini 时，录音、移动与探索仍可运行，但自由对话和提交解释不可用；不能把定时案件回顾当作玩家推理成功。缺少 ElevenLabs 时保留文字回复和已有录音。动态服务调用使用配置账号的额度，本项目不自动购买服务。

## 源码与检查

| 目录 | 内容 |
|---|---|
| public/ | 玩家客户端、已选音频与许可 |
| src/ | Cloudflare Worker、教程和旅馆对话服务 |
| spacetimedb/ | 与客户端匹配的权威追逐规则 |
| tests/ | Worker、服务契约、旅馆移动／导航／路径图及错误边界检查 |

前端与 API 由 Cloudflare Workers 兼容运行时托管；联机订阅通过受限同源网关进入 SpacetimeDB。两个单人关卡使用独立 API 路径，服务器分别执行相应规则与角色记忆。案件判定使用单独的模型请求；没有完成初始证言与事件录音时不能通过。

```sh
npm test
cd spacetimedb
npm ci
npm test
npm run typecheck
```

`verify-rounds.cjs` 检查重开重选角色、五次机会和无重复操作按钮；`verify-hotel-entry.cjs` 检查游戏模块加载延迟时，信封仍可阅读，进入按钮就绪后一次点击即可进入；`verify-ui.cjs` 检查开场快进、按键、信封、样式与明确模拟的失败重试；`verify-chapters.cjs` 运行双人章节衔接；`verify-browser.cjs` 完成真实旅馆调查。均使用 Playwright 和静音 Chrome，可通过 `PLAYWRIGHT_MODULE`、`CHROME_PATH`、`GAME_SITE_URL` 指定环境。完整旅馆验证会以虚构答案调用真实已配置的 Gemini。所有自动试玩禁止开启扬声器与麦克风。验证结果及范围见 [VALIDATION.md](VALIDATION.md)。

## 发布与后续同步

复用 `.openai/hosting.json` 中的既有 Sites 项目。构建成功后提交准确源码、推送对应版本，再保存构建产物并发布。GitHub 为独立私有源码备份，推送 GitHub 本身不会触发 Sites 部署。

追逐规则变化时，先验证 `spacetimedb/` 与 `public/multiplayer/` 的同一快照，再配对发布。数据库更新坚持 `--delete-data=never`，不删除房间或重建身份。

这里是整合后的独立运行仓库。`import_game.py`、`apply_release_bridges.py` 是最初整合时的历史工具，普通构建不依赖上游；重新全量运行会覆盖目前的统一主题、按键、信封和云端适配。不要运行旧父目录 `sync_cloud.py`：它不包含完整章节，会覆盖衔接。后续上游改动必须先比较 `upstream-snapshot.json`、最新旅馆的 `hotel-snapshot.json` 与 `PROJECT_NOTES.md`，再有选择地合并。

回退时恢复上一份 Sites 版本；若规则也变化，配对恢复对应规则源码，保留数据库数据。多人身份保存在当前浏览器标签会话；不同设备或全新会话不保证自动恢复同一角色。

第三方代码与录音按 `public/licenses/` 中各自的许可与来源使用，不把整个素材集合声明为统一开源许可。数据库源码、本地配置和后端隐藏答案不会作为静态网页公开。
