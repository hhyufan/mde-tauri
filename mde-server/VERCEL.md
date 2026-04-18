# Deploying `mde-server` to Vercel

This NestJS service runs as a **single Vercel Serverless Function**, with one
entry point that works in both modes:

- **Local dev** (`npm run start` / `start:dev`): `src/main.ts` calls
  `expressApp.listen(PORT)`.
- **Vercel deployment**: `src/main.ts` exports `default async function handler`
  which Vercel auto-discovers and wires up as the function entry. The Nest
  application is bootstrapped lazily on the first request and the resulting
  Express instance is cached for the life of the warm container.

We deliberately do **not** keep a separate `api/index.ts` — that conflicts
with Vercel's auto-detection of `src/main.ts` as the NestJS entry, which is
exactly what produced the original "找不到导出 / no default export" deploy
error.

## How it works

| File | Role |
| ---- | ---- |
| `src/main.ts` | Dual-mode entry. Locally calls `listen()`; on Vercel exports a cached `handler(req, res)`. |
| `src/setup.ts` | Shared CORS + global ValidationPipe + DNS override (forces SRV-capable public DNS so Atlas connects on networks whose DNS drops SRV queries). |
| `src/app.module.ts` | Mongoose options tuned for short-lived serverless invocations (small pool, fast server-selection timeout). |
| `vercel.json` | Minimal — just `version: 2`. All routing is handled by the single Express function reading `req.url`. |

## Required environment variables

Set these in **Vercel → Project → Settings → Environment Variables**:

| Name | Example | Notes |
| ---- | ------- | ----- |
| `MONGODB_URI` | `mongodb+srv://USER:PASS@cluster.mongodb.net/mde?retryWrites=true&w=majority` | **Must be MongoDB Atlas (or another internet-reachable cluster)** — Vercel functions cannot reach `localhost`. Whitelist `0.0.0.0/0` in Atlas Network Access, or use Atlas's Vercel integration. |
| `JWT_SECRET` | a long random string | Required, used to sign access tokens. |
| `JWT_EXPIRES_IN` | `7d` | Optional, defaults to `7d`. |

## Deploy

### Option A — Vercel Dashboard

1. Import the repo in Vercel.
2. Set **Root Directory** to `mde-tauri/mde-server`.
3. Framework Preset: **Other**.
4. Build/Output settings: leave defaults (the `vercel-build` script is a no-op).
5. Add the environment variables listed above.
6. Deploy.

### Option B — Vercel CLI

```bash
cd mde-tauri/mde-server
npm install
npx vercel link

# 为三个环境分别注入 MongoDB / JWT 配置
# (CLI 会交互式提示输入值；下面给出当前使用的 Atlas 连接串作为参考)
npx vercel env add MONGODB_URI production
npx vercel env add MONGODB_URI preview
npx vercel env add MONGODB_URI development

npx vercel env add JWT_SECRET production
npx vercel env add JWT_SECRET preview
npx vercel env add JWT_SECRET development

# (可选) 自定义过期时间
npx vercel env add JWT_EXPIRES_IN production

# 部署
npx vercel --prod
```

> 当前 `MONGODB_URI` 使用 `markdown-editor` 项目专属的 Atlas 集群，数据库名为 `markdown-editor`：
>
> ```
> mongodb+srv://hhyufan:<password>@cluster0.trm4um5.mongodb.net/markdown-editor?retryWrites=true&w=majority&appName=Cluster0
> ```
>
> 真实密码见本地 `.env`，不要提交到仓库。Atlas 后台 **Network Access** 必须包含 `0.0.0.0/0`（或 Vercel 的 Atlas Integration 自动下发的 IP），否则 Vercel 函数无法连入。

## Verifying the deployment

After deploy you should be able to call:

```bash
curl -X POST https://<your-app>.vercel.app/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"a@b.com","password":"123456"}'
```

Routes:

- `POST /auth/register`
- `POST /auth/login`
- `GET  /auth/profile`
- `POST /auth/refresh`
- `GET  /sync/manifest` — returns `[{ fileId, fileName, originalPath, source, size, checksum, updatedAt }]`
- `POST /sync/file` — **per-file upsert** (preferred). Body: `{ fileId, fileName?, originalPath?, source?, content, compressed?, size?, encoding?, lineEnding?, checksum }`. Content is base64(gzip(rawUtf8)) when `compressed=true`, else the raw text.
- `GET  /sync/file/:fileId` — per-file pull
- `DELETE /sync/file/:fileId` — per-file soft delete
- `POST /sync/push`, `POST /sync/pull`, `DELETE /sync/documents` — legacy batch endpoints (still work, but address by `fileId`s now, not paths)
- `GET  /sync/config`, `PUT  /sync/config`

## Sync data model (BREAKING)

The cloud document is now keyed by **`fileId`** (a client-generated UUID) instead of `relativePath`. This was necessary so the same logical document can be synced across devices whose absolute paths differ (the old design hard-bound a doc to e.g. `C:\Users\foo\note.md`, which made no sense after switching machines).

Mongo unique index changed from `(userId, relativePath)` to `(userId, fileId)`.

**If you have existing test data** in the `syncdocuments` collection, drop it once before the new server starts — the old documents have no `fileId` field and will be invisible to the new code:

```js
// in mongosh / Atlas Data Explorer:
use markdown-editor
db.syncdocuments.drop()
```

The client (`mde-tauri/src/store/useFileIdStore.js`) persists `path -> fileId` mappings locally so the same file always maps to the same UUID across runs.

## Sync payload size

Vercel caps each Serverless Function request body at ~4.5 MB (Hobby) / ~5 MB (Pro). To live within that:

- The client uploads **one file per request** to `POST /sync/file`.
- Bodies above 16 KiB are **gzip-compressed** then base64-encoded by the client (see `src/services/syncEngine.js`).
- The server's Express body parser is configured for `50mb` so self-hosted Docker / Node deployments are unconstrained.
- Files whose body even after gzip exceeds **3.5 MB** are skipped during sync and the user is shown a single grouped warning ("N file(s) exceeded the request size limit"). They are **not** dropped from local recent/bookmarks lists.

## Local development

Nothing changed for local dev — `npm run start:dev` still works as before and
listens on `PORT` (defaults to `3200`).

## Notes & limitations

- **Cold starts**: first request after idle time may take 1–3s while Nest
  bootstraps and Mongoose dials Atlas. Subsequent calls reuse the cached
  Express instance and Mongoose connection.
- **Function timeout / memory**: defaults are whatever your Vercel plan
  provides. To override, add to `vercel.json`:
  ```json
  { "functions": { "src/main.ts": { "memory": 512, "maxDuration": 30 } } }
  ```
- **DNS / SRV**: `src/setup.ts` calls `dns.setServers([...])` so Mongoose's
  SRV lookup against `mongodb+srv://` works even on networks where the
  default resolver drops SRV (some Chinese ISP / home-router DNS). Override
  via env: `DNS_SERVERS=1.1.1.1,8.8.8.8`. On Vercel this is harmless.
- **Stateless**: do not write to the local filesystem — Vercel functions have
  an ephemeral, mostly read-only FS. All state must live in MongoDB.
