/** Settings read from the environment once, at startup. */
export interface Config {
  clientId: string
  clientSecret: string
  /** Login server origin, such as `https://login.clickmax.io`. */
  loginBaseUrl: string
  /** API root, such as `https://mcp.clickmax.io/api/v0`. */
  apiBaseUrl: string
  /** Redirect URL registered in the app; Clickmax sends the browser back here. */
  redirectUrl: string
  port: number
}

const VARIABLES = [
  'CLICKMAX_CLIENT_ID',
  'CLICKMAX_CLIENT_SECRET',
  'CLICKMAX_LOGIN_BASE_URL',
  'CLICKMAX_API_BASE_URL',
  'CLICKMAX_REDIRECT_URL',
  'PORT',
] as const

/**
 * Reads every variable listed in `.env.example` and exits with a message naming the missing ones,
 * so a misconfigured server never starts half working.
 *
 * @param env Usually `process.env`.
 */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const missing = VARIABLES.filter((name) => !env[name])
  if (missing.length > 0) {
    fail(`Missing environment variables: ${missing.join(', ')}. Copy .env.example to .env and fill them in.`)
  }
  const value = (name: (typeof VARIABLES)[number]) => env[name] as string

  const port = Number(value('PORT'))
  if (!Number.isInteger(port) || port <= 0 || port > 65535) fail(`PORT is not a valid port: ${value('PORT')}`)

  for (const name of ['CLICKMAX_LOGIN_BASE_URL', 'CLICKMAX_API_BASE_URL', 'CLICKMAX_REDIRECT_URL'] as const) {
    if (!URL.canParse(value(name))) fail(`${name} is not a URL: ${value(name)}`)
  }

  return {
    clientId: value('CLICKMAX_CLIENT_ID'),
    clientSecret: value('CLICKMAX_CLIENT_SECRET'),
    loginBaseUrl: value('CLICKMAX_LOGIN_BASE_URL').replace(/\/+$/, ''),
    apiBaseUrl: value('CLICKMAX_API_BASE_URL').replace(/\/+$/, ''),
    redirectUrl: value('CLICKMAX_REDIRECT_URL'),
    port,
  }
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
