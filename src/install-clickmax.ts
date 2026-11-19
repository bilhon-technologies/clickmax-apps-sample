// Install started in Clickmax: someone clicks "Install" in My apps or opens the app's install link,
// and the app did not start anything. The app learns about the installation in two ways, both
// here: Clickmax sends the browser to the Setup URL, or the app reads its installation list.

import { type AppInstallation, getInstallation, listInstallations } from '@clickmax/public-sdk'
import type { Config } from './config.ts'
import { type Installation, saveInstallation } from './installations.ts'

/** Path of the Setup URL route. Register `http://127.0.0.1:<PORT>/clickmax/setup` in My apps. */
export const SETUP_PATH = '/clickmax/setup'

/** Outcome of {@link handleSetup}, with a message the page can show as is. */
export type SetupResult =
  | { ok: true; installation: Installation; updated: boolean }
  | { ok: false; status: number; message: string }

/**
 * Handles the browser arriving at the Setup URL after an install in Clickmax.
 *
 * The query proves nothing: anyone can open this URL with any `installation_id` and
 * `workspace_id`. So the id is read back from Clickmax with the app's own credentials, which
 * answers only for an active installation of this app, and the workspace comes from that answer.
 * `workspace_id` in the query is ignored.
 *
 * The installation is also not tied to whoever is signed in to this app in the browser. A forged
 * link would otherwise let someone attach a workspace's installation to a victim's account (or
 * their own to a victim's workspace). To link an installation to an account, use the OAuth
 * install, where `state` binds the round trip to the browser that started it.
 *
 * @param config App credentials and login server.
 * @param query Query string Clickmax sent to the Setup URL.
 */
export async function handleSetup(config: Config, query: URLSearchParams): Promise<SetupResult> {
  const installationId = query.get('installation_id')
  if (!installationId) return { ok: false, status: 400, message: 'The Setup URL was opened without installation_id.' }

  const result = await getInstallation(
    { clientId: config.clientId, clientSecret: config.clientSecret, installationId },
    { authUrl: `${config.loginBaseUrl}/api/auth` },
  )
  if (!result.ok) {
    // `not_found` covers another app's id, a removed installation, an unknown or malformed id.
    const message =
      result.error.type === 'not_found'
        ? 'This is not an active installation of this app.'
        : `Could not check the installation: ${result.error.code} (${result.error.message})`
    return { ok: false, status: result.error.type === 'not_found' ? 404 : 502, message }
  }

  // `update`: the installation was already active and only its permissions changed in Clickmax.
  // Saving again is harmless either way; the flag only changes what the page says.
  const updated = query.get('setup_action') === 'update'
  return { ok: true, installation: saveVerified(result.value), updated }
}

/**
 * Reads one page of the app's installations and stores each one. Installs started in Clickmax
 * show up here even when the person never reached the Setup URL (closed the tab, or the app has
 * no Setup URL), as does the automatic install of a private app in its own workspace.
 *
 * @param config App credentials and login server.
 * @param page Page number, starting at 1.
 */
export async function discoverInstallations(config: Config, page: number) {
  const result = await listInstallations(
    { clientId: config.clientId, clientSecret: config.clientSecret, page, perPage: 50 },
    { authUrl: `${config.loginBaseUrl}/api/auth` },
  )
  if (result.ok) {
    // Suspended ones are listed too: their tokens are refused until the app is unlisted again,
    // but the installation still exists and comes back on its own.
    for (const installation of result.value.data) saveVerified(installation)
  }
  return result
}

/** Stores an installation that came from Clickmax with the app's credentials. */
function saveVerified(installation: AppInstallation): Installation {
  return saveInstallation({
    workspaceId: installation.workspace.id,
    workspaceName: installation.workspace.name,
    installationId: installation.id,
    source: 'clickmax',
    installedBy: undefined,
  })
}
