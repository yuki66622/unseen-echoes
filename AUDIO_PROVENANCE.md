# 上楼梯音频 · 2026-09-20

用户明确指定 `A_person_walking_ste_#2-1789899299877.mp3` 用作推理游戏的上楼声音，播放 3 秒。

- 原文件 SHA-256：`79a93050772df8a571b2cf192d32c3933651398c5c4eb7c3319064ea3e705da2`。
- 游戏产物：`public/hotel/assets/stairs-up.wav`；取原音频 0–3 秒，转换为 48 kHz、双声道、16-bit PCM，共 144,000 帧，无重复循环、变速或额外合成。
- 产物 SHA-256：`1d791c73524f2ef30b6ed43fbe0122b90a1b227995579db79153604e5e82062c`。
- 触发：开始上楼时播放一次，上楼动作同步为 3 秒；不叠加旧木地板脚步；暂停、继续和重开沿用现有音频生命周期。下楼保持原声与原时间。
- 来源和授权：用户提供并明确要求用于本游戏；不据此宣称文件具有开源许可证或可独立再分发。


## 逃亡氛围与结局音频

两段均为项目已有、与用户指定原文件逐字节一致的音频，本轮只改变播放时机，不新生成录音。

| 用户指定 | 游戏文件 | SHA-256 | 用途 |
|---|---|---|---|
| Epic dark background music with deep drums, slow tempo, haunting strings, and subtle | public/multiplayer/assets/chase/background.mp3 | bd24f8c6615190e3a3cb1544e38a6cf4135ea33056dc57d269fdc1248648d102 | 开局和游戏中循环，低音量氛围 |
| Powerful witch spell in a haunted forest at night. Furious winds roaring through the trees, | public/multiplayer/assets/chase/entry.mp3 | 82f9a693d15a47a80dfc9f178da3aec69a5a1603c40df492596f7e698559f64a | 游戏结束单次播放；文件名为历史保留 |

本轮不据此变更或扩大素材许可证。真实静音运行确认有效片段分别为 30 秒和 6.68 秒。
