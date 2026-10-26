# 祀 · dsh-theme-su

 [DeepSeek Harness]的水墨主题：大部分样式与逻辑可调。

开屏动画的实现移植自 [dsh-splash-animation](https://github.com/KDDKBD/DeepSeek-splash-animation)（MIT，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)）。

设计语言参考了社区里的「特蕾西娅」主题

立绘素材版权归原画作者与明日方舟终末地，仅作为个人使用学习和交流，禁止商用。

## 安装


```bash
dsh plugin --profile <profile> add github:MikamiLing/dsh-theme-su
```

## 设置

**设置 → 内置插件 → 祀**。改动即时预览，「保存」写入 `$DSH_HOME/dsh-theme-su/config.json`。

| 项 | 默认 | 说明 |
|---|---|---|
| 启用主题 | 开 | 关掉后与未安装插件完全一致 |
| 背景长卷 | 水墨长卷 | 水墨长卷 / 素纸 |
| 自己的图 | 空 | 本机绝对路径，覆盖预设；失效时回退预设 |
| 纸色浓度 | 50 | 越高越像覆了一层宣纸，文字越清楚 |
| 侧栏立绘 | 轮换 | 轮换 / 半身 / 素衣 / 侧身 / 正襟 / 不显示 |
| 立绘浓度 | 88 | 立绘不透明度 |
| 面板不透明度 | 100 | 调低看到更多画面，代价是对比度 |
| 圆角 | 1× | 0–2 倍 |
| 毛玻璃 | 关 | 打开后侧栏会有 `backdrop-filter` 模糊；默认关，画面更清楚、也省一点 GPU |
| 纸墨 | 青玉 | 青玉（青绿）/ 新墨（近无彩）/ 苔痕（苔绿） |
| 启用开屏动画 | 开 | 关闭后启动直接进入界面 |
| 视频 / 动图 | 空 | 留空用内置 `splash-default.mp4`；填本机路径覆盖，支持 mp4/webm/mov/mkv/gif/webp 等 |
| 填充方式 | 拉伸 | 拉伸（铺满、比例可变）/ 自适应（完整画面 + 模糊背景填满）/ 完整（留边）/ 铺满（裁切） |
| 跳过方式 | 按钮 | 按钮 / 点击任意处 / 自动 / 不可跳过；Esc、空格、回车也可提前退出 |
| 静音 | 开 | 关闭后可调音量；未静音时 Chromium 可能拒绝自动播放，插件会静音重试 |
| 淡出时长 | 300ms | 结束时淡出的时长 |
| 最长播放 | 0 | 0 = 播到结尾；大于 0 时到点就淡出 |

开屏动画的改动**下次打开或刷新页面**才生效（宿主首帧遮盖只在页面加载时注入）；主题本身的改动仍然即时预览。`$DSH_HOME/dsh-theme-su/config.json` 同时保存主题与开屏设置。

配置也可写在 profile 的 `cordis.patch.yml`（优先级高于设置页）：

```yaml
- id: dsh-theme-su
  config:
    accent: ink
    scrim: 60
    portrait: front
    splashEnabled: true
    splashSrc: D:/videos/opening.webm
    splashFit: fill
    splashSkip: click
    splashMuted: false
    splashVolume: 0.4
```

开屏的完整字段：`splashEnabled`、`splashSrc`、`splashFit`（`adaptive`/`contain`/`cover`/`fill`）、`splashSkip`（`button`/`click`/`auto`/`never`）、`splashSkipAfterMs`、`splashMuted`、`splashVolume`、`splashBackground`、`splashFadeInMs`、`splashFadeOutMs`、`splashPlaybackRate`、`splashWaitForAppMs`、`splashHoldAfterEndMs`、`splashMaxReplays`、`splashDuration`。

## 开屏动画


- 适配：默认 `splashFit: fill`，把画面直接拉伸到整个窗口，不裁切也不留黑边；代价是窗口比例与原片不同时会变形（当前约 1335×860 对 16:9）。想保持原比例又不要黑边就选「自适应」，想保留原比例并接受黑边就选「完整」，想裁切填满就选「铺满」。
- 媒体：`<video>` 支持 mp4 / m4v / webm / mov / mkv / ogv / mpg / mpeg / ts；`<img>` 支持 gif / apng / webp / avif / png / jpg / svg / bmp / ico。`.mov` / `.mkv` 能不能播取决于里面的编码；当前 Electron 解不了时开屏会直接跳过（不会卡住），设置页只负责报告路径、扩展名与大小问题。
- 流式：宿主按 HTTP Range 发文件，视频不用整段下完才开始播。
- 选文件：设置页的「选择文件…」会让宿主开原生对话框——桌面版走 Electron，CLI 走 PowerShell（Windows）/ osascript（macOS）/ zenity（Linux）；都没有时保留手填路径。
- 退出：默认右下角有「跳过」按钮；Esc / 空格 / 回车也能退出。视频播完自动淡出；选「自动」时按 `splashSkipAfterMs` 退出。
- 关闭：设置里关「启用开屏动画」，或把 `splashEnabled` 设为 `false`；也可以直接把 `splashSrc` 指向一个不存在的文件（设置页会报错、启动时不播）。想彻底不装：见「卸载」。

> 首次安装默认播放内置 `splash-default.mp4`（当前约 15 秒）。嫌长就把「最长播放」调到 3000–5000ms，或换成自己的短片。




## 部分限制

- **壁纸没有运行时模糊**：`body` 背景不能单独模糊；负 `z-index` 的伪元素层在深色模式下会被 Chromium 的根背景吃掉（浅色正常），所以长卷直接画在 `body` 上，靠「纸色浓度」控制观感。
- **深色下立绘更淡**：深色是夜墨，立绘浓度乘 0.72 并提亮，避免人物像贴在黑板上。
- **接管配色**：所有颜色 token 带 `!important`，否则会和 DSH 自带主题样式表打架，得到半套配色。装别的主题插件时二者只能留其一。
- **开屏改动要刷新**：`splashEnabled` / `splashSrc` / 跳过方式等只在下次页面加载时读取；设置页保存后会提示。
- **开屏占输入**：开屏期间 `window` 捕获阶段会拦下指针与点击，防止别的插件按坐标抢走「跳过」；结束时会移除监听。
- **自适应模式解码两份**：为了用模糊背景填满窗口，自适应会同时播放前景完整版和背景放大版；低配/核显上会多一点 GPU 占用，介意就选「完整」或「铺满」。
- **exe 内嵌启动画面改不了**：Electron 自己的小鲸鱼启动窗口在页面之前，属于宿主；开屏动画只能接管页面这一层。

## 卸载

设置 → 内置插件里停用，或删掉依赖与 bundles 条目后重跑 `pnpm install`。

## 许可

立绘素材版权归原作者所有，侵权联系删除。


