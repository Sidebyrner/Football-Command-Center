import Fastify from 'fastify'
import cors from '@fastify/cors'
import healthRoutes from './routes/health.js'
import oddsRoutes from './routes/odds.js'
import newsRoutes from './routes/news.js'
import planRoutes from './routes/plan.js'
import aiRoutes from './routes/ai.js'

const PORT = Number(process.env.PORT) || 8080
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const app = Fastify({ logger: true })

await app.register(cors, {
  // No ALLOWED_ORIGINS set -> reflect no origin (effectively same-origin
  // only). Misconfiguring this open is a classic way to turn a read-only
  // proxy into something any site on the internet can ride on.
  origin: ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : false,
})

await app.register(healthRoutes)
await app.register(oddsRoutes)
await app.register(newsRoutes)
await app.register(planRoutes)
await app.register(aiRoutes)

app.setErrorHandler((err, req, reply) => {
  app.log.error(err)
  reply.code(err.statusCode ?? 500).send({ error: err.message ?? 'Internal error' })
})

try {
  await app.listen({ port: PORT, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
