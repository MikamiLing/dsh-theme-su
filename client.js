/**
 * 祀（dsh-theme-su）— 主题插件，浏览器端。
 *
 * 手写 client bundle，走 DSH 的 client-module 形式：执行本文件只向
 * `window.__ModuleLoader__` 注册惰性工厂，副作用全在工厂闭包里。
 *
 * 设计：整页是一张水墨长卷（`body` 背景），侧栏是压在上面的毛玻璃，
 * 角色从侧栏底部站起来；配色是象牙白 + 新墨 + 青玉，不用金色描边。
 *
 * 宿主端点：
 *   GET  /dsh-theme-su/config.json   生效配置 + 资源目录
 *   POST /dsh-theme-su/config        保存配置
 *   GET  /dsh-theme-su/asset/<name>  自带图片
 *   GET  /dsh-theme-su/wallpaper     用户指定的壁纸
 *
 * @module dsh-theme-su/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-theme-su',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const BASE = '/dsh-theme-su'
    const CONFIG_URL = `${BASE}/config.json`
    const SAVE_URL = `${BASE}/config`
    const STYLE_ID = 'dsh-theme-su-style'
    const MASCOT_ID = 'dsh-theme-su-mascot'
    const ROW_ID = 'dsh-theme-su'
    const TAB_SLOT = 'settings.plugins.tab'

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
      portrait: 'bust',
      portraitOpacity: 88,
      glass: true,
      radius: 1,
      accent: 'si',
      tint: 100,
    }

    /** 宿主返回的最近一次配置。 */
    let current = { settings: null, catalog: {} }

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

    function render(settings, catalog, key) {
      if (typeof key === 'string' && key !== '') sessionKey = key
      current = { settings, catalog: catalog ?? {} }
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

    function SettingsPanel() {
      const t = strings()
      const [draft, setDraft] = React.useState(() => withDefaults(current.settings))
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const [dirty, setDirty] = React.useState(false)

      React.useEffect(() => {
        applyStyle(draft.enabled === true ? cssFor(draft, current.catalog) : '')
      }, [draft])

      const patch = (fields) => {
        setDraft((prev) => ({ ...prev, ...fields }))
        setDirty(true)
        setNotice(null)
      }

      const save = async (next) => {
        setBusy(true)
        try {
          const response = await fetch(SAVE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(next),
          })
          const payload = await response.json()
          if (payload.ok !== true) throw new Error(payload.error ?? 'save-failed')
          current = { settings: withDefaults(payload.settings), catalog: payload.catalog ?? current.catalog }
          setDraft(withDefaults(payload.settings))
          setDirty(false)
          setNotice(t.saved)
          render(current.settings, current.catalog)
        } catch {
          setNotice(null)
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
          current = { settings: withDefaults(initial.settings), catalog: initial.catalog ?? {} }
        }
        // 同步落下样式：这一步在首帧之前，不会看到默认配色。
        render(current.settings ?? DEFAULTS, current.catalog)

        ctx.slots.inject(TAB_SLOT, () => ctx.slots.register(
          { name: TAB_SLOT, id: ROW_ID, order: 40, label: () => strings().tab },
          SettingsPanel,
        ))

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
            render,
            reload() {
              const next = readConfigSync()
              if (next !== undefined) {
                current = { settings: withDefaults(next.settings), catalog: next.catalog ?? {} }
                render(current.settings, current.catalog)
              }
              return current
            },
          }
        } catch { /* 冻结的 globalThis 不值得让启动失败 */ }
      },
    }
  },
})
