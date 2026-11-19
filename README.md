# clickmax-apps-sample

A small Node server that acts as a third-party system integrating with Clickmax as a [Clickmax App](https://docs.clickmax.io/en/reference/api/clickmax-apps). A workspace admin clicks **Connect with Clickmax**, picks a workspace on Clickmax and approves the permissions. The sample stores the installation and then calls the [Clickmax API](https://docs.clickmax.io/en/reference/api) for that workspace: it lists tags and searches leads.

The OAuth start (PKCE, `state` and the authorize URL) is written out in [`src/install-oauth.ts`](./src/install-oauth.ts), since that is the part every integration builds itself. The code exchange, installation tokens and API calls go through the TypeScript SDK, [`@clickmax/public-sdk`](https://docs.clickmax.io/en/reference/api/sdk).

## Requirements

- Node.js 22.18 or later. The server runs the TypeScript files directly with Node's type stripping, so there is no build step.
- `@clickmax/public-sdk` 12.5.15 or later, for app credentials.
- Permission to manage apps in the Clickmax workspace that creates the app. Owners and admins have it.

## Create the app

In Clickmax, open **Settings > Connections**, go to the **My apps** tab (**Meus apps** in Portuguese) and click **Create app**.

|Field|Value|
|-|-|
|Name|Any name. People see it when they install the app.|
|Redirect URLs|`http://127.0.0.1:3000/callback`, or your own `CLICKMAX_REDIRECT_URL`. `http` is accepted only on `localhost`, `127.0.0.1` and `[::1]`; use `https` anywhere else.|
|Requested permissions|**Leads > Ver**, **Etiquetas > Ver** and **Listas e segmentos > Ver** (`leads:read`, `tags:read`, `segments:read`). The lead search needs all three.|
|Who can install|**Private** while you test in your own workspace. **Unlisted** lets any workspace install the app from your system.|

After **Create app**, copy the client ID and the client secret. The secret is shown only once.

## Run

```sh
git clone https://github.com/bilhon-technologies/clickmax-apps-sample
cd clickmax-apps-sample
npm install
cp .env.example .env   # fill in the client ID and secret
npm start
```

Open `http://127.0.0.1:3000` and click **Connect with Clickmax**. The server reads every variable in [`.env.example`](./.env.example) and exits with the names of the missing ones.

|Variable|Example|
|-|-|
|`CLICKMAX_CLIENT_ID`|Client ID of the app|
|`CLICKMAX_CLIENT_SECRET`|`cxp_cs_...`, kept on the server only|
|`CLICKMAX_LOGIN_BASE_URL`|`https://login.clickmax.io`|
|`CLICKMAX_API_BASE_URL`|`https://mcp.clickmax.io/api/v0`|
|`CLICKMAX_REDIRECT_URL`|`http://127.0.0.1:3000/callback`|
|`PORT`|`3000`|

## Install flow

1. `GET /install` creates a PKCE verifier and a `state`, keeps both on the server under a session cookie, and redirects to `https://login.clickmax.io/api/auth/oauth2/authorize` with `scope=openid email install`. The browser only ever sees the SHA-256 of the verifier.
2. On Clickmax the person signs in, chooses the workspace on **Where to install** and clicks **Continue**, then reviews the permissions and clicks **Install**. Workspaces where they cannot manage apps are disabled. A private app installs only in the workspace that created it.
3. Clickmax redirects to the redirect URL with `code` and `state`, or with `error=access_denied` when the person declined. The callback rejects a `state` that does not match the one stored for this browser.
4. The server calls `exchangeInstallCode` with the client secret and the verifier. The response has `installationId`, `workspaceId` and an ID token with the installer's e-mail.
5. The server stores `installationId` per workspace in [`src/installations.ts`](./src/installations.ts). Installing again in the same workspace returns the same `installationId`.

The workspace receives the permissions the app requested that the installer also holds there. The rest stays pending until an admin approves it in **Installed apps**. Calls that need a pending permission fail with type `permission` and code `missing_permission`.

## Tokens after the install

[`src/clickmax.ts`](./src/clickmax.ts) builds one `Clickmax` client per installation with the client ID, the client secret and the `installationId`. The SDK requests an installation token on the first call, reuses it until a minute before it expires (tokens last 10 minutes and there is no refresh token), and requests a new one and retries once when the API answers 401. The app never stores tokens.

## Removal

When an admin removes the app in **Installed apps**, or the app goes back to private while installed in another workspace, the next call fails: the API rejects the current token, the SDK asks for a new one, and the token endpoint answers `invalid_grant`. The sample marks that workspace as removed and shows it on the home page until someone installs the app again.

Deleting the app in **My apps** stops every installation and the credentials.

## Production notes

- Keep installations in a database tied to your own customer accounts, so each customer reaches only its workspaces. The in-memory store here is lost on restart.
- Keep pending install attempts in your session store. They also live in memory here.
- Verify the ID token against `https://login.clickmax.io/api/auth/jwks` before you use it to sign anyone in. It is signed with EdDSA.

## Links

- [Integrate your application with Clickmax Apps](https://docs.clickmax.io/en/reference/api/clickmax-apps) ([Portuguese](https://docs.clickmax.io/reference/api/clickmax-apps))
- [TypeScript SDK](https://docs.clickmax.io/en/reference/api/sdk)
- [API overview, authentication and errors](https://docs.clickmax.io/en/reference/api)

## License

[Apache-2.0](./LICENSE)
