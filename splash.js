/**
 * 祀 · 开屏动画 — Host half.
 *
 * 移植自 dsh-splash-animation（MIT，见 THIRD_PARTY_NOTICES.md），并接入祀自己的
 * 配置：主题与开屏动画共用 `$DSH_HOME/dsh-theme-su/config.json`，设置页也共用
 * 「祀」这一页，所以用户不需要装两个插件。
 *
 * 宿主负责浏览器做不到的部分：
 *   1. 解析用户填的本机路径，并用 HTTP Range 分段发送视频，让大文件边下边播；
 *   2. 需要时打开本机文件选择框（Electron 对话框 / Windows PowerShell / macOS /
 *      Linux）；
 *   3. 把当前生效的媒体信息放进 /dsh-theme-su/config.json，浏览器端不做二次读取。
 *
 * 与主题一样零运行时依赖：只 import Node 内建模块。
 *
 * @module dsh-theme-su/splash
 */

import { spawn } from 'node:child_process'
import { createReadStream, existsSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 本包目录；自带素材与文件选择脚本都相对它解析。 */
const PACKAGE_DIR = resolve(fileURLToPath(new URL('./', import.meta.url)))

/** 自带开场视频；用户没有填路径时播放它。 */
export const BUNDLED_SPLASH = join(PACKAGE_DIR, 'assets', 'splash-default.mp4')

/** 开屏动画的两个专用路由（配置读写复用主题的 /dsh-theme-su/config）。 */
export const SPLASH_MEDIA_ROUTE = '/dsh-theme-su/splash/asset'
export const SPLASH_PICK_ROUTE = '/dsh-theme-su/splash/pick'

/**
 * 支持的媒体格式：扩展名（无点、小写）→ MIME。
 *
 * `.mov` / `.mkv` 是容器而不是编码，能不能播取决于里面的编码；浏览器端会在
 * 运行时用 `canPlayType` 探测，这里只负责把容器标成正确的 MIME。
 */
const FORMATS = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
  ogm: 'video/ogg',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  ts: 'video/mp2t',
  gif: 'image/gif',
  apng: 'image/apng',
  webp: 'image/webp',
  avif: 'image/avif',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
}

/** 这些扩展名本身就是动画/图像，用 `<img>` 而不是 `<video>` 显示。 */
const IMAGE_KIND = new Set(['gif', 'apng', 'webp', 'avif', 'png', 'jpg', 'jpeg', 'svg', 'bmp', 'ico'])

/** 支持 Range 的容器，只有它们才回 206。 */
const SEEKABLE = new Set(['video/mp4', 'video/webm', 'video/x-matroska', 'video/ogg', 'video/quicktime', 'video/mp2t'])

/** 允许的最大媒体文件，防止手滑填了个巨大文件。 */
const MAX_MEDIA_BYTES = 4096 * 1024 * 1024

/** 本机文件对话框最多开多久。 */
const PICK_TIMEOUT_MS = 5 * 60 * 1000

/** @returns 小写扩展名，不带点。 */
function extensionOf(file) {
  return extname(file).replace(/^\./, '').toLowerCase()
}

/**
 * 把配置里的路径解析成绝对路径。
 *
 * `~` 与相对路径都支持：用户从设置页粘贴路径时不应该被迫写全盘符；相对路径
 * 相对 DSH home，而不是当前工作目录。
 * @param reference - 配置里的 `splashSrc`。
 * @param dshHome - DSH home 绝对路径。
 * @returns 绝对路径。
 */
function toAbsolutePath(reference, dshHome) {
  if (reference.startsWith('~/') || reference.startsWith('~\\')) return join(homedir(), reference.slice(2))
  if (isAbsolute(reference)) return resolve(reference)
  return resolve(dshHome, reference)
}

/**
 * 解析当前要播放的媒体。
 *
 * 空字符串表示「没填」——使用自带视频；填了路径就只认这个文件，坏了就报错，
 * 不会偷偷回退到自带视频（换了用户没选的片子比不播更糟）。
 * @param src - 配置里的 `splashSrc`。
 * @param dshHome - DSH home 绝对路径。
 * @returns 媒体描述，或 `{ configured: false }`。
 */
export function resolveSplashMedia(src, dshHome) {
  const reference = typeof src === 'string' ? src.trim() : ''

  if (reference === '') {
    if (!existsSync(BUNDLED_SPLASH)) return { configured: false, source: 'unset' }
    const bundled = resolveMedia(BUNDLED_SPLASH, dshHome)
    if (bundled.configured !== true) return { configured: false, source: 'unset' }
    return { ...bundled, source: 'bundled' }
  }

  return { ...resolveMedia(reference, dshHome), source: 'chosen' }
}

/**
 * 描述一个具体文件，或说明为什么不能播。
 * @param src - 配置里的路径。
 * @param dshHome - DSH home 绝对路径。
 * @returns `{ configured: false }` 或带 `problem` 的媒体描述。
 */
export function resolveMedia(src, dshHome) {
  const reference = typeof src === 'string' ? src.trim() : ''
  if (reference === '') return { configured: false }

  const path = toAbsolutePath(reference, dshHome)
  const extension = extensionOf(path)
  const mime = FORMATS[extension]

  // 先判断存在与是否为文件，再判断扩展名：路径写错却报「格式不支持」会把用户
  // 引到错误的方向。
  if (!existsSync(path)) return { configured: true, problem: 'missing-file', extension, path }

  let stats
  try {
    stats = statSync(path)
  } catch {
    return { configured: true, problem: 'unreadable-file', extension, path }
  }
  if (!stats.isFile()) return { configured: true, problem: 'not-a-file', extension, path }
  if (mime === undefined) return { configured: true, problem: 'unsupported-format', extension, path }
  if (stats.size > MAX_MEDIA_BYTES) return { configured: true, problem: 'file-too-large', extension, path }

  return {
    configured: true,
    path,
    name: path.slice(path.lastIndexOf(sep) + 1),
    extension,
    mime,
    kind: IMAGE_KIND.has(extension) ? 'image' : 'video',
    bytes: stats.size,
    mtimeMs: Math.round(stats.mtimeMs),
  }
}

/**
 * 给浏览器端的媒体信息。
 * @param media - {@link resolveSplashMedia} 的结果。
 * @returns JSON 可序列化的描述；不可播时 `kind: 'none'`。
 */
function mediaPayload(media) {
  if (media.configured !== true || media.problem !== undefined) {
    return { kind: 'none', name: media.name, extension: media.extension }
  }
  return {
    url: `${SPLASH_MEDIA_ROUTE}/${encodeURIComponent(media.name)}`,
    name: media.name,
    kind: media.kind,
    mime: media.mime,
    extension: media.extension,
    bytes: media.bytes,
  }
}

/**
 * 配置接口里开屏动画那一块。
 * @param settings - 规范化后的完整配置。
 * @param dshHome - DSH home 绝对路径。
 * @returns 播放状态、媒体描述与设置页要显示的路径。
 */
export function splashWire(settings, dshHome) {
  const media = resolveSplashMedia(settings.splashSrc, dshHome)
  const playable = media.configured === true && media.problem === undefined
  return {
    engaged: settings.splashEnabled === true && playable,
    media: mediaPayload(media),
    problem: media.problem ?? null,
    source: media.source ?? null,
    // 设置页里显示实际在用的路径：没填时显示自带视频的绝对路径，避免输入框
    // 空着、下面却说「正在使用内置视频」。
    effectiveSrc: media.configured === true
      ? (media.source === 'bundled' ? BUNDLED_SPLASH : String(settings.splashSrc ?? '').trim())
      : '',
    chosen: media.source === 'chosen',
  }
}

/** 统一的 404 响应。 */
export function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end('not found')
}

/**
 * 解析一个 `Range` 头。
 * @param header - 原始 Range 头。
 * @param size - 文件总字节数。
 * @returns 闭区间，或 `undefined`。
 */
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim())
  if (match === null) return undefined
  const [, rawStart, rawEnd] = match
  let start
  let end
  if (rawStart === '') {
    if (rawEnd === '') return undefined
    start = Math.max(0, size - Number(rawEnd))
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return undefined
  return { start, end }
}

/**
 * 发送媒体文件，支持 Range 与条件请求。
 * @param req - HTTP 请求。
 * @param res - HTTP 响应。
 * @param media - {@link resolveSplashMedia} 的结果。
 */
export function serveSplashMedia(req, res, media) {
  const headers = {
    'Content-Type': media.mime,
    'Cache-Control': 'no-cache',
    'Accept-Ranges': SEEKABLE.has(media.mime) ? 'bytes' : 'none',
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
    ETag: `"${media.mtimeMs.toString(36)}-${media.bytes.toString(36)}"`,
  }

  if (req.headers['if-none-match'] === headers.ETag) {
    res.writeHead(304, headers)
    res.end()
    return
  }

  const seekable = SEEKABLE.has(media.mime)
  const range = seekable ? parseRange(req.headers.range, media.bytes) : undefined
  if (seekable && req.headers.range !== undefined && range === undefined) {
    res.writeHead(416, { ...headers, 'Content-Range': `bytes */${media.bytes}` })
    res.end()
    return
  }

  const start = range === undefined ? 0 : range.start
  const end = range === undefined ? media.bytes - 1 : range.end
  res.writeHead(range === undefined ? 200 : 206, {
    ...headers,
    'Content-Length': String(end - start + 1),
    ...range === undefined ? {} : { 'Content-Range': `bytes ${start}-${end}/${media.bytes}` },
  })

  if (req.method === 'HEAD') {
    res.end()
    return
  }

  const stream = createReadStream(media.path, { start, end })
  let failed = false
  stream.on('error', () => {
    failed = true
    try {
      res.destroy()
    } catch { /* socket 可能已经断了 */ }
  })
  res.on('close', () => {
    if (!failed) stream.destroy()
  })
  stream.pipe(res)
}

/**
 * 测试缝：让验证脚本替换文件选择器，不必真的弹窗。
 * @type {{ runCapture: ((command: string, args: string[], ctx?: unknown) => Promise<string | undefined>) | undefined }}
 */
export const __testHooks = { runCapture: undefined }

/**
 * 打开本机文件选择框。
 *
 * 优先 Electron 自己的对话框（桌面版就在 Electron 里），然后按平台回退到
 * PowerShell / osascript / zenity；都没有时返回 `undefined`，设置页会提示用户
 * 直接把路径填进输入框。
 * @param ctx - 插件上下文，用于日志。
 * @param initial - 起始路径。
 * @returns 选中的绝对路径、取消时的空串，或不可用时的 `undefined`。
 */
export async function pickSplashMedia(ctx, initial) {
  const electronResult = await pickViaElectron(initial)
  if (electronResult !== undefined) return electronResult
  if (process.platform === 'win32') return pickViaPowerShell(ctx, initial)
  if (process.platform === 'darwin') return pickViaOsa(initial)
  return pickViaZenity(initial)
}

/**
 * Electron 原生对话框。
 * @param initial - 起始路径。
 * @returns 路径、取消时的空串，或 Electron 不可用时的 `undefined`。
 */
async function pickViaElectron(initial) {
  if (process.versions.electron === undefined && process.type === undefined) return undefined
  let dialog
  try {
    const { createRequire } = await import('node:module')
    const require = createRequire(import.meta.url)
    dialog = (require('electron').dialog ?? require('electron/main')?.dialog)
  } catch {
    return undefined
  }
  if (dialog === undefined || typeof dialog.showOpenDialog !== 'function') return undefined
  try {
    const result = await dialog.showOpenDialog({
      title: 'Select a video or animated image for the DSH splash',
      properties: ['openFile'],
      defaultPath: initial === '' ? undefined : initial,
      filters: [
        { name: 'All supported media', extensions: [...Object.keys(FORMATS)] },
        { name: 'Video', extensions: Object.keys(FORMATS).filter((extension) => !IMAGE_KIND.has(extension)) },
        { name: 'Animated / still image', extensions: [...IMAGE_KIND] },
      ],
    })
    if (result.canceled === true || !Array.isArray(result.filePaths) || result.filePaths.length === 0) return ''
    return result.filePaths[0]
  } catch {
    return undefined
  }
}

/**
 * Windows PowerShell + WinForms 选择框。
 *
 * 选中的路径写进 UTF-8 临时文件而不是 stdout：控制台会按系统 ANSI 代码页
 * （中文 Windows 是 GBK）转码，非 ASCII 路径会变成乱码。
 * @param ctx - 插件上下文。
 * @param initial - 起始路径。
 * @returns 路径、取消时的空串，或不可用时的 `undefined`。
 */
function pickViaPowerShell(ctx, initial) {
  const script = join(PACKAGE_DIR, 'tools', 'pick-media-file.ps1')
  if (!existsSync(script)) {
    ctx.logger?.warn?.('dsh-theme-su: tools/pick-media-file.ps1 is missing from the installed package; the settings page keeps its text field.')
    return Promise.resolve(undefined)
  }
  const startDir = initial === '' ? '' : dirname(initial)
  const startFile = initial === '' ? '' : initial.slice(initial.lastIndexOf(sep) + 1)
  const carrier = join(tmpdir(), `dsh-theme-su-pick-${process.pid}-${Date.now()}.txt`)
  return (__testHooks.runCapture ?? runCapture)('powershell.exe', [
    '-NoProfile',
    // STA 必须：通用文件对话框是 COM 对象，MTA 线程上会抛异常。
    '-STA',
    '-ExecutionPolicy', 'Bypass',
    '-File', script,
    '-OutFile', carrier,
    '-InitialDirectory', startDir,
    '-InitialFile', startFile,
  ], ctx).then((output) => {
    if (output === undefined) return undefined
    try {
      if (!existsSync(carrier)) return ''
      return readFileSync(carrier, 'utf8').replace(/^\uFEFF/, '').trim()
    } catch {
      return undefined
    } finally {
      try {
        unlinkSync(carrier)
      } catch { /* 没创建或已经删掉了 */ }
    }
  })
}

/**
 * macOS AppleScript 回退。
 * @param initial - 起始路径。
 * @returns 路径、取消时的空串，或失败时的 `undefined`。
 */
function pickViaOsa(initial) {
  const prompt = 'Select a video or animated image for the DSH splash'
  const args = initial === ''
    ? ['-e', `POSIX path of (choose file with prompt "${prompt}")`]
    : ['-e', `POSIX path of (choose file with prompt "${prompt}" default location POSIX file "${initial}")`]
  return runCapture('osascript', args).then((output) => (output === undefined ? undefined : output.trim()))
}

/**
 * Linux zenity 回退。
 * @param initial - 起始路径。
 * @returns 路径、取消时的空串，或不可用时的 `undefined`。
 */
function pickViaZenity(initial) {
  return runCapture('zenity', [
    '--file-selection',
    '--title=Select a video or animated image for the DSH splash',
    ...initial === '' ? [] : [`--filename=${initial}`],
  ]).then((output) => (output === undefined ? undefined : output.trim()))
}

/**
 * 运行子进程并捕获 stdout（UTF-8），带超时。
 *
 * 按 Buffer 收集、最后一次性解码：逐块 `toString()` 会把跨块的多字节字符解成
 * 替换字符，和按控制台代码页读路径是同一类问题。
 * @param command - 可执行文件。
 * @param args - 参数。
 * @param ctx - 可选上下文，用于诊断。
 * @returns stdout；失败、超时或不可用时为 `undefined`。
 */
function runCapture(command, args, ctx) {
  return new Promise((resolveRun) => {
    let child
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      resolveRun(undefined)
      return
    }
    const outChunks = []
    let err = ''
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveRun(value)
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch { /* 已经结束 */ }
      finish(undefined)
    }, PICK_TIMEOUT_MS)
    child.stdout.on('data', (chunk) => {
      outChunks.push(chunk)
    })
    child.stderr.on('data', (chunk) => {
      err += chunk
    })
    child.on('error', (error) => {
      ctx?.logger?.warn?.(`dsh-theme-su: ${command} could not be started (${error.code ?? error.message}); the settings page keeps its text field.`)
      finish(undefined)
    })
    child.on('close', (code) => {
      if (code !== 0) {
        if (ctx !== undefined && err.trim() !== '') ctx.logger?.warn?.(`dsh-theme-su: ${command} exited ${code}: ${err.trim().slice(0, 400)}`)
        // 非零退出是环境问题，不是用户取消。
        return finish(undefined)
      }
      finish(Buffer.concat(outChunks).toString('utf8'))
    })
  })
}
