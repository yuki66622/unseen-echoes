# 背景音乐项目的光尘光标

来源：用户指定、自有 private 仓库 https://github.com/yuki66622/edgechat-ambient-sound 。
固定版本：`cf8afa3d9dd856cd392ea073166da004c4355f23`，文件 `glitter.js`，导入日期2026-09-20。
SHA-256：`7e6e82df17b7d0f216060570be79877969f2f4afb3fad7f27bb0461096327fa9`。

本地 `glitter.js` 与该版本逐字节一致，未调整颜色、密度、速度响应、尺寸、亮度或消失时间。原 index.html 未发现 GLITTER 参数覆盖。仅在当前游戏入口加载，并加入现有本地服务的精确静态白名单。

上游 README 和 THIRD_PARTY_NOTICES 将此文件列为该项目原创、无第三方代码；此处基于用户明确请求进行本地复用，不将 private 仓库描述为 MIT 或公开开源。此段为最初本地导入记录。随后用户明确要求发布整合游戏及公开 GitHub；本文件随整合版本发布，上游仓库仍为 private，不因此变更素材许可。

实现为 Canvas 2D，无外部依赖和网络请求；覆盖层 pointer-events:none，不拦截点击。原版保留系统指针，关闭页面动画偏好时停止颗粒，页面隐藏时不绘制；停下鼠标后颗粒自然消散。此效果只跟随指针，不显示地图或声源。
