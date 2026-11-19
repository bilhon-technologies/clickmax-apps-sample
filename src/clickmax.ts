import { Clickmax, type ClickmaxError } from '@clickmax/public-sdk'
import type { Config } from './config.ts'
import { type Installation, markRemoved } from './installations.ts'

// One client per installation. The SDK keeps that installation's token inside the instance:
// tokens last 10 minutes, are reused until a minute before they expire, and a 401 triggers one
// renewal and retry. Reusing the instance avoids asking for a new token on every call.
const clients = new Map<string, Clickmax>()

/**
 * Client acting in the installation's workspace with the permissions that workspace granted.
 * Building it does not call Clickmax; the first API call requests the token.
 *
 * @param config App credentials and URLs.
 * @param installation Installation saved for the workspace.
 */
export function clientFor(config: Config, installation: Installation): Clickmax {
  let client = clients.get(installation.installationId)
  if (!client) {
    client = new Clickmax(
      {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        installationId: installation.installationId,
      },
      { baseUrl: config.apiBaseUrl, authUrl: `${config.loginBaseUrl}/api/auth` },
    )
    clients.set(installation.installationId, client)
  }
  return client
}

/**
 * Reacts to a failed call. When Clickmax no longer accepts the installation (an admin removed the
 * app in "Apps instalados", or the app went back to private), the token request fails with
 * `invalid_grant` and the app has nothing left to retry: it marks the workspace as disconnected
 * and drops the client until someone installs again.
 *
 * @param installation Installation the call was made for.
 * @param error Error from the SDK result.
 * @returns A short explanation for the page.
 */
export function handleApiError(installation: Installation, error: ClickmaxError): string {
  if (error.type === 'authentication' && error.code === 'invalid_grant') {
    markRemoved(installation.workspaceId)
    clients.delete(installation.installationId)
    return 'Clickmax no longer accepts this installation. Install the app again in this workspace.'
  }
  if (error.type === 'permission') {
    // Permissions the workspace has not granted yet stay pending until an admin approves them.
    return 'The installation lacks a permission this call needs. An admin can approve pending permissions in "Apps instalados".'
  }
  return error.message
}
