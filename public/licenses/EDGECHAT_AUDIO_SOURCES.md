# EdgeChat 音频导入记录

导入日期：2026-09-19。源仓库：[yuki66622/edgechat-ambient-sound](https://github.com/yuki66622/edgechat-ambient-sound)，为用户的 **private** 仓库；通过已有 GitHub 认证只读访问。全部文件固定于 commit **`cf8afa3d9dd856cd392ea073166da004c4355f23`**（2026-08-30），tree `413fdc0885eda841c235d66b030a8c804e8da2f9`。

用户已授权本地下载、导入和替换游戏音频；本次未修改远程仓库、公开文件或执行仓库代码，也未播放声音。

## 导入范围与完整性

| 源仓库分组 | 代码中的用途 | 实际数量 | 本次处理 |
|---|---|---:|---|
| `assets/*.m4a` | Ambience 面板 `NATURE`；可叠加的环境录音 | 11 | 全部导入 |
| `assets/jazz-*.mp3` | 独立 Music 面板 `JAZZ` | 4 | 主 assets 目录中的四首一并导入，当前游戏不加载 |
| `pool/` | 独立 Music 面板 `CLASSICAL_ALBUMS`，由 `pool_albums.js` 导入 | 203 | 记录清单，未导入；不属于环境声音选择器 |
| `SYNTH` | White、Pink、Brown、Wind 四种实时合成器 | 4 种，无音频文件 | 没有可下载录音，本次不复制其实现 |
| `assets-hq/` | 母带来源记录 | 0 个音频文件 | 仓库仅包含 `SOURCES.md`，无母带可下载 |

分类以固定版本的代码为准：`index.html` 第 348–366 行定义 SYNTH / NATURE；第 368–375 行定义 CLASSICAL_ALBUMS / JAZZ；第 381 行将 Ambience 与 Music 分为两个面板；第 566–576 行只为 NATURE 建立环境录音播放器，路径均为本地 `assets/<id>.m4a`。音乐播放器分别使用本地 `assets/<id>.mp3` 与 `pool_albums.js` 的本地文件路径。**未发现外部音频 URL，也没有遗漏的环境录音选择器条目。** 相关摘录保存在 [catalogue-evidence.txt](assets/edgechat/provenance/catalogue-evidence.txt)。

`pool/` 的实际 203 首为：Art of the Fugue 20、Chopin collection 104、Open Goldberg 31、Open WTC 48。远程 tree 与 `pool_albums.js` 的 203 个文件路径一致；上游 README 中“172 首”“assets 18 个文件”的旧计数不代表当前文件树。

## 本地音频清单

全部放在 `assets/edgechat/`，保留原文件名、扩展名和字节，不做裁剪、重新编码或离线音量处理。15 个文件共 **75,854,046 bytes**。所有文件均通过远程 Git blob SHA-1、字节数检查和本地 SHA-256 记录；不是 Git LFS 指针或 HTML 错误页。`afinfo` 成功识别全部 15 个音频容器，时长为其估计值，未通过扬声器试听。

| 文件 | 时长（秒） | 本地格式 | 文件大小（bytes） | 作者及仓库记录的许可 |
|---|---:|---|---:|---|
| `rain-light.m4a` | 110.137 | AAC / 48 kHz / stereo | 3,574,745 | kvgarlic — CC0 |
| `rain-thunder.m4a` | 120.000 | AAC / 48 kHz / stereo | 3,941,099 | Softday — PDM 1.0 |
| `birds.m4a` | 95.060 | AAC / 48 kHz / stereo | 3,119,523 | Pasha Lens — PDM 1.0 |
| `fire.m4a` | 150.000 | AAC / 44.1 kHz / stereo | 4,835,509 | Jeremy Hegge — PDM 1.0 |
| `ocean.m4a` | 116.833 | AAC / 48 kHz / stereo | 3,690,623 | Adam Johnson / ajohn210 — PDM 1.0 |
| `stream.m4a` | 120.000 | AAC / 48 kHz / stereo | 3,749,803 | Extemporalist — CC0 |
| `crickets.m4a` | 88.313 | AAC / 44.1 kHz / stereo | 2,739,299 | The Designer’s Choice / Nicholas Judy — CC0 |
| `cafe.m4a` | 153.808 | AAC / 44.1 kHz / stereo | 4,876,626 | The Designer’s Choice — CC0 |
| `train.m4a` | 180.000 | AAC / 48 kHz / stereo | 5,738,055 | abyssence — PDM 1.0 |
| `wind-prairie.m4a` | 150.000 | AAC / 48 kHz / stereo | 4,745,094 | Felix Blume — PDM 1.0 |
| `wind-ridge.m4a` | 180.000 | AAC / 48 kHz / stereo | 5,919,415 | Bojan Marusic — PDM 1.0 |
| `jazz-casino.mp3` | 153.626 | MP3 / 44.1 kHz / stereo | 4,824,890 | Pink Banana — CC0 |
| `jazz-busstop.mp3` | 196.320 | MP3 / 48 kHz / stereo | 7,853,965 | HoliznaCC0 — CC0 |
| `jazz-cafe.mp3` | 118.200 | MP3 / 48 kHz / stereo | 3,936,384 | LudoLoon Studio — CC BY 4.0 |
| `jazz-lounge.mp3` | 307.670 | MP3 / 44.1 kHz / stereo | 12,309,016 | Kevin MacLeod — CC BY 4.0 |

游戏本轮采用 `rain-light.m4a`、`birds.m4a`、`fire.m4a`。其中 birds 是林间鸟鸣；小雨原素材记录注明含少量远处闷雷。源仓库已对部分长母带裁剪、淡化并转为 AAC；本次导入直接保留这些已有成品，未重新制作。游戏运行时的单声道化、空间定位、增益与循环处理属于当前音频引擎，不改写这些源文件。

完整逐文件 SHA-256、Git blob SHA-1、远程路径、字节数：[download-manifest.json](assets/edgechat/provenance/download-manifest.json)。全仓库音频路径清单：[repository-audio-inventory.json](assets/edgechat/provenance/repository-audio-inventory.json)。本地格式检查：[audio-metadata.json](assets/edgechat/provenance/audio-metadata.json)。

## 已有来源记录与许可边界

下表链接来自该固定版本的已有来源记录；**本次读取并保存了这些记录，没有重新访问或重新核验其每一个第三方原站。** GitHub 仓库元数据的整体 `license` 为 null，不能据此把仓库全部内容称为某一种开源许可；具体音频按上游逐项记录区分。PDM 是 Public Domain Mark，不能改写为 CC0。

| 音频 | 上游记录的原始来源 |
|---|---|
| 小雨 | [Wikimedia Commons — Light Rain Distant Thunder](https://commons.wikimedia.org/wiki/File:Light_Rain_Distant_Thunder_July_5th_2016.wav)；[Freesound 原件](https://freesound.org/people/kvgarlic/sounds/349454/) |
| 雷雨 | [Radio Aporee — Mountshannon thunderstorm](https://archive.org/details/aporee_19000_22038) |
| 林间鸟鸣 | [Radio Aporee — Morning birds](https://archive.org/details/aporee_71360_83253) |
| 篝火 | [Radio Aporee — Campfire by Marley Lagoon](https://archive.org/details/aporee_40321_46050) |
| 海浪 | [Radio Aporee — Tybee Island surf](https://archive.org/details/aporee_69842_81323) |
| 溪流 | [Wikimedia Commons — Snowmelt flowing into lake](https://commons.wikimedia.org/wiki/File:Snowmelt_flowing_into_lake_at_Okanagan_Mountain_Provincial_Park.flac) |
| 虫鸣、咖啡馆 | [The Designer’s Choice — Ambiences](https://archive.org/details/Designers-Choice-Collection-Ambiences) |
| 火车 | [Radio Aporee — KTX high-speed train](https://archive.org/details/aporee_65051_75140) |
| 草原风 | [Radio Aporee — Tall Grass Prairie](https://archive.org/details/aporee_38613_44126) |
| 山脊风 | [Radio Aporee — Cerje wind](https://archive.org/details/aporee_51599_58879) |
| Casino Jazz 1 | [Pink Banana](https://archive.org/details/pink-banana-casino-jazz-1-loopable) |
| Bus Stop | [HoliznaCC0](https://freemusicarchive.org/music/holiznacc0/city-slacker/bus-stop/) |
| Tabletop Jazz Cafe | [LudoLoon Studio](https://archive.org/details/tabletop-jazz-cafe) |
| Airport Lounge | [Kevin MacLeod / Incompetech licensing FAQ](https://incompetech.com/music/royalty-free/faq.html) |

许可参考：[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)、[Public Domain Mark 1.0](https://creativecommons.org/publicdomain/mark/1.0/)、[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。本地导入不代表对所有原始权利链进行新的独立法律核验；已知材料以保留的上游记录为准。

随导入文件保留两首 CC BY 音乐的署名（当前游戏未加载它们）：

- **“Tabletop Jazz Cafe” by LudoLoon Studio** — [ludoloon.studio](https://ludoloon.studio/)，[source](https://archive.org/details/tabletop-jazz-cafe)，licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。本次原样复制已有 MP3，无新增修改。
- **“Airport Lounge” by Kevin MacLeod** — [incompetech.com](https://incompetech.com)，licensed under Creative Commons [By Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)。本次原样复制已有 MP3，无新增修改。

来源文档的本地快照保存在 `assets/edgechat/provenance/upstream/`，包括 README、THIRD_PARTY_NOTICES、assets/INDEX、assets-hq/SOURCES 和爵士来源记录。它们是固定版本的原始证据；其中历史数量、旧候选与旧文件决定不被静默改写，当前导入清单以上述实际文件树和校验记录为准。
