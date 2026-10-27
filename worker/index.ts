// Titik masuk Cloudflare Worker: /api/* ditangani API, sisanya file tampilan (dist/).
import app from '../server/app'
import type { Env } from '../server/db'

export default {
  fetch(request: Request, env: Env & { ASSETS: Fetcher }, ctx: ExecutionContext) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) return app.fetch(request, env, ctx)
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env & { ASSETS: Fetcher }>
