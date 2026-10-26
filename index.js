/**
 * 祀（dsh-theme-su）— 主题插件，宿主端。
 *
 * 宿主负责浏览器做不到的三件事：
 *   1. 存用户的选择（`$DSH_HOME/dsh-theme-su/config.json`）；
 *   2. 把自带的壁纸 / 立绘 / 缩略图按需发给页面，也支持用户自己的图片；
 *   3. 在 index 响应里内联首帧样式，让第一帧就是宣纸色而不是先白闪。
 *
 * 零运行时依赖：插件以 link / file 安装时只会从自己的真实目录解析 import，
 * 依赖 DSH 安装树里的包会 ERR_MODULE_NOT_FOUND 并拖垮整个 profile。
 *
 * @module dsh-theme-su
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_DIR = resolve(fileURLToPath(new URL('./', import.meta.url)))
const ASSET_DIR = join(PACKAGE_DIR, 'assets')

const ROUTE_BASE = '/dsh-theme-su'
const CONFIG_ROUTE = `${ROUTE_BASE}/config.json`
const SAVE_ROUTE = `${ROUTE_BASE}/config`
const ASSET_ROUTE = `${ROUTE_BASE}/asset`
const CUSTOM_ROUTE = `${ROUTE_BASE}/wallpaper`

const STATE_DIRNAME = 'dsh-theme-su'

/** 壁纸预设。scroll = 水墨长卷，none = 素纸。 */
const WALLPAPERS = ['scroll', 'none']

/** 侧栏立绘。bust / su / side / front = 四张同尺度的半身。 */
const PORTRAITS = ['rotate', 'bust', 'su', 'side', 'front', 'none']

/** 强调色。si = 青玉（默认），ink = 墨（近无彩），moss = 苔绿。 */
const ACCENTS = ['si', 'ink', 'moss']

export const DEFAULTS = {
  enabled: true,
  wallpaper: 'scroll',
  wallpaperSrc: '',
  scrim: 50,
  portrait: 'rotate',
  portraitOpacity: 88,
  glass: true,
  radius: 1,
  accent: 'si',
  tint: 100,
}

const LIMITS = {
  scrim: [0, 100],
  portraitOpacity: [0, 100],
  radius: [0, 2],
  tint: [0, 100],
}

const MIME = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
}

const CUSTOM_EXT = new Set(Object.keys(MIME))
const MAX_CUSTOM_BYTES = 80 * 1024 * 1024

/**
 * 把任意来源的配置夹到合法范围；非法字段退回默认值而不是抛错，
 * 主题插件不该让 DSH 启动失败。
 * @param raw - patch 行里的 config 或状态文件内容。
 * @returns 规范化后的配置。
 */
export function normalizeConfig(raw) {
  const out = { ...DEFAULTS }
  if (typeof raw !== 'object' || raw === null) return out
  for (const key of Object.keys(DEFAULTS)) {
    const value = raw[key]
    if (value === undefined || value === null) continue
    const fallback = DEFAULTS[key]
    if (typeof fallback === 'boolean') {
      if (typeof value === 'boolean') out[key] = value
      continue
    }
    if (typeof fallback === 'number') {
      const num = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(num)) continue
      const [lo, hi] = LIMITS[key] ?? [fallback, fallback]
      out[key] = Math.round(Math.min(hi, Math.max(lo, num)))
      continue
    }
    if (typeof value !== 'string') continue
    const text = value.trim()
    if (key === 'wallpaper') out[key] = WALLPAPERS.includes(text) ? text : fallback
    else if (key === 'portrait') out[key] = PORTRAITS.includes(text) ? text : fallback
    else if (key === 'accent') out[key] = ACCENTS.includes(text) ? text : fallback
    else out[key] = text.slice(0, 4096)
  }
  return out
}

/**
 * 解析用户填的自定义壁纸路径。
 * @param src - 配置里的 wallpaperSrc。
 * @returns 可用时 `{ path, mime }`，否则 `{ problem }`。
 */
export function resolveCustomWallpaper(src) {
  if (typeof src !== 'string' || src.trim() === '') return { problem: 'empty' }
  let path = src.trim()
  if (path === '~' || path.startsWith('~/') || path.startsWith('~\\')) path = join(homedir(), path.slice(1))
  const absolute = isAbsolute(path) ? path : resolve(path)
  if (!existsSync(absolute)) return { problem: 'missing-file' }
  let stat
  try {
    stat = statSync(absolute)
  } catch {
    return { problem: 'unreadable-file' }
  }
  if (!stat.isFile()) return { problem: 'not-a-file' }
  const ext = extname(absolute).toLowerCase()
  if (!CUSTOM_EXT.has(ext)) return { problem: 'unsupported-format' }
  if (stat.size > MAX_CUSTOM_BYTES) return { problem: 'file-too-large' }
  return { path: absolute, mime: MIME[ext] }
}

function readState(dshHome) {
  const file = join(dshHome, STATE_DIRNAME, 'config.json')
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeState(dshHome, next) {
  const dir = join(dshHome, STATE_DIRNAME)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'config.json')
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
}

function bundledAssets() {
  try {
    return new Set(readdirSync(ASSET_DIR).filter((name) => MIME[extname(name).toLowerCase()] !== undefined))
  } catch {
    return new Set()
  }
}

/**
 * 三套配色的纸与墨。
 *
 * 素材是浅色水墨 + 苍绿角色，所以底色走暖象牙白而不是纯白：纯白会把
 * 画里的留白压成灰，也会让侧栏立绘的描边显得脏。
 */
const ACCENT_PALETTE = {
  si: { accent: '#2f6e5a', paper: '#f4f1e9', ink: '#121714', seam: 'rgba(47,110,90,0.18)' },
  ink: { accent: '#3b413e', paper: '#f3f2ee', ink: '#111312', seam: 'rgba(40,44,42,0.16)' },
  moss: { accent: '#5d7d4a', paper: '#f4f2e8', ink: '#14170f', seam: 'rgba(93,125,74,0.18)' },
}

/** 与主题 token 同源的首帧样式：只放最关键的几个变量和壁纸。 */
export function bootStyle(settings, assets) {
  if (settings.enabled !== true) return ''
  const palette = ACCENT_PALETTE[settings.accent] ?? ACCENT_PALETTE.si
  const tint = settings.tint / 100
  const alpha = (base) => (base * (0.55 + 0.45 * tint)).toFixed(3)
  const veil = (settings.scrim / 100).toFixed(3)
  const wallpaper = settings.wallpaper === 'none' ? null : assets.wallpaper
  const paperWall = wallpaper === null
    ? 'none'
    : `linear-gradient(200deg, rgba(247,244,236,${veil}) 0%, rgba(240,237,228,${(Number(veil) * 0.62).toFixed(3)}) 48%, rgba(233,232,222,${(Number(veil) * 0.78).toFixed(3)}) 100%),url("${wallpaper}")`
  const inkVeil = (Number(veil) * 1.3).toFixed(3)
  const inkWall = wallpaper === null
    ? 'none'
    : `linear-gradient(200deg, rgba(9,13,11,${inkVeil}) 0%, rgba(12,17,14,${(Number(inkVeil) * 0.66).toFixed(3)}) 48%, rgba(8,11,9,${(Number(inkVeil) * 0.86).toFixed(3)}) 100%),url("${wallpaper}")`
  return hardenTokens(`/* dsh-theme-su-boot */
html{background-color:${palette.paper}}
body[data-ds-dark-theme],html:has(body[data-ds-dark-theme]){background-color:${palette.ink}}
body{
background-color:${palette.paper};
background-image:${paperWall};
background-size:cover;background-position:center;background-repeat:no-repeat;background-attachment:fixed;
--dsw-alias-bg-base:rgba(249,246,239,${alpha(0.72)});
--dsw-alias-bg-layer-1:rgba(252,250,244,${alpha(0.86)});
--dsw-alias-bg-layer-2:rgba(254,252,247,${alpha(0.92)});
--dsw-specific-sidebar-fill:rgba(247,244,236,${alpha(0.34)});
}
body[data-ds-dark-theme]{
background-color:${palette.ink};
background-image:${inkWall};
--dsw-alias-bg-base:rgba(18,23,20,${alpha(0.74)});
--dsw-alias-bg-layer-1:rgba(24,30,26,${alpha(0.84)});
--dsw-alias-bg-layer-2:rgba(29,36,31,${alpha(0.90)});
--dsw-specific-sidebar-fill:rgba(13,18,15,${alpha(0.38)});
}`)
}

/**
 * 给整段样式里的自定义属性补 `!important`。
 *
 * ui-theme 的 `body{--dsw-*}` 样式表由它的客户端 bundle 注入，加载顺序在本插件
 * 之后，同优先级下会把这些值盖回去，面板重新变实、壁纸被挡掉。自定义属性支持
 * `!important`，统一在这里补比逐行手写更稳。
 * @param css - 未加固的 CSS。
 * @returns 加固后的 CSS。
 */
export function hardenTokens(css) {
  return String(css).replace(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/g, (_match, name, value) => `${name}:${value.trim()}!important;`)
}

/**
 * 挂载主题。
 * @param ctx - 插件上下文。
 * @param rawConfig - patch 行里的 config。
 */
export function apply(ctx, rawConfig) {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const patchConfig = normalizeConfig(rawConfig)
  const bundled = bundledAssets()

  const settings = () => {
    const stored = readState(dshHome)
    const merged = { ...patchConfig }
    for (const [key, value] of Object.entries(stored)) {
      if (key in DEFAULTS) merged[key] = value
    }
    return normalizeConfig(merged)
  }

  /** 资源目录：所有预设都给 URL，客户端按选择取用。 */
  const catalogFor = () => {
    const url = (name) => (bundled.has(name) ? `${ASSET_ROUTE}/${name}` : null)
    return {
      'wallpaper-scroll': url('wallpaper-scroll.webp'),
      bust: url('bust.webp'),
      su: url('bust-su.webp'),
      side: url('bust-side.webp'),
      front: url('bust-front.webp'),
      icon: url('icon-256.png'),
      mascot: url('mascot.webp'),
      banner: url('banner.webp'),
    }
  }

  /** 当前生效的壁纸（自定义优先）。 */
  const artworkFor = (current) => {
    const custom = resolveCustomWallpaper(current.wallpaperSrc)
    const customOk = custom.path !== undefined
    const presetFile = 'wallpaper-scroll.webp'
    const customUrl = customOk ? `${CUSTOM_ROUTE}?v=${Math.floor(statSync(custom.path).mtimeMs)}` : null
    return {
      catalog: { ...catalogFor(), custom: customUrl },
      wallpaper: current.wallpaper === 'none'
        ? null
        : customOk
          ? customUrl
          : bundled.has(presetFile)
            ? `${ASSET_ROUTE}/${presetFile}`
            : null,
      customProblem: customOk || current.wallpaperSrc.trim() === '' ? null : (custom.problem ?? null),
    }
  }

  const wire = () => {
    const current = settings()
    const art = artworkFor(current)
    return {
      version: 1,
      settings: current,
      catalog: art.catalog,
      assets: art,
      engaged: current.enabled === true,
    }
  }

  // 首帧样式必须同步登记：注入表在宿主启动时收集，晚于收集的 handler 不参与。
  ctx.on('webserver/index-inject', (table) => {
    try {
      if (!Array.isArray(table)) return
      if (table.some((row) => row && row.kind === 'style' && typeof row.text === 'string' && row.text.includes('dsh-theme-su-boot'))) return
      const current = settings()
      const css = bootStyle(current, artworkFor(current))
      if (css === '') return
      table.push({ kind: 'style', text: css })
    } catch { /* 渲染首页不能因为主题失败 */ }
  })

  ctx.inject(['webServer'], (scoped) => {
    /** 只服务本机已认证的客户端。 */
    const guard = (req, res) => {
      let connection
      try {
        connection = scoped.get('connection')
      } catch {
        connection = undefined
      }
      if (connection === undefined || typeof connection.requestRejection !== 'function') return false
      const rejection = connection.requestRejection(req)
      if (rejection === undefined) return false
      res.writeHead(rejection)
      res.end()
      return true
    }

    scoped.effect(() => scoped.webServer.register({
      kind: 'exact',
      path: CONFIG_ROUTE,
      handler: (req, res) => {
        if (guard(req, res)) return
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify(wire()))
      },
    }))

    scoped.effect(() => scoped.webServer.register({
      kind: 'exact',
      path: SAVE_ROUTE,
      handler: async (req, res) => {
        if (guard(req, res)) return
        if (req.method !== 'POST') {
          res.writeHead(405, { Allow: 'POST' })
          res.end()
          return
        }
        const body = await readJson(req, 64 * 1024)
        if (body === undefined) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: 'invalid-body' }))
          return
        }
        const next = normalizeConfig({ ...readState(dshHome), ...body })
        try {
          writeState(dshHome, next)
        } catch (error) {
          ctx.logger.warn(`dsh-theme-su: 无法写入配置（${error.code ?? error.message}）`)
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: 'write-failed' }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ ok: true, ...wire() }))
      },
    }))

    scoped.effect(() => scoped.webServer.register({
      kind: 'prefix',
      path: ASSET_ROUTE,
      handler: (req, res) => {
        if (guard(req, res)) return
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { Allow: 'GET, HEAD' })
          res.end()
          return
        }
        let name
        try {
          name = decodeURIComponent(String(req.url ?? '').slice(ASSET_ROUTE.length).replace(/^\//, '').split('?')[0])
        } catch {
          res.writeHead(400)
          res.end()
          return
        }
        if (!bundled.has(name) || name.includes('/') || name.includes('\\')) {
          res.writeHead(404)
          res.end()
          return
        }
        sendFile(req, res, join(ASSET_DIR, name), MIME[extname(name).toLowerCase()], true)
      },
    }))

    scoped.effect(() => scoped.webServer.register({
      kind: 'exact',
      path: CUSTOM_ROUTE,
      handler: (req, res) => {
        if (guard(req, res)) return
        const custom = resolveCustomWallpaper(settings().wallpaperSrc)
        if (custom.path === undefined) {
          res.writeHead(404)
          res.end()
          return
        }
        sendFile(req, res, custom.path, custom.mime, false)
      },
    }))
  })
}

async function readJson(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) return undefined
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * 发送一个图片文件；自带资源长缓存，用户文件按 mtime 校验。
 */
function sendFile(req, res, path, mime, bundledAsset) {
  let stat
  try {
    stat = statSync(path)
  } catch {
    res.writeHead(404)
    res.end()
    return
  }
  if (!stat.isFile()) {
    res.writeHead(404)
    res.end()
    return
  }
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
  const headers = {
    'Content-Type': mime ?? 'application/octet-stream',
    'Cache-Control': bundledAsset ? 'public, max-age=86400' : 'no-cache',
    ETag: etag,
    'Last-Modified': new Date(stat.mtimeMs).toUTCString(),
  }
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers)
    res.end()
    return
  }
  headers['Content-Length'] = String(stat.size)
  res.writeHead(200, headers)
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  res.end(readFileSync(path))
}

export const __testHooks = { assetDir: ASSET_DIR, routeBase: ROUTE_BASE }
