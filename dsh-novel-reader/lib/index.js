/**
 * dsh-novel-reader host half: same-origin HTTP routes for novel search and
 * chapter/text fetching, so the browser half never faces CORS. Search uses
 * the verified netstart yunyuedu JSON API; arbitrary page fetch uses a
 * readability-style main-text extraction so users can point it at any
 * configurable source. No text is persisted host-side — the browser owns the
 * library (IndexedDB).
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
const MAX_PAGE_BYTES = 4 * 1024 * 1024
const MAX_BOOK_BYTES = 40 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15000
const BOOK_TIMEOUT_MS = 120000

/** Send a JSON response. */
function sendJson(response, status, data) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(data))
}

/** Read a JSON request body with a byte cap. */
function readBody(request, cap) {
  return new Promise((resolveBody, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > cap) { reject(new Error('body too large')); request.destroy(); return }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try { resolveBody(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch (error) { reject(error) }
    })
    request.on('error', reject)
  })
}

/** Guard: only same-origin loopback browser calls may use these routes. */
function sameOrigin(request) {
  const origin = request.headers.origin
  if (origin === undefined) return true // non-browser clients (curl) carry no Origin
  const host = request.headers.host
  if (typeof host !== 'string') return false
  try { return new URL(origin).host === host } catch { return false }
}

/** Fetch a URL as text with timeout, decoding utf-8/gbk by content-type or meta charset. */
async function fetchText(url, options) {
  const maxBytes = options?.maxBytes ?? MAX_PAGE_BYTES
  const timeoutMs = options?.timeoutMs ?? FETCH_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      redirect: 'follow',
    })
    if (!response.ok) throw new Error(`upstream ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > maxBytes) throw new Error('content too large')
    const contentType = response.headers.get('content-type') ?? ''
    let charset = /charset=([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase()
    if (charset === undefined) {
      const head = buffer.subarray(0, 4096).toString('latin1')
      charset = /charset=["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase()
    }
    if (charset !== undefined && charset !== 'utf-8' && charset !== 'utf8') {
      try {
        const decoder = new TextDecoder(charset === 'gb2312' ? 'gbk' : charset)
        return decoder.decode(buffer)
      } catch { return buffer.toString('utf8') }
    }
    // 无 charset 声明（TXT 直链常见）：UTF-8 严格解码失败则按 GBK 兜底
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    } catch {
      try { return new TextDecoder('gbk').decode(buffer) } catch { return buffer.toString('utf8') }
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Strip tags and collapse whitespace for extracted text. */
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Readability-style: pick the DOM-ish block with the most text as the main content. */
function extractMainText(html) {
  const candidates = []
  const blockRe = /<div[^>]*id="(content|chaptercontent|chapter|bookcontent|readcontent|maintext|article|text)"[^>]*>([\s\S]*?)<\/div>\s*(?:<div|<footer|<script|$)/gi
  let match
  while ((match = blockRe.exec(html)) !== null) {
    candidates.push({ id: match[1], html: match[2] })
  }
  if (candidates.length === 0) {
    // Fall back: largest <div> by text volume.
    const divRe = /<div[^>]*>([\s\S]*?)<\/div>/gi
    let best = null
    while ((match = divRe.exec(html)) !== null) {
      const text = htmlToText(match[1])
      if (best === null || text.length > best.length) best = { length: text.length, html: match[1] }
    }
    if (best !== null) return htmlToText(best.html)
    return htmlToText(html)
  }
  let best = candidates[0]
  let bestLen = 0
  for (const candidate of candidates) {
    const len = htmlToText(candidate.html).length
    if (len > bestLen) { bestLen = len; best = candidate }
  }
  return htmlToText(best.html)
}

/** netstart yunyuedu search (verified working). Returns normalized book rows. */
async function searchBooks(keyword) {
  const url = `https://apis.netstart.cn/yunyuedu/search/book.json?keyword=${encodeURIComponent(keyword)}`
  const raw = await fetchText(url)
  const data = JSON.parse(raw)
  const books = data?.data?.books ?? []
  return books
    .filter((book) => typeof book?.bookId === 'string' && !book.bookId.startsWith('audio_'))
    .slice(0, 30)
    .map((book) => ({
      id: book.bookId,
      title: String(book.title ?? ''),
      author: String(book.author ?? ''),
      category: String(book.category ?? ''),
      summary: String(book.summary ?? ''),
      cover: String(book.cover ?? ''),
      downloadable: false, // netstart 只给元信息，不给全文
    }))
}

// ── txt80（八零电子书）整本 TXT 适配器：搜索→书页→下载页→TXT 直链 ─────────
const TXT80_BASE = 'https://www.txt80.cc'

/** txt80 search: POST form, follow to result page, extract book-page links. */
async function txt80Search(keyword) {
  const form = new URLSearchParams()
  form.set('keyboard', keyword)
  form.set('show', 'title,softsay,softwriter')
  form.set('tbname', 'download')
  form.set('tempid', '1')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(`${TXT80_BASE}/e/search/index.php`, {
      method: 'POST',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })
    const html = await response.text()
    const links = []
    const seen = new Set()
    const re = /href="(\/[^"]*?txt\d+\.html)"/gi
    let match
    while ((match = re.exec(html)) !== null) {
      const path = match[1]
      if (seen.has(path)) continue
      seen.add(path)
      links.push(path)
      if (links.length >= 20) break
    }
    return links
  } finally {
    clearTimeout(timer)
  }
}

/** Parse a txt80 book page: title, author, summary, and the download-page path. */
function parseTxt80BookPage(html) {
  const titleMatch = /<title>([^<]+?)TXT下载/i.exec(html)
  const title = titleMatch !== null ? titleMatch[1].trim() : ''
  const authorMatch = /作者[：:]\s*([^<\s,，]{1,24})/.exec(html)
  const author = authorMatch !== null ? authorMatch[1].trim() : ''
  const descMatch = /<meta name="description" content="([^"]{0,400})/i.exec(html)
  const summary = descMatch !== null ? descMatch[1].replace(/\s+/g, ' ').trim() : ''
  const downMatch = /href="(\/down\/[^"]+?\.html)"/i.exec(html)
  const downPath = downMatch !== null ? downMatch[1] : null
  return { title, author, summary, downPath }
}

/** Enrich one search-result book-page link into a full row (with downPath). */
async function txt80BookFromPath(path) {
  const html = await fetchText(TXT80_BASE + path)
  const info = parseTxt80BookPage(html)
  if (info.downPath === null) throw new Error('no download link')
  return {
    id: 'txt80:' + path,
    title: info.title || path,
    author: info.author,
    category: '',
    summary: info.summary,
    cover: '',
    downloadable: true,
    downPath: info.downPath,
  }
}

/** Resolve a download page to the real TXT file URL. */
async function txt80ResolveTxtUrl(downPath) {
  const html = await fetchText(TXT80_BASE + downPath)
  // 直链含中文且可能带尾部空格，先粗取再修剪；优先 d.txt80 下载域
  const matches = html.match(/https?:\/\/d\.txt80\.[^"'<>\s]+\.txt/gi)
  const candidate = matches !== null && matches.length > 0
    ? matches[0]
    : (/(https?:\/\/[^"'<>\s]+\.txt)/i.exec(html) ?? [])[1]
  if (candidate === undefined) throw new Error('未找到 TXT 直链')
  return candidate.trim()
}

/** Route table. */
function mountRoutes(host) {
  const disposers = []

  disposers.push(host.webServer.register({
    kind: 'exact',
    path: '/novel-reader/search',
    handler: async (request, response) => {
      if (request.method !== 'POST') { response.writeHead(405, { allow: 'POST' }); response.end(); return }
      if (!sameOrigin(request)) return sendJson(response, 403, { error: 'untrusted origin' })
      try {
        const body = await readBody(request, 4096)
        const keyword = String(body.keyword ?? '').trim()
        if (keyword.length === 0) return sendJson(response, 400, { error: 'keyword required' })
        if (keyword.length > 60) return sendJson(response, 400, { error: 'keyword too long' })
        const books = await searchBooks(keyword)
        sendJson(response, 200, { ok: true, books })
      } catch (error) {
        sendJson(response, 502, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }))

  disposers.push(host.webServer.register({
    kind: 'exact',
    path: '/novel-reader/fetch',
    handler: async (request, response) => {
      if (request.method !== 'POST') { response.writeHead(405, { allow: 'POST' }); response.end(); return }
      if (!sameOrigin(request)) return sendJson(response, 403, { error: 'untrusted origin' })
      try {
        const body = await readBody(request, 4096)
        const url = String(body.url ?? '').trim()
        if (!/^https?:\/\//i.test(url)) return sendJson(response, 400, { error: 'http(s) url required' })
        const html = await fetchText(url)
        const text = extractMainText(html)
        if (text.length < 50) return sendJson(response, 422, { error: '提取到的正文过少，该页可能有反爬或非章节页' })
        const titleMatch = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
        const title = titleMatch !== null ? htmlToText(titleMatch[1]).slice(0, 80) : ''
        sendJson(response, 200, { ok: true, title, text, length: text.length })
      } catch (error) {
        sendJson(response, 502, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }))

  // 整本下载源搜索（txt80）：先拿书页链接，再并发补全每本的标题/作者/下载页
  disposers.push(host.webServer.register({
    kind: 'exact',
    path: '/novel-reader/txt80-search',
    handler: async (request, response) => {
      if (request.method !== 'POST') { response.writeHead(405, { allow: 'POST' }); response.end(); return }
      if (!sameOrigin(request)) return sendJson(response, 403, { error: 'untrusted origin' })
      try {
        const body = await readBody(request, 4096)
        const keyword = String(body.keyword ?? '').trim()
        if (keyword.length === 0) return sendJson(response, 400, { error: 'keyword required' })
        const paths = await txt80Search(keyword)
        const enriched = await Promise.all(
          paths.slice(0, 12).map((path) => txt80BookFromPath(path).catch(() => null)),
        )
        const books = enriched.filter((b) => b !== null && b.title.length > 0)
        sendJson(response, 200, { ok: true, books })
      } catch (error) {
        sendJson(response, 502, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }))

  // 整本 TXT 下载：解析下载页拿直链，抓取并按 GBK 解码成 UTF-8 文本返回
  disposers.push(host.webServer.register({
    kind: 'exact',
    path: '/novel-reader/download',
    handler: async (request, response) => {
      if (request.method !== 'POST') { response.writeHead(405, { allow: 'POST' }); response.end(); return }
      if (!sameOrigin(request)) return sendJson(response, 403, { error: 'untrusted origin' })
      try {
        const body = await readBody(request, 4096)
        const downPath = String(body.downPath ?? '').trim()
        if (downPath.length === 0) return sendJson(response, 400, { error: 'downPath required' })
        const txtUrl = await txt80ResolveTxtUrl(downPath)
        const text = await fetchText(txtUrl, { maxBytes: MAX_BOOK_BYTES, timeoutMs: BOOK_TIMEOUT_MS })
        if (text.length < 200) return sendJson(response, 422, { error: '下载到的内容过短，疑似失败' })
        sendJson(response, 200, { ok: true, text, length: text.length })
      } catch (error) {
        sendJson(response, 502, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }))

  return () => { for (const dispose of disposers) dispose() }
}

export const name = 'dsh-novel-reader'
export function apply(ctx) {
  ctx.inject(['webServer', 'loader'], (host) => {
    host.effect(() => mountRoutes(host), 'dsh-novel-reader: http routes')
  })
}
