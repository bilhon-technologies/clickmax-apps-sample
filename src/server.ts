import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { clientFor, handleApiError } from './clickmax.ts'
import { loadConfig } from './config.ts'
import { escapeHtml, json, page } from './html.ts'
import { finishInstall, type PendingInstall, startInstall } from './install-oauth.ts'
import { getInstallation, listInstallations } from './installations.ts'

const config = loadConfig(process.env)

// Install attempts in progress, keyed by a random cookie. The PKCE verifier and `state` never
// reach the browser; the cookie only says which attempt is this browser's.
const pendingInstalls = new Map<string, PendingInstall>()
const SESSION_COOKIE = 'sample_session'

/** Session id from the cookie, creating one when the browser has none. */
function sessionId(req: IncomingMessage, res: ServerResponse): string {
  const match = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([\\w-]+)`).exec(req.headers.cookie ?? '')
  if (match?.[1]) return match[1]
  const id = randomBytes(16).toString('base64url')
  res.setHeader('set-cookie', `${SESSION_COOKIE}=${id}; HttpOnly; SameSite=Lax; Path=/`)
  return id
}

function send(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(html)
}

/** Home page: the install button and the workspaces this app knows about. */
function home(): string {
  const rows = listInstallations()
    .map(
      (item) => `<tr>
  <td><a href="/workspaces/${encodeURIComponent(item.workspaceId)}">${escapeHtml(item.workspaceId)}</a></td>
  <td>${escapeHtml(item.installedBy ?? '')}</td>
  <td>${item.installedAt.toISOString()}</td>
  <td>${item.removedAt ? `Removed (${item.removedAt.toISOString()})` : 'Active'}</td>
</tr>`,
    )
    .join('')
  return page(
    'Home',
    `<p><a class="button" href="/install">Connect with Clickmax</a></p>
<h2>Workspaces</h2>
${rows ? `<table><tr><th>Workspace</th><th>Installed by</th><th>Installed at</th><th>Status</th></tr>${rows}</table>` : '<p>No workspace has installed the app yet.</p>'}`,
  )
}

/** Example calls the workspace page offers. */
const CALLS = {
  tags: { label: 'List tags', run: (c: ReturnType<typeof clientFor>) => c.tags.list() },
  leads: {
    label: 'Search leads',
    run: (c: ReturnType<typeof clientFor>) => c.leads.search({ filters: [], page: 1, perPage: 5 }),
  },
} as const

/** Workspace page; runs one example call when `action` names one. */
async function workspace(workspaceId: string, action: string | undefined): Promise<[number, string]> {
  const installation = getInstallation(workspaceId)
  if (!installation) return [404, page('Not found', '<p class="error">This workspace has not installed the app.</p>')]

  let outcome = ''
  if (action) {
    const call = CALLS[action as keyof typeof CALLS]
    if (!call) return [404, page('Not found', '<p class="error">Unknown action.</p>')]
    const result = await call.run(clientFor(config, installation))
    outcome = result.ok
      ? `<div class="ok">${escapeHtml(call.label)}: OK</div>${json(result.value)}`
      : `<div class="error">${escapeHtml(call.label)} failed: ${escapeHtml(handleApiError(installation, result.error))}</div>${json(
          { type: result.error.type, code: result.error.code, status: result.error.status },
        )}`
  }

  const buttons = Object.entries(CALLS)
    .map(
      ([key, call]) =>
        `<form method="post" action="/workspaces/${encodeURIComponent(workspaceId)}/${key}"><button>${escapeHtml(call.label)}</button></form>`,
    )
    .join(' ')
  return [
    200,
    page(
      'Workspace',
      `<p>Workspace <code>${escapeHtml(workspaceId)}</code>, installation <code>${escapeHtml(installation.installationId)}</code>${
        installation.removedAt ? ' <strong>(removed: install again)</strong>' : ''
      }</p>
<p>${buttons}</p>
${outcome}`,
    ),
  ]
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', config.redirectUrl)
  try {
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, home())

    if (req.method === 'GET' && url.pathname === '/install') {
      const { url: authorizeUrl, pending } = startInstall(config)
      pendingInstalls.set(sessionId(req, res), pending)
      res.writeHead(302, { location: authorizeUrl })
      return res.end()
    }

    if (req.method === 'GET' && url.pathname === new URL(config.redirectUrl).pathname) {
      const id = sessionId(req, res)
      const pending = pendingInstalls.get(id)
      // One attempt, one callback: a replayed callback finds nothing to match.
      pendingInstalls.delete(id)
      const result = await finishInstall(config, url.searchParams, pending)
      if (!result.ok) return send(res, result.status, page('Install failed', `<p class="error">${escapeHtml(result.message)}</p>`))
      res.writeHead(302, { location: `/workspaces/${encodeURIComponent(result.installation.workspaceId)}` })
      return res.end()
    }

    const match = /^\/workspaces\/([^/]+)(?:\/(\w+))?$/.exec(url.pathname)
    if (match?.[1] && (req.method === 'GET' || req.method === 'POST')) {
      const action = req.method === 'POST' ? match[2] : undefined
      const [status, html] = await workspace(decodeURIComponent(match[1]), action)
      return send(res, status, html)
    }

    send(res, 404, page('Not found', '<p>Not found.</p>'))
  } catch (error) {
    console.error(error)
    send(res, 500, page('Error', '<p class="error">Unexpected error. See the server log.</p>'))
  }
})

server.listen(config.port, '127.0.0.1', () => {
  console.log(`Listening on http://127.0.0.1:${config.port}`)
  console.log(`Redirect URL: ${config.redirectUrl}`)
})
