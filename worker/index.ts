// Titik masuk Cloudflare Worker: /api/* ditangani API, sisanya file tampilan (dist/).
// Jadwal (cron) membuat cadangan data otomatis tiap malam.
import app from '../server/app'
import { makeBackup } from '../server/backup'
import { ensureSchema, type Env } from '../server/db'

export default {
  fetch(request: Request, env: Env & { ASSETS: Fetcher }, ctx: ExecutionContext) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) return app.fetch(request, env, ctx)
    return env.ASSETS.fetch(request)
  },
  async scheduled(_event: ScheduledController, env: Env & { ASSETS: Fetcher }, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        await ensureSchema(env.DB)
        await makeBackup(env.DB, 'otomatis', 'Sistem')
      })(),
    )
  },
} satisfies ExportedHandler<Env & { ASSETS: Fetcher }>
