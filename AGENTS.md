# clickmax-apps-sample

Public sample (Apache-2.0) of a Clickmax App: a Node server that installs itself in a workspace with OAuth + PKCE and calls the Clickmax API through `@clickmax/public-sdk`. Integrators copy from it, so code and README must match the public docs (`https://docs.clickmax.io/en/reference/api/clickmax-apps`). This repo is public: no internal hostnames, environments, endpoints or private repo references in code, comments, docs, commits or workflows.

## Rules

- The OAuth start stays hand-written in `src/install-oauth.ts` (PKCE S256, `state`, authorize URL with `openid email install`). Code exchange, installation tokens and API calls go through the SDK; never reimplement them here.
- `src/install-oauth.ts` owns only the install started by the app. Anything that learns about an installation ends in `saveInstallation` (`src/installations.ts`); the rest of the app reads installations from there and never knows how they were created.
- One `Clickmax` client per installation (`src/clickmax.ts`): the SDK caches the installation token inside the instance. `invalid_grant` on a call = installation removed or suspended -> `markRemoved`, drop the client.
- The client secret, PKCE verifier and tokens never reach the browser or the logs.
- Dependencies: the SDK only (plus `typescript` and `@types/node` for the typecheck). Node >= 22.18 runs `src/*.ts` with type stripping, so only erasable TypeScript syntax (`erasableSyntaxOnly`), and imports keep the `.ts` extension.
- Every variable the server reads is in `.env.example` and checked in `src/config.ts`.
- JSDoc on functions; comments explain why a step exists, not what the line does.

## Commands

```sh
npm install
npm run typecheck
npm start          # loads .env when present
```
