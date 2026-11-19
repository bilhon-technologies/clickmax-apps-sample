// Install started by the app: the customer clicks "Connect with Clickmax" here, chooses a
// workspace on Clickmax and comes back with a code. This module owns that round trip and nothing
// else; what happens with the resulting installation lives in `installations.ts`.

import { createHash, randomBytes } from 'node:crypto'
import { exchangeInstallCode } from '@clickmax/public-sdk'
import type { Config } from './config.ts'
import { type Installation, saveInstallation } from './installations.ts'

/** Values that must survive the trip to Clickmax and back, kept server-side per browser. */
export interface PendingInstall {
  state: string
  codeVerifier: string
  createdAt: number
}

/** An authorization older than this is refused, so abandoned attempts do not pile up. */
const PENDING_TTL_MS = 10 * 60 * 1000

const base64url = (bytes: Buffer) => bytes.toString('base64url')

/**
 * Builds the authorize URL for a new install.
 *
 * - PKCE: the verifier stays on this server and only its SHA-256 goes in the URL, so a code
 *   intercepted on the way back cannot be exchanged by anyone else.
 * - `state`: random per attempt and checked on return, so another site cannot send the browser to
 *   the callback with a code of its own (CSRF).
 * - `install` in the scope is what creates the installation; `openid email` add an ID token with
 *   the e-mail of the person who installed.
 *
 * @param config Client id, login server and redirect URL.
 * @returns The URL to redirect the browser to and the values to keep for the callback.
 */
export function startInstall(config: Config): { url: string; pending: PendingInstall } {
  const codeVerifier = base64url(randomBytes(32))
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest())
  const state = base64url(randomBytes(16))

  const url = new URL(`${config.loginBaseUrl}/api/auth/oauth2/authorize`)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUrl,
    scope: 'openid email install',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  }).toString()

  return { url: url.toString(), pending: { state, codeVerifier, createdAt: Date.now() } }
}

/** Outcome of {@link finishInstall}, with a message the page can show as is. */
export type FinishInstallResult =
  | { ok: true; installation: Installation }
  | { ok: false; status: number; message: string }

/**
 * Handles the redirect back from Clickmax: checks `state`, exchanges the code for the installation
 * with the client secret and the PKCE verifier, and saves it.
 *
 * @param config App credentials and URLs.
 * @param query Query string Clickmax sent to the redirect URL.
 * @param pending What {@link startInstall} returned for this browser, if anything.
 */
export async function finishInstall(
  config: Config,
  query: URLSearchParams,
  pending: PendingInstall | undefined,
): Promise<FinishInstallResult> {
  const error = query.get('error')
  if (error) {
    // `access_denied` means the person clicked "Recusar"; there is no code and nothing installed.
    return { ok: false, status: 400, message: `Clickmax did not install the app: ${error}` }
  }
  if (!pending || Date.now() - pending.createdAt > PENDING_TTL_MS) {
    return { ok: false, status: 400, message: 'This install was not started here or has expired. Start again.' }
  }
  if (query.get('state') !== pending.state) {
    return { ok: false, status: 400, message: 'The state does not match. Start the install again.' }
  }

  const result = await exchangeInstallCode(
    {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code: query.get('code') ?? '',
      codeVerifier: pending.codeVerifier,
      redirectUri: config.redirectUrl,
    },
    { authUrl: `${config.loginBaseUrl}/api/auth` },
  )
  if (!result.ok) {
    // `invalid_grant`: the code expired, was already used, or the installation was removed
    // before the exchange. Starting again is always safe.
    return { ok: false, status: 502, message: `Code exchange failed: ${result.error.code} (${result.error.message})` }
  }

  const { workspaceId, installationId, idToken } = result.value
  const installation = saveInstallation({ workspaceId, installationId, installedBy: emailFromIdToken(idToken) })
  return { ok: true, installation }
}

/**
 * Reads `email` from the ID token without checking its signature. Good enough for display: the
 * token came straight from Clickmax's token endpoint over TLS. Verify it against the JWKS before
 * using it to sign someone in.
 *
 * @param idToken ID token from the code exchange.
 */
function emailFromIdToken(idToken: string | undefined): string | undefined {
  const payload = idToken?.split('.')[1]
  if (!payload) return undefined
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    const email = (claims as { email?: unknown }).email
    return typeof email === 'string' ? email : undefined
  } catch {
    return undefined
  }
}
