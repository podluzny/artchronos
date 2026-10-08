// Vercel serverless function (ADR-009). Код приложения собирается в dist/ на этапе build.
import { handler } from '../dist/server/vercel.js'

export default handler
