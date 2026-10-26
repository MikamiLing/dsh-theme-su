/**
 * 祀（dsh-theme-su）— 主题插件，浏览器端。
 *
 * 手写 client bundle，走 DSH 的 client-module 形式：执行本文件只向
 * `window.__ModuleLoader__` 注册惰性工厂，副作用全在工厂闭包里。
 *
 * 设计：整页是一张水墨长卷（`body` 背景），侧栏是压在上面的毛玻璃，
 * 角色从侧栏底部站起来；配色是象牙白 + 新墨 + 青玉，不用金色描边。
 * 开屏动画在 `shell.overlay` 里，播完淡出；没有配置或关闭时不占用任何位置。
 *
 * 宿主端点：
 *   GET  /dsh-theme-su/config.json         生效配置 + 资源目录 + 开屏媒体
 *   POST /dsh-theme-su/config              保存配置
 *   POST /dsh-theme-su/splash/pick         打开本机文件选择框
 *   GET  /dsh-theme-su/splash/asset/<name> 开屏媒体（支持 Range）
 *   GET  /dsh-theme-su/asset/<name>        自带图片
 *   GET  /dsh-theme-su/wallpaper           用户指定的壁纸
 *
 * @module dsh-theme-su/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-theme-su',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    /** react-dom 只在挂 body 级 portal 时用；模块表里没有它时退回槽位渲染。 */
    const reactDom = (() => {
      try {
        return require('react-dom')
      } catch {
        return {}
      }
    })()
    const createPortal = typeof reactDom.createPortal === 'function' ? reactDom.createPortal : undefined

    const BASE = '/dsh-theme-su'
    const CONFIG_URL = `${BASE}/config.json`
    const SAVE_URL = `${BASE}/config`
    const PICK_URL = `${BASE}/splash/pick`
    const STYLE_ID = 'dsh-theme-su-style'
    const MASCOT_ID = 'dsh-theme-su-mascot'
    const ROW_ID = 'dsh-theme-su'
    const SPLASH_ROW_ID = 'dsh-theme-su-splash'
    const TAB_SLOT = 'settings.plugins.tab'
    const OVERLAY_SLOT = 'shell.overlay'

    /** 开屏节点的层级；body 级 portal 里这个数字才真正生效。 */
    const TOP_Z = 2147483000

    /** 宿主注入的首帧遮盖规则里的标记，客户端释放时按它删整段样式。 */
    const COVER_MARKERS = ['dsh-theme-su-splash-cover', 'dsh-theme-su-splash-base']

    /** 释放只能做一次：删掉规则后不能因为开屏卸载而重新生效。 */
    let coverReleased = false

    /** 三套纸墨。纸色与墨色同时决定深浅两套画布。 */
    const ACCENTS = {
      si: { zh: '青玉', en: 'Jade', swatch: '#2f6e5a', paper: '#f4f1e9', ink: '#121714' },
      ink: { zh: '新墨', en: 'Ink', swatch: '#3b413e', paper: '#f3f2ee', ink: '#111312' },
      moss: { zh: '苔痕', en: 'Moss', swatch: '#5d7d4a', paper: '#f4f2e8', ink: '#14170f' },
    }

    const WALLPAPERS = [
      { id: 'scroll', zh: '水墨长卷', en: 'Scroll' },
      { id: 'none', zh: '素纸', en: 'Plain paper' },
    ]

    const PORTRAITS = [
      { id: 'rotate', zh: '轮换', en: 'Rotate' },
      { id: 'bust', zh: '半身', en: 'Bust' },
      { id: 'su', zh: '素衣', en: 'Alt pose' },
      { id: 'side', zh: '侧身', en: 'Side' },
      { id: 'front', zh: '正襟', en: 'Front' },
      { id: 'none', zh: '不显示', en: 'None' },
    ]

    const SPLASH_FITS = [
      { id: 'adaptive', zh: '自适应', en: 'Adaptive' },
      { id: 'contain', zh: '完整', en: 'Contain' },
      { id: 'cover', zh: '铺满', en: 'Cover' },
      { id: 'fill', zh: '拉伸', en: 'Fill' },
    ]

    const SPLASH_SKIPS = [
      { id: 'button', zh: '按钮', en: 'Button' },
      { id: 'click', zh: '点击任意处', en: 'Any click' },
      { id: 'auto', zh: '自动', en: 'Auto' },
      { id: 'never', zh: '不可跳过', en: 'Never' },
    ]

    /** 轮换池：四张同尺度的半身立绘。 */
    const ROTATION = ['bust', 'su', 'side', 'front']

    /** 立绘 id → 资源目录里的键（side/front 的资源名带 bust- 前缀，不能直接拿 id 取）。 */
    const PORTRAIT_ASSET = { bust: 'bust', su: 'su', side: 'side', front: 'front' }

    const TEXT = {
      zh: {
        tab: '祀',
        title: '祀 · 水墨主题',
        intro: '整页一张水墨长卷，侧栏压一层毛玻璃，角色从侧栏底部站起来。纸色、墨色与立绘都可以在这里调，改完即时预览。',
        enabled: '启用主题',
        off: '已关闭 —— DSH 与未安装本插件时一致。',
        wallpaper: '背景长卷',
        wallpaperSrc: '自己的图',
        wallpaperSrcHint: '留空用上面的预设；填本机绝对路径即可覆盖，例如 D:\\pictures\\scroll.png。',
        scrim: '纸色浓度',
        scrimHint: '越高，画面越像贴了一层宣纸；文字也更清楚。',
        portrait: '侧栏立绘',
        portraitOpacity: '立绘浓度',
        tint: '面板不透明度',
        tintHint: '调低能看到更多画面，代价是文字对比度下降。',
        radius: '圆角',
        glass: '毛玻璃',
        glassHint: '侧栏后面的画面会做一次模糊，像糊了一层宣纸。',
        accent: '纸墨',
        splashSection: '开屏动画',
        splashIntro: '打开或刷新页面时先播一段视频/动图，播完淡出。留空使用内置开场，也可以换成自己的文件。',
        splashEnabled: '启用开屏动画',
        splashOn: '下次打开或刷新页面时播放。',
        splashOff: '已关闭 —— 启动时直接进入界面。',
        splashSrc: '视频 / 动图',
        splashSrcHint: '留空使用内置开场；填本机绝对路径。',
        splashChoose: '选择文件…',
        splashBuiltin: '用内置',
        splashFit: '填充方式',
        splashSkip: '跳过方式',
        splashSkipButton: '跳过',
        splashMuted: '静音',
        splashVolume: '音量',
        splashFadeOut: '淡出时长',
        splashDuration: '最长播放',
        splashDurationHint: '0 = 播到结尾；大于 0 时到点就淡出。',
        splashCurrent: '当前开场',
        splashBuiltinName: '内置开场视频',
        splashNextReload: '开屏动画的改动在下次刷新页面后生效。',
        splashSaved: '已保存。开屏动画改动下次刷新页面生效。',
        splashPicking: '等待文件选择…',
        splashPickUnavailable: '这个宿主没有可用的文件对话框，请直接把路径填进输入框。',
        splashProblem: {
          'missing-file': '找不到这个文件。',
          'unreadable-file': '这个文件读不出来。',
          'not-a-file': '这个路径不是一个文件。',
          'unsupported-format': '这个扩展名不在支持列表里。',
          'file-too-large': '文件超过 4 GiB 上限。',
          'load-failed': '读不到配置。',
        },
        save: '保存',
        reset: '恢复默认',
        saved: '已保存。',
        dirty: '有未保存的改动。',
        preview: '即时预览中',
      },
      en: {
        tab: 'Si',
        title: 'Si · ink-wash theme',
        intro: 'One ink scroll across the page, frosted glass for the sidebar, and the character standing at its foot. Paper, ink and portrait are tunable here with a live preview.',
        enabled: 'Enable theme',
        off: 'Off — DSH looks exactly as it does without this plugin.',
        wallpaper: 'Backdrop',
        wallpaperSrc: 'Custom image',
        wallpaperSrcHint: 'Leave empty for a preset; an absolute path overrides it, e.g. D:\\pictures\\scroll.png.',
        scrim: 'Paper veil',
        scrimHint: 'Higher reads more like rice paper and keeps text crisp.',
        portrait: 'Sidebar portrait',
        portraitOpacity: 'Portrait strength',
        tint: 'Panel opacity',
        tintHint: 'Lower shows more of the backdrop at the cost of contrast.',
        radius: 'Corner radius',
        glass: 'Frosted glass',
        glassHint: 'Blurs the backdrop behind the sidebar.',
        accent: 'Paper & ink',
        splashSection: 'Splash animation',
        splashIntro: 'Play a video or animated image over the page when it opens or reloads, then fade it out. Leave the path empty to use the bundled opening, or choose your own file.',
        splashEnabled: 'Enable splash',
        splashOn: 'Plays the next time the page opens or reloads.',
        splashOff: 'Off — DSH goes straight to the interface.',
        splashSrc: 'Video / image',
        splashSrcHint: 'Leave empty for the bundled opening, or enter an absolute local path.',
        splashChoose: 'Choose file…',
        splashBuiltin: 'Use bundled',
        splashFit: 'Fill mode',
        splashSkip: 'Skip',
        splashSkipButton: 'Skip',
        splashMuted: 'Muted',
        splashVolume: 'Volume',
        splashFadeOut: 'Fade-out',
        splashDuration: 'Max runtime',
        splashDurationHint: '0 = play to the end; a positive value fades out at that mark.',
        splashCurrent: 'Current opening',
        splashBuiltinName: 'Bundled opening video',
        splashNextReload: 'Splash changes take effect after the next page reload.',
        splashSaved: 'Saved. Splash changes take effect after the next page reload.',
        splashPicking: 'Waiting for the file dialog…',
        splashPickUnavailable: 'This host has no file dialog available; paste the path into the field instead.',
        splashProblem: {
          'missing-file': 'That file was not found.',
          'unreadable-file': 'That file could not be read.',
          'not-a-file': 'That path is not a file.',
          'unsupported-format': 'That extension is not in the supported list.',
          'file-too-large': 'The file exceeds the 4 GiB limit.',
          'load-failed': 'The configuration could not be read.',
        },
        save: 'Save',
        reset: 'Restore defaults',
        saved: 'Saved.',
        dirty: 'Unsaved changes.',
        preview: 'Live preview',
      },
    }

    function strings() {
      const lang = String((typeof navigator !== 'undefined' && navigator.language) || 'en').toLowerCase()
      return lang.startsWith('zh') ? TEXT.zh : TEXT.en
    }

    const DEFAULTS = {
      enabled: true,
      wallpaper: 'scroll',
      wallpaperSrc: '',
      scrim: 50,
      portrait: 'rotate',
      portraitOpacity: 88,
      glass: false,
      radius: 1,
      accent: 'si',
      tint: 100,
      splashEnabled: true,
      splashSrc: '',
      splashFit: 'fill',
      splashSkip: 'button',
      splashSkipAfterMs: 1200,
      splashMuted: true,
      splashVolume: 0.6,
      splashBackground: '#000000',
      splashFadeInMs: 320,
      splashFadeOutMs: 300,
      splashPlaybackRate: 1,
      splashWaitForAppMs: 2500,
      splashHoldAfterEndMs: 0,
      splashMaxReplays: 0,
      splashDuration: 0,
    }

    /** 宿主返回的最近一次配置。 */
    let current = {
      settings: null,
      catalog: {},
      splash: { media: { kind: 'none' }, problem: null, source: null, engaged: false },
    }

    /** 当前会话的标识（由侧栏行或 session store 提供），决定轮换到哪张立绘。 */
    let sessionKey = ''

    /**
     * 把会话标识稳定地映射到一张立绘。
     *
     * 用哈希而不是自增计数：切回同一个对话时还是同一个人，不会因为中间
     * 多点了几次就错位；不同对话通常落到不同立绘，看起来就是"换人会变"。
     * @param settings - 完整配置。
     * @param key - 会话 id。
     * @returns 立绘 id。
     */
    function resolvePortrait(settings, key) {
      if (settings.portrait === 'none') return 'none'
      if (settings.portrait !== 'rotate') return settings.portrait
      const text = String(key ?? '')
      let hash = 2166136261
      for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i)
        hash = Math.imul(hash, 16777619) >>> 0
      }
      return ROTATION[hash % ROTATION.length]
    }

    /**
     * 同步读配置：主题必须在首帧之前就知道自己该上什么色，
     * 异步 fetch 做不到（至少要跨一个任务），所以这里故意用同步 XHR。
     */
    function readConfigSync() {
      try {
        const request = new XMLHttpRequest()
        request.open('GET', CONFIG_URL, false)
        request.send(null)
        if (request.status !== 200) return undefined
        const payload = JSON.parse(request.responseText)
        return typeof payload === 'object' && payload !== null ? payload : undefined
      } catch {
        return undefined
      }
    }

    function withDefaults(raw) {
      const out = { ...DEFAULTS }
      if (typeof raw !== 'object' || raw === null) return out
      for (const key of Object.keys(DEFAULTS)) {
        if (raw[key] !== undefined && raw[key] !== null) out[key] = raw[key]
      }
      return out
    }

    /** 把 body 级节点放进根堆叠上下文；没有 react-dom 时退回槽位渲染。 */
    function topLayer(node) {
      if (typeof document === 'undefined' || document.body === null) return node
      if (typeof createPortal === 'function') {
        try {
          return createPortal(node, document.body)
        } catch { /* portal 失败就退回槽位 */ }
      }
      return node
    }

    /**
     * 释放宿主在首帧前加上的遮盖。
     *
     * 必须是「删掉规则」而不是「让规则失效」：应用一旦露出来就不能再被盖回去，
     * 而开屏卸载时如果只是条件变化，规则会重新生效。删除是一次性的。
     */
    function releaseCover() {
      if (coverReleased || typeof document === 'undefined') return
      coverReleased = true
      try {
        const guard = globalThis.__DSH_THEME_SU_SPLASH_GUARD__
        if (guard !== undefined && guard !== null && typeof guard.clear === 'function') guard.clear()
      } catch { /* 没有 guard 是正常情况 */ }
      try {
        const sheets = document.head ? document.head.getElementsByTagName('style') : []
        const doomed = []
        for (let i = 0; i < sheets.length; i += 1) {
          const text = typeof sheets[i].textContent === 'string' ? sheets[i].textContent : ''
          if (COVER_MARKERS.some((marker) => text.includes(marker))) doomed.push(sheets[i])
        }
        for (const node of doomed) {
          if (typeof node.remove === 'function') node.remove()
          else if (node.parentNode !== null) node.parentNode.removeChild(node)
        }
      } catch { /* 露出界面不能抛错 */ }
    }

    /** @returns 当前要用的 `object-fit` 关键字。 */
    function objectFit(fit) {
      if (fit === 'cover') return 'cover'
      if (fit === 'fill') return 'fill'
      return 'contain'
    }

    /**
     * 视频的兜底退出时间。
     *
     * 只有知道长度以后才允许计时；未知长度（NaN/0）给一个很宽松的上限，绝不
     * 用「等待应用就绪」那个短时间截断视频。
     * @param lengthSeconds - 媒体长度（秒）。
     * @param settings - 开屏配置。
     * @returns 毫秒。
     */
    function fadeDelayFor(lengthSeconds, settings) {
      const known = typeof lengthSeconds === 'number' && Number.isFinite(lengthSeconds) && lengthSeconds > 0
      if (!known) return 120000
      const limit = Number(settings.splashDuration) || 0
      if (limit > 0 && limit < lengthSeconds * 1000) return limit
      return lengthSeconds * 1000 + 5000
    }

    /**
     * 开屏覆盖层。
     *
     * 生命周期：挂载（宿主仍是遮盖状态）→ 播放 → 结束/跳过 → 淡出 → 卸载。
     * 应用由 `useLayoutEffect` 在首帧前释放，此时覆盖层已经是不透明的一层，
     * 所以不会闪一下界面。
     */
    function SplashOverlay() {
      const t = strings()
      const [settings] = React.useState(() => ({ ...DEFAULTS, ...(current.settings ?? {}) }))
      const [media] = React.useState(() => current.splash?.media ?? { kind: 'none' })
      const [phase, setPhase] = React.useState('in')
      const [paintable, setPaintable] = React.useState(false)
      const [failed, setFailed] = React.useState(false)
      const [entered, setEntered] = React.useState(false)
      const videoRef = React.useRef(null)
      const dismissedRef = React.useRef(false)
      /** 只区分「已结束」，这样 'in' → 'out' 不会重跑媒体 effect、把视频重新播一遍。 */
      const done = phase === 'done'

      React.useLayoutEffect(() => {
        releaseCover()
      }, [])

      // 只淡入媒体，不淡入整层：整层透明会露出应用一帧，正是首帧遮盖要避免的。
      React.useEffect(() => {
        if (typeof window === 'undefined') return undefined
        const raf = typeof window.requestAnimationFrame === 'function'
          ? window.requestAnimationFrame.bind(window)
          : (run) => window.setTimeout(run, 0)
        const cancel = typeof window.cancelAnimationFrame === 'function'
          ? window.cancelAnimationFrame.bind(window)
          : window.clearTimeout.bind(window)
        const id = raf(() => setEntered(true))
        return () => cancel(id)
      }, [])

      const dismiss = React.useCallback(() => {
        if (dismissedRef.current) return
        dismissedRef.current = true
        setPhase('out')
      }, [])

      React.useEffect(() => {
        if (phase !== 'out') return undefined
        const fade = Math.max(0, Number(settings.splashFadeOutMs) || 0)
        const id = window.setTimeout(() => setPhase('done'), fade)
        return () => window.clearTimeout(id)
      }, [phase, settings.splashFadeOutMs])

      // 开屏占屏期间也占输入：window 级捕获监听早于页面里按坐标命中的其它
      // 插件，避免点击被它们 stopPropagation 抢走，导致「跳过」按不动。
      const capturingInput = !done
      React.useEffect(() => {
        if (!capturingInput) return undefined
        const skipMode = settings.splashSkip
        const onPointer = (event) => {
          event.stopPropagation()
        }
        const onClick = (event) => {
          event.stopPropagation()
          const target = event.target
          const onSkip = target !== null && target !== undefined
            && typeof target.closest === 'function'
            && target.closest('[data-dsh-splash-skip]') !== null
          if (onSkip || skipMode === 'click') dismiss()
        }
        window.addEventListener('pointerdown', onPointer, true)
        window.addEventListener('click', onClick, true)
        return () => {
          window.removeEventListener('pointerdown', onPointer, true)
          window.removeEventListener('click', onClick, true)
        }
      }, [capturingInput, settings.splashSkip, dismiss])

      React.useEffect(() => {
        if (done) return undefined
        if (media.kind === 'none' || failed) {
          dismiss()
          return undefined
        }
        const timers = []
        const after = (ms, run) => {
          const id = window.setTimeout(run, Math.max(0, ms))
          timers.push(id)
          return id
        }
        const clearAll = () => {
          for (const id of timers) window.clearTimeout(id)
        }

        let fadeTimer
        let cleanupMedia = () => {}

        if (media.kind === 'video') {
          const element = videoRef.current
          if (element === null || element === undefined) {
            dismiss()
            return clearAll
          }

          element.playbackRate = Number(settings.splashPlaybackRate) || 1
          element.volume = Math.min(1, Math.max(0, Number(settings.splashVolume) || 0))
          element.muted = settings.splashMuted === true

          const finish = () => after(settings.splashHoldAfterEndMs, dismiss)
          const armFallback = () => {
            if (fadeTimer !== undefined) window.clearTimeout(fadeTimer)
            fadeTimer = after(fadeDelayFor(element.duration, settings), dismiss)
          }

          element.addEventListener('loadedmetadata', armFallback)
          element.addEventListener('durationchange', armFallback)

          const started = (() => {
            try {
              return element.play()
            } catch {
              return undefined
            }
          })()
          if (started === undefined) {
            dismiss()
            return clearAll
          }
          if (typeof started.catch === 'function') {
            started.catch(() => {
              element.muted = true
              try {
                const retry = element.play()
                if (retry !== undefined && typeof retry.catch === 'function') retry.catch(() => dismiss())
              } catch {
                dismiss()
              }
            })
          }

          const onEnded = () => {
            if (settings.splashMaxReplays > 0) {
              const replayed = Number(element.dataset.replays || '0')
              if (replayed < settings.splashMaxReplays) {
                element.dataset.replays = String(replayed + 1)
                element.currentTime = 0
                try {
                  const again = element.play()
                  if (again !== undefined && typeof again.catch === 'function') again.catch(() => dismiss())
                } catch {
                  dismiss()
                }
                return
              }
            }
            if (fadeTimer !== undefined) window.clearTimeout(fadeTimer)
            finish()
          }
          const onError = () => dismiss()
          const onPaintable = () => setPaintable(true)

          element.addEventListener('ended', onEnded)
          element.addEventListener('error', onError)
          element.addEventListener('loadeddata', onPaintable)
          element.addEventListener('canplay', onPaintable)

          cleanupMedia = () => {
            element.removeEventListener('loadedmetadata', armFallback)
            element.removeEventListener('durationchange', armFallback)
            element.removeEventListener('ended', onEnded)
            element.removeEventListener('error', onError)
            element.removeEventListener('loadeddata', onPaintable)
            element.removeEventListener('canplay', onPaintable)
          }

          return () => {
            clearAll()
            cleanupMedia()
          }
        }

        // 动图没有 ended 事件，只能靠时长或等待上限退出。
        const lifetime = settings.splashDuration > 0
          ? settings.splashDuration
          : Math.max(settings.splashWaitForAppMs, 4000)
        after(lifetime, dismiss)
        return clearAll
      }, [done, media, failed, settings, dismiss])

      React.useEffect(() => {
        if (done || settings.splashSkip !== 'auto') return undefined
        const id = window.setTimeout(dismiss, Math.max(0, settings.splashSkipAfterMs))
        return () => window.clearTimeout(id)
      }, [done, settings.splashSkip, settings.splashSkipAfterMs, dismiss])

      React.useEffect(() => {
        if (done || settings.splashSkip === 'never' || settings.splashSkip === 'auto') return undefined
        const onKey = (event) => {
          if (event.key === 'Escape' || event.key === ' ' || event.key === 'Enter') {
            event.preventDefault()
            dismiss()
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [done, settings.splashSkip, dismiss])

      if (done || media.kind === 'none') return null

      const fading = phase === 'out'
      const overlayStyle = {
        position: 'fixed',
        inset: 0,
        zIndex: TOP_Z,
        display: 'grid',
        placeItems: 'center',
        background: settings.splashBackground,
        pointerEvents: 'auto',
        opacity: fading ? 0 : 1,
        transition: `opacity ${fading ? settings.splashFadeOutMs : 0}ms ease`,
        overflow: 'hidden',
      }

      const children = []
      const adaptive = settings.splashFit === 'adaptive'
      const fit = objectFit(settings.splashFit)
      const fadeIn = `opacity ${Math.max(0, Number(settings.splashFadeInMs) || 0)}ms ease`

      // 自适应：前景完整显示（contain），后面再铺一层同一媒体的模糊放大版
      // 填满窗口。这样既不裁掉画面，也不会留下两条黑边。
      if (adaptive) {
        const ambientStyle = {
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          filter: 'blur(28px) brightness(0.58) saturate(0.92)',
          transform: 'scale(1.08)',
          opacity: entered ? 0.92 : 0,
          transition: fadeIn,
          pointerEvents: 'none',
          zIndex: 0,
        }
        if (media.kind === 'video') {
          children.push(h('video', {
            key: 'ambient',
            src: media.url,
            muted: true,
            autoPlay: true,
            loop: true,
            playsInline: true,
            preload: 'auto',
            'aria-hidden': true,
            tabIndex: -1,
            style: ambientStyle,
          }))
        } else {
          children.push(h('img', {
            key: 'ambient',
            src: media.url,
            alt: '',
            'aria-hidden': true,
            style: ambientStyle,
          }))
        }
      }

      if (media.kind === 'video') {
        children.push(h('video', {
          key: 'video',
          ref: videoRef,
          src: media.url,
          muted: settings.splashMuted === true,
          playsInline: true,
          autoPlay: true,
          preload: 'auto',
          onError: () => setFailed(true),
          'aria-label': 'splash animation',
          style: {
            position: 'relative',
            zIndex: 1,
            width: '100%',
            height: '100%',
            objectFit: fit,
            background: adaptive ? 'transparent' : settings.splashBackground,
            opacity: entered ? 1 : 0,
            transition: fadeIn,
          },
        }))
      } else {
        children.push(h('img', {
          key: 'image',
          src: media.url,
          alt: '',
          onError: () => setFailed(true),
          style: {
            position: 'relative',
            zIndex: 1,
            width: '100%',
            height: '100%',
            objectFit: fit,
            background: adaptive ? 'transparent' : settings.splashBackground,
            opacity: entered ? 1 : 0,
            transition: fadeIn,
          },
        }))
      }

      // 视频在解出第一帧前是透明的；先盖一层与开屏底色相同的实色，避免界面
      // 从尚未解码的视频里透出来。
      if (media.kind === 'video' && !paintable) {
        children.push(h('div', {
          key: 'cover',
          'aria-hidden': true,
          style: { position: 'absolute', inset: 0, zIndex: 2, background: settings.splashBackground },
        }))
      }

      if (settings.splashSkip !== 'never' && settings.splashSkip !== 'auto') {
        children.push(h('button', {
          key: 'skip',
          type: 'button',
          'data-dsh-splash-skip': '',
          onClick: (event) => {
            event.stopPropagation()
            dismiss()
          },
          style: {
            position: 'absolute',
            right: '22px',
            bottom: '20px',
            zIndex: 3,
            padding: '7px 14px',
            borderRadius: '999px',
            border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.22))',
            background: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.42))',
            color: 'var(--dsw-alias-label-primary, #ffffff)',
            font: 'inherit',
            fontSize: '13px',
            cursor: 'pointer',
            opacity: 0.72,
          },
        }, t.splashSkipButton))
      }

      return topLayer(h('div', {
        style: overlayStyle,
        'data-dsh-theme-su-splash': '',
      }, children))
    }

    /**
     * 开屏的最后一层保险：覆盖层渲染出错时立刻释放宿主遮盖，宁可没有开屏，
     * 也不能把界面锁在黑屏里。
     */
    class SplashBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }

      static getDerivedStateFromError() {
        return { failed: true }
      }

      componentDidCatch() {
        releaseCover()
      }

      render() {
        if (this.state.failed) return null
        return this.props.children
      }
    }

    function SplashRoot() {
      return h(SplashBoundary, null, h(SplashOverlay))
    }

    /** 立绘在侧栏里的尺寸：四张都按同一头身比裁过，所以盒子尺寸一致。 */
    const PORTRAIT_BOX = {
      bust: { width: '104%', height: '58%', fit: 'contain' },
      su: { width: '102%', height: '58%', fit: 'contain' },
      side: { width: '104%', height: '58%', fit: 'contain' },
      front: { width: '102%', height: '58%', fit: 'contain' },
    }

    /**
     * 由配置生成整张样式表。
     * @param settings - 完整配置。
     * @param catalog - 宿主给的资源 URL 目录。
     * @param portraitId - 本次要画的立绘；缺省时按当前会话推导。
     * @returns CSS 文本；关闭时返回空串。
     */
    function cssFor(settings, catalog, portraitId) {
      if (settings.enabled !== true) return ''
      const accent = ACCENTS[settings.accent] ?? ACCENTS.si
      const k = settings.tint / 100
      const a = (base) => (base * (0.55 + 0.45 * k)).toFixed(3)
      const veil = Number((settings.scrim / 100).toFixed(3))
      const custom = typeof settings.wallpaperSrc === 'string' ? settings.wallpaperSrc.trim() : ''
      const wallpaperUrl = settings.wallpaper === 'none'
        ? null
        : custom !== ''
          ? catalog.custom ?? null
          : catalog[`wallpaper-${settings.wallpaper}`] ?? null
      const portrait = portraitId ?? resolvePortrait(settings, sessionKey)
      const assetKey = PORTRAIT_ASSET[portrait]
      const portraitUrl = portrait === 'none' ? null : catalog[assetKey] ?? null
      const box = PORTRAIT_BOX[portrait] ?? PORTRAIT_BOX.bust
      const mix = (pct, other) => `color-mix(in oklab, ${accent.swatch} ${pct}%, ${other})`

      // 纸色蒙版：暖白由深到浅再回深，模拟宣纸受光。
      const paperVeil = wallpaperUrl === null
        ? 'transparent'
        : `linear-gradient(200deg, rgba(247,244,236,${veil}) 0%, rgba(240,237,228,${(veil * 0.62).toFixed(3)}) 48%, rgba(233,232,222,${(veil * 0.78).toFixed(3)}) 100%)`
      const inkVeil = Number((veil * 1.3).toFixed(3))
      const inkVeilLayer = wallpaperUrl === null
        ? 'transparent'
        : `linear-gradient(200deg, rgba(9,13,11,${inkVeil}) 0%, rgba(12,17,14,${(inkVeil * 0.66).toFixed(3)}) 48%, rgba(8,11,9,${(inkVeil * 0.86).toFixed(3)}) 100%)`

      return hardenTokens(`/* dsh-theme-su */
html{background-color:${accent.paper}!important}
body[data-ds-dark-theme],html:has(body[data-ds-dark-theme]){background-color:${accent.ink}!important}
body{
--dtv-r:${settings.radius};
--dtv-swatch:${accent.swatch};
--dtv-portrait:${portraitUrl === null ? 'none' : `url("${portraitUrl}")`};
--dtv-portrait-w:${box.width};
--dtv-portrait-h:${box.height};
--dtv-portrait-opacity:${(settings.portraitOpacity / 100).toFixed(3)};
background-color:${accent.paper}!important;
background-image:${wallpaperUrl === null ? 'none' : `${paperVeil},url("${wallpaperUrl}")`}!important;
background-size:cover!important;background-position:center!important;
background-repeat:no-repeat!important;background-attachment:fixed!important;

--dsw-alias-bg-base:rgba(249,246,239,${a(0.72)});
--dsw-alias-bg-layer-1:rgba(252,250,244,${a(0.86)});
--dsw-alias-bg-layer-2:rgba(254,252,247,${a(0.92)});
--dsw-alias-bg-layer-3:rgba(255,253,249,${a(0.95)});
--dsw-alias-bg-overlay:rgba(246,243,234,${a(0.90)});
--dsw-alias-bg-module-platform:rgba(248,245,237,${a(0.90)});
--dsw-alias-bg-multi-select:rgba(246,243,234,${a(0.90)});
--dsw-alias-border-l1:rgba(30,44,37,0.09);
--dsw-alias-border-l2:rgba(30,44,37,0.13);
--dsw-alias-border-l3:rgba(30,44,37,0.17);
--dsw-alias-border-l4:rgba(30,44,37,0.21);
--dsw-alias-border-l2-darkmode-thin:rgba(30,44,37,0.09);
--dsw-specific-sidebar-fill:rgba(247,244,236,${a(0.34)});
--dsw-specific-menu:rgba(253,251,246,0.88);
--dsw-specific-input-major:rgba(252,250,244,${a(0.76)});
--dsw-specific-bubble:${mix(10, 'rgba(248,250,246,0.88)')};
--dsw-specific-bubble-highlight:${mix(20, 'rgba(242,247,242,0.92)')};
--dsw-specific-tip:rgba(246,243,234,${a(0.9)});
--dsw-specific-selector:rgba(246,243,234,${a(0.9)});
--dsw-alias-label-primary:${mix(72, '#101614')};
--dsw-alias-label-secondary:${mix(46, '#2b3a33')};
--dsw-alias-label-tertiary:${mix(34, '#4a5a52')};
--dsw-alias-label-caption:${mix(26, '#5d6d64')};
--dsw-alias-label-primary-bluish:${mix(58, '#0d1512')};
--dsw-alias-brand-primary:${accent.swatch};
--dsw-alias-brand-text:${mix(78, '#0d1512')};
--dsw-static-deepseek-50:${mix(6, 'white')};
--dsw-static-deepseek-100:${mix(11, 'white')};
--dsw-static-deepseek-200:${mix(18, 'white')};
--dsw-static-deepseek-300:${mix(30, 'white')};
--dsw-static-deepseek-400:${mix(70, 'white')};
--dsw-static-deepseek-450:${mix(84, 'white')};
--dsw-static-deepseek-500:${accent.swatch};
--dsw-static-deepseek-600:${mix(86, 'black')};
--dsw-static-deepseek-800:${mix(64, 'black')};
--dsw-static-deepseek-900:${mix(50, 'black')};
--dsw-alias-state-business-primary:${accent.swatch};
--dsw-alias-state-business-tertiary:${mix(14, 'white')};
--dsw-focus-ring-color:${mix(70, 'transparent')};
--dsw-radius-xs:calc(5px * var(--dtv-r));
--dsw-radius-sm:calc(8px * var(--dtv-r));
--dsw-radius-md:calc(11px * var(--dtv-r));
--dsw-radius-lg:calc(15px * var(--dtv-r));
--dsw-radius-xl:calc(22px * var(--dtv-r));
--dsw-radius-panel:calc(20px * var(--dtv-r));
--dsh-scrollbar-thumb:${mix(24, 'transparent')};
--dsh-scrollbar-thumb-hover:${mix(38, 'transparent')};
}
body[data-ds-dark-theme]{
background-color:${accent.ink}!important;
background-image:${wallpaperUrl === null ? 'none' : `${inkVeilLayer},url("${wallpaperUrl}")`}!important;
--dsw-alias-bg-base:rgba(18,23,20,${a(0.74)});
--dsw-alias-bg-layer-1:rgba(24,30,26,${a(0.84)});
--dsw-alias-bg-layer-2:rgba(29,36,31,${a(0.90)});
--dsw-alias-bg-layer-3:rgba(34,42,36,${a(0.94)});
--dsw-alias-bg-overlay:rgba(26,32,28,${a(0.92)});
--dsw-alias-bg-module-platform:rgba(25,31,27,${a(0.92)});
--dsw-alias-bg-multi-select:rgba(25,31,27,${a(0.92)});
--dsw-alias-border-l1:rgba(224,236,229,0.09);
--dsw-alias-border-l2:rgba(224,236,229,0.13);
--dsw-alias-border-l3:rgba(224,236,229,0.17);
--dsw-alias-border-l4:rgba(224,236,229,0.21);
--dsw-alias-border-l2-darkmode-thin:rgba(224,236,229,0.09);
--dsw-specific-sidebar-fill:rgba(13,18,15,${a(0.38)});
--dsw-specific-menu:rgba(29,36,31,0.9);
--dsw-specific-input-major:rgba(28,35,30,${a(0.84)});
--dsw-specific-bubble:${mix(20, 'rgba(28,35,30,0.9)')};
--dsw-specific-bubble-highlight:${mix(30, 'rgba(34,42,36,0.9)')};
--dsw-specific-tip:rgba(25,31,27,${a(0.92)});
--dsw-specific-selector:rgba(25,31,27,${a(0.92)});
--dsw-alias-label-primary:${mix(26, 'white')};
--dsw-alias-label-secondary:${mix(64, 'white')};
--dsw-alias-label-tertiary:${mix(48, 'white')};
--dsw-alias-label-caption:${mix(36, 'white')};
--dsw-alias-label-primary-bluish:${mix(30, 'white')};
--dsw-alias-brand-primary:${mix(42, 'white')};
--dsw-alias-brand-text:${mix(24, 'white')};
--dsw-alias-state-business-tertiary:${mix(16, 'black')};
--dsw-focus-ring-color:${mix(78, 'transparent')};
}

/* ---------- 侧栏：毛玻璃 + 立绘 ---------- */
[class*="_sidebarCol"]{
position:relative!important;isolation:isolate;
backdrop-filter:${settings.glass === true ? 'blur(18px) saturate(1.08)' : 'none'};
-webkit-backdrop-filter:${settings.glass === true ? 'blur(18px) saturate(1.08)' : 'none'};
}
[class*="_sidebarCol"]::after{
content:"";position:absolute;left:50%;bottom:0;z-index:-1;
width:var(--dtv-portrait-w);height:var(--dtv-portrait-h);
transform:translateX(-50%);
pointer-events:none;
background-image:var(--dtv-portrait);
background-repeat:no-repeat;background-position:center bottom;background-size:contain;
opacity:var(--dtv-portrait-opacity);
filter:drop-shadow(0 6px 16px rgba(28,42,35,0.14));
-webkit-mask-image:linear-gradient(to top,transparent 0,rgba(0,0,0,0.55) 9%,#000 30%);
mask-image:linear-gradient(to top,transparent 0,rgba(0,0,0,0.55) 9%,#000 30%);
}
body[data-ds-dark-theme] [class*="_sidebarCol"]::after{
opacity:calc(var(--dtv-portrait-opacity) * 0.72);
filter:brightness(1.04) saturate(0.96);
}

::selection{background:${mix(22, 'transparent')}}
`)
    }

    /**
     * 给整段样式里的自定义属性补 `!important`：ui-theme 的 token 样式表在本
     * 插件之后注入，同优先级会把面板底色盖回不透明，壁纸就被挡住了。
     */
    function hardenTokens(css) {
      return String(css).replace(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/g, (_match, name, value) => `${name}:${value.trim()}!important;`)
    }

    function applyStyle(css) {
      if (typeof document === 'undefined') return
      let tag = document.getElementById(STYLE_ID)
      if (css === '') {
        if (tag !== null && tag.parentNode !== null) tag.parentNode.removeChild(tag)
        return
      }
      if (tag === null) {
        tag = document.createElement('style')
        tag.id = STYLE_ID
        tag.dataset.plugin = 'dsh-theme-su'
        document.head.append(tag)
      }
      if (tag.textContent !== css) tag.textContent = css
    }

    /**
     * 换掉标签页图标。
     *
     * Q 版不做侧栏立绘（画风和水墨立绘差太远），只出现在两个地方：
     * 应用图标，以及设置界面左下角的吉祥物。
     * @param catalog - 资源目录（`icon` 键指向宿主提供的 PNG）。
     */
    function applyFavicon(catalog) {
      try {
        if (typeof document === 'undefined') return
        const href = catalog?.icon
        if (typeof href !== 'string') return
        // 宿主模板里有两张按配色方案切换的 svg 图标（带 media），只改 href 的话
        // 另一张仍会生效；整组删掉再插一张不带 media 的 PNG 才换得掉。
        const existing = document.querySelectorAll('link[rel~="icon"]')
        if (existing.length === 1 && existing[0].getAttribute('href') === href) return
        for (const link of existing) link.remove()
        const tag = document.createElement('link')
        tag.rel = 'icon'
        tag.type = 'image/png'
        tag.href = href
        document.head.append(tag)
      } catch { /* 换不掉图标不影响主题 */ }
    }

    /** 设置界面左下角的 Q 版吉祥物（body 级 fixed 节点，不塞进 React 的树里）。 */
    let mascotNode = null

    /**
     * 建好吉祥物节点并按需换图。
     * @param catalog - 资源目录（`mascot` 键）。
     * @returns 节点或 null。
     */
    function ensureMascot(catalog) {
      try {
        const href = catalog?.mascot
        if (typeof href !== 'string' || typeof document === 'undefined' || document.body === null) return null
        if (mascotNode === null || !mascotNode.isConnected) {
          mascotNode = document.getElementById(MASCOT_ID)
          if (mascotNode === null) {
            mascotNode = document.createElement('img')
            mascotNode.id = MASCOT_ID
            mascotNode.alt = ''
            mascotNode.setAttribute('aria-hidden', 'true')
            mascotNode.style.cssText = [
              'position:fixed',
              'left:0',
              'top:0',
              'pointer-events:none',
              'user-select:none',
              'z-index:2147482000',
              'opacity:0',
              'transition:opacity 180ms ease',
              'filter:drop-shadow(0 10px 22px rgba(28,42,35,0.20))',
              'display:none',
            ].join(';')
            document.body.append(mascotNode)
          }
        }
        if (!mascotNode.src.endsWith(href)) mascotNode.src = href
        return mascotNode
      } catch {
        return null
      }
    }

    /**
     * 把吉祥物贴到设置面板的左下角。
     *
     * 不动 React 的 DOM：设置弹窗带 `data-shortcut-modal="settings"`，
     * 读它的 rect，再把 body 级的图片摆到卡片左边缘外侧一点，像站在桌角。
     * 面板没开就藏起来——它只在设置界面出现。
     */
    function syncMascot() {
      if (mascotNode === null || !mascotNode.isConnected) return
      try {
        const panel = document.querySelector('[data-shortcut-modal="settings"]')
        if (panel === null) {
          mascotNode.style.opacity = '0'
          mascotNode.style.display = 'none'
          return
        }
        const rect = panel.getBoundingClientRect()
        const height = Math.round(Math.min(190, Math.max(124, rect.height * 0.185)))
        const left = Math.round(rect.left - height * 0.82)
        const top = Math.round(rect.bottom - height + 2)
        mascotNode.style.display = 'block'
        mascotNode.style.height = `${height}px`
        mascotNode.style.left = `${left}px`
        mascotNode.style.top = `${top}px`
        mascotNode.style.opacity = '1'
      } catch { /* 量不到面板就不显示 */ }
    }

    /**
     * 监听设置弹窗的出现/消失与窗口尺寸。
     * @param ctx - 客户端上下文（用于随 fiber 释放）。
     * @returns 释放函数。
     */
    function mountMascot(ctx) {
      try {
        if (typeof document === 'undefined' || document.body === null) return () => {}
        const observer = new MutationObserver(() => syncMascot())
        observer.observe(document.body, { childList: true })
        const onResize = () => syncMascot()
        window.addEventListener('resize', onResize)
        const timer = setInterval(() => syncMascot(), 800)
        syncMascot()
        return () => {
          observer.disconnect()
          window.removeEventListener('resize', onResize)
          clearInterval(timer)
        }
      } catch {
        return () => {}
      }
    }

    function render(settings, catalog, key, splash) {
      if (typeof key === 'string' && key !== '') sessionKey = key
      current = { settings, catalog: catalog ?? {}, splash: splash ?? current.splash }
      applyStyle(cssFor(settings, catalog ?? {}))
      applyFavicon(catalog ?? {})
      if (settings.enabled === true) {
        ensureMascot(catalog ?? {})
        syncMascot()
      } else if (mascotNode !== null) {
        mascotNode.style.opacity = '0'
        mascotNode.style.display = 'none'
      }
    }

    /**
     * 跟随"当前对话"。
     *
     * 两条来源互补：侧栏行带 `data-row-key`（DSH 自己的列表也用这个属性做
     * 滚动定位），点一下就知道切到了哪个会话；session store 则覆盖搜索面板、
     * 快捷键这类不经过列表点击的切换。两者都只做"由会话 id 推导立绘"，
     * 同一会话算出的结果一致，所以不会互相打架。
     * @param ctx - 客户端上下文。
     * @param onChange - 会话变化时的回调。
     * @returns 释放函数。
     */
    function watchSessions(ctx, onChange) {
      const cleanups = []

      try {
        const onClick = (event) => {
          const target = event.target
          const row = typeof target?.closest === 'function' ? target.closest('[data-row-key]') : null
          if (row === null) return
          const key = row.getAttribute('data-row-key')
          // 工作区行、分组行、占位行也带这个属性，只有 session:<id> 才是对话。
          if (typeof key !== 'string' || !key.startsWith('session:')) return
          onChange(key.slice('session:'.length))
        }
        document.addEventListener('click', onClick, true)
        cleanups.push(() => document.removeEventListener('click', onClick, true))
      } catch { /* 没有 DOM 就只靠 store */ }

      try {
        const sessions = ctx.get('sessions')
        const list = sessions?.list
        if (list !== undefined && typeof list.subscribe === 'function' && typeof list.getSnapshot === 'function') {
          const readCurrent = () => {
            const snapshot = list.getSnapshot()
            const rows = snapshot?.byId !== undefined ? Object.values(snapshot.byId) : []
            return rows.find((row) => (row?.retainedBy?.mainView ?? 0) > 0)?.id
          }
          let last = readCurrent()
          if (last !== undefined) onChange(last)
          const off = list.subscribe(() => {
            const id = readCurrent()
            if (id === undefined || id === last) return
            last = id
            onChange(id)
          })
          if (typeof off === 'function') cleanups.push(off)
        }
      } catch { /* 没有 sessions 服务时保持静态立绘 */ }

      return () => {
        for (const dispose of cleanups) {
          try {
            dispose()
          } catch { /* 释放失败不影响卸载 */ }
        }
      }
    }

    // ------------------------------------------------------------- 设置页控件

    function Row(props) {
      return h('div', {
        style: {
          display: 'flex',
          alignItems: props.align === 'top' ? 'flex-start' : 'center',
          gap: '16px',
          padding: '11px 0',
          borderTop: props.first === true ? 'none' : '0.5px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))',
        },
      }, [
        h('div', { key: 'label', style: { flex: '1 1 auto', minWidth: 0 } }, [
          h('div', { key: 't', style: { fontSize: '13px', fontWeight: 500, color: 'var(--dsw-alias-label-primary, #1b2620)' } }, props.label),
          props.hint === undefined ? null : h('div', {
            key: 'h',
            style: { marginTop: '3px', fontSize: '12px', lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary, #6e7c72)' },
          }, props.hint),
        ]),
        h('div', {
          key: 'control',
          style: { flex: '0 1 auto', minWidth: 0, maxWidth: '54%', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' },
        }, props.children),
      ])
    }

    function Toggle(props) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': props.value === true,
        onClick: () => props.onChange(props.value !== true),
        style: {
          width: '40px',
          height: '23px',
          borderRadius: '999px',
          border: 'none',
          padding: '2px',
          cursor: 'pointer',
          background: props.value === true ? 'var(--dtv-swatch, #2f6e5a)' : 'var(--dsw-alias-border-l4, rgba(0,0,0,.2))',
          transition: 'background 160ms ease',
          display: 'flex',
          justifyContent: props.value === true ? 'flex-end' : 'flex-start',
        },
      }, h('span', {
        style: {
          width: '19px',
          height: '19px',
          borderRadius: '999px',
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,.25)',
        },
      }))
    }

    function Slider(props) {
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
        h('input', {
          key: 'range',
          type: 'range',
          min: props.min,
          max: props.max,
          step: props.step ?? 1,
          value: props.value,
          onChange: (event) => props.onChange(Number(event.target.value)),
          style: { width: '104px', accentColor: 'var(--dtv-swatch, #2f6e5a)', cursor: 'pointer' },
        }),
        h('span', {
          key: 'value',
          style: { minWidth: '34px', textAlign: 'right', fontSize: '12px', fontVariantNumeric: 'tabular-nums', color: 'var(--dsw-alias-label-secondary, #4a5a52)' },
        }, `${props.value}${props.unit ?? ''}`),
      ])
    }

    function Chips(props) {
      return h('div', { style: { display: 'flex', gap: '5px', flexWrap: 'wrap', justifyContent: 'flex-end' } },
        props.options.map((option) => {
          const active = props.value === option.id
          return h('button', {
            key: option.id,
            type: 'button',
            onClick: () => props.onChange(option.id),
            style: {
              padding: '4px 9px',
              fontSize: '11.5px',
              borderRadius: '999px',
              cursor: 'pointer',
              border: active ? '1px solid var(--dtv-swatch, #2f6e5a)' : '0.5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.15))',
              background: active ? 'color-mix(in oklab, var(--dtv-swatch, #2f6e5a) 13%, transparent)' : 'transparent',
              color: active ? 'var(--dtv-swatch, #2f6e5a)' : 'var(--dsw-alias-label-secondary, #4a5a52)',
              fontWeight: active ? 600 : 400,
            },
          }, option.label)
        }))
    }

    function Button(props) {
      return h('button', {
        type: 'button',
        disabled: props.disabled === true,
        onClick: props.onClick,
        style: {
          padding: '7px 16px',
          fontSize: '13px',
          borderRadius: 'calc(10px * var(--dtv-r, 1))',
          cursor: props.disabled === true ? 'default' : 'pointer',
          opacity: props.disabled === true ? 0.5 : 1,
          border: props.primary === true ? 'none' : '0.5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.15))',
          background: props.primary === true ? 'var(--dtv-swatch, #2f6e5a)' : 'transparent',
          color: props.primary === true ? '#fff' : 'var(--dsw-alias-label-secondary, #4a5a52)',
          fontWeight: props.primary === true ? 600 : 400,
        },
      }, props.label)
    }

    /** 设置页里的分节标题，用一条细分隔线与上一节分开。 */
    function Section(props) {
      return h('section', {
        style: {
          marginTop: '22px',
          paddingTop: '14px',
          borderTop: '0.5px solid var(--dsw-alias-border-l2, rgba(0,0,0,.10))',
        },
      }, [
        h('div', {
          key: 'title',
          style: { fontSize: '14px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, #1b2620)' },
        }, props.title),
        props.hint === undefined ? null : h('p', {
          key: 'hint',
          style: { margin: '5px 0 0', fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary, #6e7c72)' },
        }, props.hint),
        props.children,
      ])
    }

    /** 开屏路径输入框。 */
    const SPLASH_FIELD = {
      flex: '1 1 auto',
      minWidth: 0,
      padding: '6px 9px',
      fontSize: '12px',
      borderRadius: 'calc(9px * var(--dtv-r, 1))',
      border: '0.5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.15))',
      background: 'var(--dsw-alias-bg-layer-1, #fff)',
      color: 'var(--dsw-alias-label-primary, #1b2620)',
    }

    function SettingsPanel() {
      const t = strings()
      const [draft, setDraft] = React.useState(() => withDefaults(current.settings))
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const [dirty, setDirty] = React.useState(false)
      const [pickError, setPickError] = React.useState(null)

      React.useEffect(() => {
        applyStyle(draft.enabled === true ? cssFor(draft, current.catalog) : '')
      }, [draft])

      const patch = (fields) => {
        setDraft((prev) => ({ ...prev, ...fields }))
        setDirty(true)
        setNotice(null)
        setPickError(null)
      }

      const save = async (next) => {
        setBusy(true)
        const previous = current.settings
        try {
          const response = await fetch(SAVE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(next),
          })
          const payload = await response.json()
          if (payload.ok !== true) throw new Error(payload.error ?? 'save-failed')
          current = {
            settings: withDefaults(payload.settings),
            catalog: payload.catalog ?? current.catalog,
            splash: payload.splash ?? current.splash,
          }
          setDraft(withDefaults(payload.settings))
          setDirty(false)
          const splashChanged = previous !== null && [
            'splashEnabled', 'splashSrc', 'splashFit', 'splashSkip', 'splashSkipAfterMs',
            'splashMuted', 'splashVolume', 'splashFadeOutMs', 'splashDuration',
          ].some((key) => previous[key] !== current.settings[key])
          setNotice(splashChanged ? t.splashSaved : t.saved)
          render(current.settings, current.catalog, undefined, current.splash)
        } catch {
          setNotice(null)
        } finally {
          setBusy(false)
        }
      }

      const chooseSplash = async () => {
        setBusy(true)
        setPickError(null)
        try {
          const response = await fetch(PICK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          })
          const payload = await response.json()
          if (payload.ok === true) {
            // 空路径 = 用户取消了对话框，保持原样。
            if (typeof payload.path === 'string' && payload.path !== '') patch({ splashSrc: payload.path })
          } else {
            setPickError(payload.error === 'picker-unavailable'
              ? t.splashPickUnavailable
              : (t.splashProblem['load-failed'] ?? null))
          }
        } catch {
          setPickError(t.splashProblem['load-failed'] ?? null)
        } finally {
          setBusy(false)
        }
      }

      const reset = () => {
        const next = { ...DEFAULTS }
        setDraft(next)
        setDirty(true)
        void save(next)
      }

      const banner = current.catalog.banner
      const zh = t === TEXT.zh
      const splashName = (() => {
        const text = typeof draft.splashSrc === 'string' ? draft.splashSrc.trim() : ''
        if (text === '') return t.splashBuiltinName
        const parts = text.split(/[\\/]/)
        return parts[parts.length - 1] || text
      })()
      const splashProblem = current.splash?.problem ?? null

      return h('div', { style: { display: 'flex', flexDirection: 'column', maxWidth: '760px', gap: '4px' } }, [
        h('div', { key: 'head', style: { display: 'flex', gap: '16px', alignItems: 'flex-start', marginBottom: '6px' } }, [
          banner === undefined || banner === null ? null : h('img', {
            key: 'banner',
            src: banner,
            alt: '',
            style: {
              width: '132px',
              height: '76px',
              objectFit: 'cover',
              borderRadius: 'calc(12px * var(--dtv-r, 1))',
              border: '0.5px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1))',
              flex: '0 0 auto',
            },
          }),
          h('div', { key: 'copy', style: { minWidth: 0 } }, [
            h('div', { key: 'titleRow', style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
              h('div', { key: 'title', style: { fontSize: '15px', fontWeight: 600, color: 'var(--dsw-alias-label-primary, #1b2620)' } }, t.title),
            ]),
            h('p', { key: 'intro', style: { margin: '6px 0 0', fontSize: '12.5px', lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary, #4a5a52)' } }, t.intro),
          ]),
        ]),

        h(Row, { key: 'enabled', first: true, label: t.enabled, hint: draft.enabled === true ? t.preview : t.off },
          h(Toggle, { value: draft.enabled, onChange: (value) => patch({ enabled: value }) })),

        draft.enabled !== true ? null : h(React.Fragment, { key: 'body' }, [
          h(Row, { key: 'wallpaper', label: t.wallpaper, align: 'top' },
            h(Chips, {
              value: draft.wallpaper,
              options: WALLPAPERS.map((item) => ({ id: item.id, label: zh ? item.zh : item.en })),
              onChange: (value) => patch({ wallpaper: value }),
            })),

          h(Row, { key: 'src', label: t.wallpaperSrc, hint: t.wallpaperSrcHint, align: 'top' },
            h('input', {
              type: 'text',
              value: draft.wallpaperSrc,
              placeholder: 'D:\\pictures\\scroll.png',
              onChange: (event) => patch({ wallpaperSrc: event.target.value }),
              style: {
                width: '190px',
                padding: '6px 9px',
                fontSize: '12px',
                borderRadius: 'calc(9px * var(--dtv-r, 1))',
                border: '0.5px solid var(--dsw-alias-border-l3, rgba(0,0,0,.15))',
                background: 'var(--dsw-alias-bg-layer-1, #fff)',
                color: 'var(--dsw-alias-label-primary, #1b2620)',
              },
            })),

          h(Row, { key: 'scrim', label: t.scrim, hint: t.scrimHint },
            h(Slider, { value: draft.scrim, min: 0, max: 100, onChange: (value) => patch({ scrim: value }) })),

          h(Row, {
            key: 'portrait',
            label: t.portrait,
            hint: draft.portrait === 'rotate'
              ? (zh ? `轮换中：当前是「${PORTRAITS.find((item) => item.id === resolvePortrait(draft, sessionKey))?.zh ?? '轮换'}」，切换对话会自动换一张。` : 'Rotating: switches with the active conversation.')
              : undefined,
          },
            h(Chips, {
              value: draft.portrait,
              options: PORTRAITS.map((item) => ({ id: item.id, label: zh ? item.zh : item.en })),
              onChange: (value) => patch({ portrait: value }),
            })),

          h(Row, { key: 'portraitOpacity', label: t.portraitOpacity },
            h(Slider, { value: draft.portraitOpacity, min: 0, max: 100, unit: '%', onChange: (value) => patch({ portraitOpacity: value }) })),

          h(Row, { key: 'tint', label: t.tint, hint: t.tintHint },
            h(Slider, { value: draft.tint, min: 0, max: 100, unit: '%', onChange: (value) => patch({ tint: value }) })),

          h(Row, { key: 'radius', label: t.radius },
            h(Slider, { value: draft.radius, min: 0, max: 2, step: 0.1, unit: '×', onChange: (value) => patch({ radius: value }) })),

          h(Row, { key: 'glass', label: t.glass, hint: t.glassHint },
            h(Toggle, { value: draft.glass, onChange: (value) => patch({ glass: value }) })),

          h(Row, { key: 'accent', label: t.accent },
            h(Chips, {
              value: draft.accent,
              options: Object.entries(ACCENTS).map(([id, item]) => ({ id, label: zh ? item.zh : item.en })),
              onChange: (value) => patch({ accent: value }),
            })),
        ]),

        h(Section, { key: 'splash', title: t.splashSection, hint: t.splashIntro }, [
          h(Row, {
            key: 'splashEnabled',
            first: true,
            label: t.splashEnabled,
            hint: draft.splashEnabled === true ? t.splashOn : t.splashOff,
          }, h(Toggle, { value: draft.splashEnabled, onChange: (value) => patch({ splashEnabled: value }) })),

          draft.splashEnabled !== true ? null : h(React.Fragment, { key: 'splashBody' }, [
            h('div', {
              key: 'splashSrc',
              style: { padding: '11px 0', borderTop: '0.5px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))' },
            }, [
              h('div', {
                key: 'label',
                style: { fontSize: '13px', fontWeight: 500, color: 'var(--dsw-alias-label-primary, #1b2620)' },
              }, t.splashSrc),
              h('div', {
                key: 'hint',
                style: { marginTop: '3px', fontSize: '12px', lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary, #6e7c72)' },
              }, t.splashSrcHint),
              h('div', {
                key: 'row',
                style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' },
              }, [
                h('input', {
                  key: 'input',
                  type: 'text',
                  value: draft.splashSrc,
                  spellCheck: false,
                  placeholder: 'D:\\videos\\opening.mp4',
                  onChange: (event) => patch({ splashSrc: event.target.value }),
                  style: SPLASH_FIELD,
                }),
                h(Button, { key: 'choose', label: t.splashChoose, disabled: busy, onClick: chooseSplash }),
                h(Button, {
                  key: 'builtin',
                  label: t.splashBuiltin,
                  disabled: busy || draft.splashSrc === '',
                  onClick: () => patch({ splashSrc: '' }),
                }),
              ]),
              pickError === null ? null : h('div', {
                key: 'pickError',
                role: 'alert',
                style: { marginTop: '6px', fontSize: '12px', color: 'var(--dsw-alias-state-error-primary, #e5484d)' },
              }, pickError),
              h('div', {
                key: 'reload',
                style: { marginTop: '6px', fontSize: '11.5px', color: 'var(--dsw-alias-label-tertiary, #6e7c72)' },
              }, t.splashNextReload),
            ]),

            h(Row, { key: 'splashFit', label: t.splashFit, align: 'top' },
              h(Chips, {
                value: draft.splashFit,
                options: SPLASH_FITS.map((item) => ({ id: item.id, label: zh ? item.zh : item.en })),
                onChange: (value) => patch({ splashFit: value }),
              })),

            h(Row, { key: 'splashSkip', label: t.splashSkip, align: 'top' },
              h(Chips, {
                value: draft.splashSkip,
                options: SPLASH_SKIPS.map((item) => ({ id: item.id, label: zh ? item.zh : item.en })),
                onChange: (value) => patch({ splashSkip: value }),
              })),

            h(Row, { key: 'splashMuted', label: t.splashMuted },
              h(Toggle, { value: draft.splashMuted, onChange: (value) => patch({ splashMuted: value }) })),

            draft.splashMuted === true ? null : h(Row, { key: 'splashVolume', label: t.splashVolume },
              h(Slider, {
                value: draft.splashVolume,
                min: 0,
                max: 1,
                step: 0.05,
                unit: '',
                onChange: (value) => patch({ splashVolume: value }),
              })),

            h(Row, { key: 'splashFadeOut', label: t.splashFadeOut },
              h(Slider, {
                value: draft.splashFadeOutMs,
                min: 0,
                max: 2000,
                step: 50,
                unit: 'ms',
                onChange: (value) => patch({ splashFadeOutMs: value }),
              })),

            h(Row, { key: 'splashDuration', label: t.splashDuration, hint: t.splashDurationHint },
              h(Slider, {
                value: draft.splashDuration,
                min: 0,
                max: 30000,
                step: 500,
                unit: 'ms',
                onChange: (value) => patch({ splashDuration: value }),
              })),

            h('div', {
              key: 'splashSummary',
              style: {
                marginTop: '14px',
                padding: '11px 13px',
                border: '0.5px solid var(--dsw-alias-border-l4, rgba(0,0,0,.15))',
                borderRadius: 'calc(11px * var(--dtv-r, 1))',
                background: 'var(--dsw-alias-bg-layer-2, #f1f2f4)',
                fontSize: '12.5px',
                lineHeight: 1.65,
                color: 'var(--dsw-alias-label-secondary, #4a5a52)',
              },
            }, [
              h('div', {
                key: 'title',
                style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary, #1b2620)', wordBreak: 'break-all' },
              }, `${t.splashCurrent}: ${splashName}`),
              splashProblem === null ? null : h('div', {
                key: 'problem',
                role: 'alert',
                style: { marginTop: '4px', color: 'var(--dsw-alias-state-error-primary, #e5484d)' },
              }, t.splashProblem[splashProblem] ?? splashProblem),
            ]),
          ]),
        ]),

        h('div', {
          key: 'actions',
          style: {
            display: 'flex', alignItems: 'center', gap: '10px', marginTop: '16px', paddingTop: '12px',
            borderTop: '0.5px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))',
          },
        }, [
          h(Button, { key: 'save', label: t.save, primary: true, disabled: busy, onClick: () => void save(draft) }),
          h(Button, { key: 'reset', label: t.reset, disabled: busy, onClick: reset }),
          h('span', {
            key: 'notice',
            role: 'status',
            style: { fontSize: '12px', color: dirty ? 'var(--dsw-alias-label-tertiary, #6e7c72)' : 'var(--dsw-alias-state-success-primary, #22c55e)' },
          }, notice ?? (dirty ? t.dirty : '')),
        ]),
      ])
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const initial = readConfigSync()
        if (initial !== undefined && typeof initial.settings === 'object') {
          current = {
            settings: withDefaults(initial.settings),
            catalog: initial.catalog ?? {},
            splash: initial.splash ?? current.splash,
          }
        }
        // 同步落下样式：这一步在首帧之前，不会看到默认配色。
        render(current.settings ?? DEFAULTS, current.catalog, undefined, current.splash)

        ctx.slots.inject(TAB_SLOT, () => ctx.slots.register(
          { name: TAB_SLOT, id: ROW_ID, order: 40, label: () => strings().tab },
          SettingsPanel,
        ))

        // 开屏只在「启用 + 媒体可播」时注册。同步读配置让这个决定留在首帧之前，
        // 不会出现界面先露一下、再被开屏盖住的情况。
        const splash = current.splash
        if (current.settings?.splashEnabled === true
          && splash?.media?.kind !== undefined
          && splash.media.kind !== 'none'
          && splash.problem == null) {
          ctx.slots.inject(OVERLAY_SLOT, () => ctx.slots.register(
            { name: OVERLAY_SLOT, id: SPLASH_ROW_ID, order: 900 },
            SplashRoot,
          ))
        } else {
          // 没有开屏会来释放宿主遮盖；这里主动释放一次，避免配置读取与宿主
          // 注入判断之间的瞬间分歧把界面锁黑。
          releaseCover()
        }

        // 切换对话时重画立绘：只重算样式表，不动其余状态。
        try {
          ctx.effect(() => watchSessions(ctx, (key) => {
            if (key === sessionKey) return
            sessionKey = key
            if (current.settings === null) return
            applyStyle(cssFor(current.settings, current.catalog))
          }), 'dsh-theme-su: follow the active session')
        } catch { /* 没有 session 服务时保持静态立绘 */ }

        // 设置界面左下角的 Q 版吉祥物：跟着弹窗出现/消失。
        try {
          ctx.effect(() => mountMascot(ctx), 'dsh-theme-su: settings mascot')
        } catch { /* 没有 DOM 就跳过 */ }

        try {
          globalThis.__DSH_THEME_SU__ = {
            get settings() { return current.settings },
            get catalog() { return current.catalog },
            get splash() { return current.splash },
            render,
            reload() {
              const next = readConfigSync()
              if (next !== undefined) {
                current = {
                  settings: withDefaults(next.settings),
                  catalog: next.catalog ?? {},
                  splash: next.splash ?? current.splash,
                }
                render(current.settings, current.catalog, undefined, current.splash)
              }
              return current
            },
          }
        } catch { /* 冻结的 globalThis 不值得让启动失败 */ }
      },
    }
  },
})
