# Product Experience Contract · UI baseline 2 · 2026-09-20

Yuki 明确要求：各模块统一为开场介绍的风格；开场文字更快消失，点击一次进入下一句。本轮直接沿用已选 Nebula Dark，不重新选择视觉方向。

## 体验与边界

- 核心旅程：序章 → 找雨教程 → 联机名字／规则／房间 → 双人追逐 → 旅馆调查 → 结案／重开。
- 视觉：黑色背景、同一 Nebula 星云、冷蓝灰文字、系统无衬线字体、400 字重、透明细线按钮、无圆角卡片、大幅留白。叙事／准备／结算保留星云；进入声场后收暗为黑色，保留原有声场粒子和信息提示。
- 对话、设置、失败反馈、章节导航属于同一套系统；文本输入清楚可见，错误和录音状态仍有区分。
- 开场：缩短淡出／淡入；正文和空白处一次点击进入下一句，继续按钮与 Enter／Space 同样可用；阻止事件冒泡和按键重复造成连跳；最后仍由明确入口进入教程。
- 冻结已有玩法、证据、音频资源、Gemini 行为与云端联机规则，不借视觉统一调整游戏逻辑。
- 验证：桌面 1280×850、手机 390×844、短屏；实际渲染各阶段，检查键盘／鼠标切换、焦点、文字可读性、浮层遮挡和章节衔接。全程静音，不开麦克风。

## 基线与验收证据

上一版的源码提交为 `4f37cde6e7c23afed1687c8dd39e166b6d217d9d`；原发布截图在本地 `validation/production/`。本轮对照同一页面和尺寸保存 `validation/ui-unified/`。共享主题最后加载，单一所有者修改 Site；独立子代理只读审查选择器及交互风险。

项目纠偏记录：单个模块的功能验收无法证明整合后的视觉一致。之后合并模块时，以开场主题和整段用户旅程为验收基线，尤其检查第三方控件的字体、按钮、圆角及游戏中的浮层。

## 本轮追加指令（最后确认）

- 全部移动只用方向键；删除 WASD 输入映射及说明。
- 不做逐项教学。教程左侧保留唯一按键表，其他关卡删除重复移动说明；必要操作按钮与即时交互提示保留。
- 旅馆案件先用同风格信封呈现，拆开阅读完整信件，再明确点击进入游戏；信封本身不触发音频。
- 教程 Gemini 截图复现：旧运行时请求在 8ms 返回504，生产日志同路由在1–30ms失败；设置手动处理重定向后，真实birds文本200、1716ms，语音200。重定向不会被跟随，保持密钥不转发到其他目标。请求失败与真实deadline分开报告；重试发送原句，不把仅读取配置当作上游健康检查。

- 最新追加：同步 hotel revision 3（中央放大路径图、右侧指南针、相对方向提示与可接管的短程导航协助）。教程只复用指南针，追逐复用同一 TrailMap 类但传入自身8×8无墙几何，仅显示本人的已探索路径；联机对手及未探索目标不进入地图。

## 整合验收

- 132 项 Worker／旅馆检查通过；双人主流程、两层真实调查及 Gemini 错误／正确提交通过。
- 追逐复用的路径图经真实行走验证：自身行走才显露，另一位静止玩家地图保持未探索；地图与顶部状态单独检查桌面、窄屏和短屏遮挡。
- 手机信封、完整可滚动信件、教程左侧按键表、游戏右侧指南针已实际渲染检查。
- 发布继续复用现有公开网址和私有 GitHub；不修改云端追逐数据库。生产验证与精确发布标识写入外层整合发布记录，避免为发布后证据再制造未发布的源码版本。


## 当前纠偏：重开与操作提示

- 用户要求追逐重开先回到同一房间重新选角色；两人角色、准备与重开票清空，保留房间和身份。
- 用户明确出口仅将文字改为电机声音，实际音频保持原样。
- 之前保留的移动按钮与反复 E 提示仍被用户认为重复。本轮删除非教程的移动按钮行、字母按键提示与重复交互按钮；保留附近对象/方向、游戏状态、设置和必要流程动作。后续不得以“按钮不是介绍”为由把同类提示加回去。
- 用户确认每局最多5次尝试：每位玩家按E触发的有效尝试均计次，包含成功交互；教程不限制，重开清零。追逐第五次若成功捕获/逃脱仍获胜，否则机会耗尽。推理第五次成功后仍可阅读、讨论与提交解释，第六次不能再交互。
- 验收：真实双人重开→重新选角色→再次准备；方向键与E照常操作；检查追逐和推理无重复按键教学，教程保持原状。

- 本轮已完成8项真实静音浏览器检查，包括第五次抓捕成功、交换角色再开局、刷新保持次数、第五次无效尝试结算、推理重开恢复次数、教程六次确认后仍能移动。发布需配对更新追逐服务，保留数据库数据与玩家身份。

- 云端衔接验收复现入口加载竞争：信封脚本先可用，游戏模块尚未绑定进入按钮；过快点击时仍显示初始说明且没有 onclick。现信封与进入按钮分别在对应功能就绪后启用，避免丢失点击。新增刻意延迟游戏模块的浏览器检查，旧构建失败、修复后通过。后续模块化入口的可点击状态必须由功能就绪状态决定。

## 当前地图与楼梯音频决定 · 2026-09-20

- 用户否定逐步探索才显露地图的呈现。本轮直接恢复开局完整地图，替代以上历史路径遮罩规则；保留原主题和指南针。教程也显示完整地图但隐藏全部声源，Gemini 默认折叠。追逐显示场地和自己，隐藏电机与其他玩家；推理显示当前楼层全部墙、门、楼梯、房间、人物、推车和录音机，不等待行走解锁；个人路径仍可作为叠加信息。
- 音频指定为 `A_person_walking_ste_#2-1789899299877.mp3` 前 3 秒。上楼动作和片段均为 3 秒，上楼不叠加旧木脚步；下楼不变。实际来源和精确截取证据见 AUDIO_PROVENANCE.md。
- 验收证据：完整地图在玩家位移为零时已有远端墙体和地标；电机／对手输入不影响追逐地图；实走上楼、暂停／继续、完整上层图和教程指南针通过静音浏览器检查。最终云端证据记入外层发布记录。

## 本轮最终音频与布局校准

- 逃亡开局与游戏中循环 Epic Dark，音量低于主要场景线索；所有结局仅播放一次 Powerful Witch，替代旧结局声。原音频文件不变，修正的是触发位置。
- 心跳增益使用距离强度平方再乘 1.2，平滑过渡保持 0.2 秒；真实双人靠近时增益从 0.0807 到 1.1933，距离差异更大。
- 开场改为“你在一个架空的空间醒来。面前，立着许多扇门。”文字、主要按钮和底部操作统一在同一开场页面内布局，删除父页面的重叠按钮。教程手机地图与按键分区，横屏键位缩紧；入口在模块绑定事件之后启用。
- 新世界生成器为相邻 unseen/ 本地原型，不包含在此云端仓库。用户已澄清塞尔达仅作为声音设计风格参考，复用现有音库。该原型的默认提示和服务入口已相应收紧，不新增音频生成请求。


## 最新用户决定（覆盖上方历史基线）
- 全部英文 Times New Roman；首页标题单独放大；引言停留4秒并可点击立即继续。
- 每个游戏保留左侧声音球及下方适用按键、居中完整地图、右侧指南针；不重播教程或到处重复按键介绍。教程 Gemini 默认折叠。源位置隐藏规则不变。
- 中英切换保留状态、玩家名、输入与模型原话。所有非游玩页面播放指定轻雨，首次需用户手势。
- 追逐可从准备页或对局中跳过至旅馆；玩法说明和设置同排。监管者开局冻结3秒，现有标题显示倒计时；抓捕1.25m、电机/出口1.5m；5E不变；呼吸录音每20秒一次，离开/结算停止。
- 旅馆信封按用户参考采用透明完整折面及星尘；欢迎语音补录并先于方向说明；已问证人问题立即移除，重开清空。原事件第二声音暂不替换，人声含混样本仅供用户试听。
- 旅馆结尾接 Gemini 新世界：复用现有工作流、声音球/按键/地图/指南针和5E，简洁描述入口，无旧WASD或教学。受限双语JSON→确定性地图编译→验证→明确进入；音库固定。最多12个世界保存在当前浏览器；没有共享匿名世界库。服务复用已有签名会话与密钥，单实例访问者每小时8次生成、全局2并发，无自动重试。
- GitHub已按用户明确指示设为public。旧文档中的private/仅本地新世界描述已由本轮决定覆盖。

### Latest opening-audio and label direction

Use the supplied `Solo_Piano,_3_4,_Aba_Form._Minor_Key,_Early-romantic_Harmonic_Idiom,_Melancho....mp3` once before tutorial entry. After player activation wait two seconds, then fade in over three seconds and fade out over the last three seconds. Keep rain at 10% underneath, restore normal rain after the score ends if still on the opening, and cancel both menu tracks when actual tutorial loading begins. Never replay the score later in that tab journey. Preserve all non-playing-page rain behaviour after the opening. Tutorial top-left chapter label is “找到雨声”, English “Find the rain”.

### Lobby wording simplification

Remove the player-facing connection-check panel and its client initialization. Keep the normal connection status and reconnect action. In the room-choice screen, remove the duplicate chapter eyebrow and replace its heading with the single fixed English title “Chase and Run”; preserve the top-left chapter label.

Opening title restored to its original 38px desktop / 31px narrow-screen size. English is the default, including browsers carrying the legacy automatic Chinese preference; later explicit choices persist under the updated preference key.

Typography scale unified: chapter titles 32px desktop / 28px mobile, secondary display 24px / 22px, body 16px, controls 14px, supporting labels 12px. Opening title retains original 38px / 31px. Hotel envelope headline no longer grows to 56px, caption matches body, lobby names/role labels match body, and compressed hotel labels never shrink below 12px.

Refreshing the opening explicitly starts a new music journey and permits the piano again; regular chapter navigation or returning to title does not replay it. A restored browser-back page resumes menu rain while preserving the spent piano flag. This supersedes the prior no-replay-on-refresh rule.

Hotel navigation includes Skip case before reading and during investigation, linking directly to the generated-world page and preserving existing language/audio navigation rules.

Opening Skip intro and language controls share the same top offset, 40px control height and text baseline on desktop and mobile, including the iframe/parent boundary.
