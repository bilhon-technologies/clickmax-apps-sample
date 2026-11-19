import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { clientFor, handleApiError } from './clickmax.ts'
import { loadConfig } from './config.ts'
import { escapeHtml, json, page } from './html.ts'
import { discoverInstallations, handleSetup, SETUP_PATH } from './install-clickmax.ts'
import { finishInstall, type PendingInstall, startInstall } from './install-oauth.ts'
import { storedInstallation, storedInstallations } from './installations.ts'

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
  const rows = storedInstallations()
    .map(
      (item) => `<tr>
  <td><a href="/workspaces/${encodeURIComponent(item.workspaceId)}">${escapeHtml(item.workspaceName ?? item.workspaceId)}</a></td>
  <td>${item.source === 'oauth' ? 'Connect button' : 'From Clickmax'}</td>
  <td>${escapeHtml(item.installedBy ?? '')}</td>
  <td>${item.installedAt.toISOString()}</td>
  <td>${item.removedAt ? `Removed (${item.removedAt.toISOString()})` : 'Active'}</td>
</tr>`,
    )
    .join('')
  return page(
    'Home',
    `<p><a class="button" href="/install">Connect with Clickmax</a> <a href="/installations">Installations on Clickmax</a></p>
<h2>Workspaces</h2>
${rows ? `<table><tr><th>Workspace</th><th>Installed through</th><th>Installed by</th><th>Installed at</th><th>Status</th></tr>${rows}</table>` : '<p>No workspace has installed the app yet.</p>'}`,
  )
}

/** One page of the app's installation list, read from Clickmax and stored as it goes. */
async function installationsPage(pageNumber: number): Promise<[number, string]> {
  const result = await discoverInstallations(config, pageNumber)
  if (!result.ok) {
    return [502, page('Installations', `<p class="error">Could not list installations: ${escapeHtml(result.error.code)} (${escapeHtml(result.error.message)})</p>`)]
  }
  const { data, meta } = result.value
  const rows = data
    .map(
      (item) => `<tr>
  <td><a href="/workspaces/${encodeURIComponent(item.workspace.id)}">${escapeHtml(item.workspace.name)}</a></td>
  <td><code>${escapeHtml(item.id)}</code></td>
  <td>${item.grantedCapabilities.length}</td>
  <td>${item.pendingCapabilities.length}</td>
  <td>${item.suspended ? 'Suspended (app is private)' : 'Active'}</td>
  <td>${escapeHtml(item.createdAt)}</td>
</tr>`,
    )
    .join('')
  const pager = [
    pageNumber > 1 ? `<a href="/installations?page=${pageNumber - 1}">Previous</a>` : '',
    pageNumber < meta.countPages ? `<a href="/installations?page=${pageNumber + 1}">Next</a>` : '',
  ].join(' ')
  return [
    200,
    page(
      'Installations',
      `<p>${meta.countItens} installations, page ${pageNumber} of ${Math.max(meta.countPages, 1)}. Removed installations are not listed.</p>
${rows ? `<table><tr><th>Workspace</th><th>Installation</th><th>Granted</th><th>Pending</th><th>Status</th><th>Installed at</th></tr>${rows}</table>` : '<p>No installations on this page.</p>'}
<p>${pager}</p>`,
    ),
  ]
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
  const installation = storedInstallation(workspaceId)
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

    if (req.method === 'GET' && url.pathname === SETUP_PATH) {
      // No `sessionId` here on purpose: see `handleSetup` for why this request must not be tied
      // to whoever is signed in to the app in this browser.
      const result = await handleSetup(config, url.searchParams)
      if (!result.ok) return send(res, result.status, page('Setup failed', `<p class="error">${escapeHtml(result.message)}</p>`))
      const { installation, updated } = result
      const name = escapeHtml(installation.workspaceName ?? installation.workspaceId)
      return send(
        res,
        200,
        page(
          updated ? 'Permissions updated' : 'Installed',
          `<div class="ok">${updated ? `The permissions of the app in ${name} were updated.` : `The app is installed in ${name}.`}</div>
<p><a class="button" href="/workspaces/${encodeURIComponent(installation.workspaceId)}">Open workspace</a></p>`,
        ),
      )
    }

    if (req.method === 'GET' && url.pathname === '/installations') {
      const pageNumber = Number(url.searchParams.get('page') ?? '1')
      const [status, html] = await installationsPage(Number.isSafeInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1)
      return send(res, status, html)
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

/**
 * Reads every page of the installation list once at startup. The store here lives in memory, so
 * this brings back the workspaces after a restart; a real app would run it periodically to catch
 * installs whose Setup URL visit never happened.
 */
async function syncInstallations(): Promise<void> {
  for (let pageNumber = 1; ; pageNumber++) {
    const result = await discoverInstallations(config, pageNumber)
    if (!result.ok) {
      console.error(`Installation list failed: ${result.error.code} (${result.error.message})`)
      return
    }
    if (pageNumber >= result.value.meta.countPages) {
      console.log(`Installations on Clickmax: ${result.value.meta.countItens}`)
      return
    }
  }
}

server.listen(config.port, '127.0.0.1', () => {
  console.log(`Listening on http://127.0.0.1:${config.port}`)
  console.log(`Redirect URL: ${config.redirectUrl}`)
  console.log(`Setup URL: http://127.0.0.1:${config.port}${SETUP_PATH}`)
  void syncInstallations()
})
