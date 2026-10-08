/**
 * Сборка для Vercel (ADR-009):
 * 1) TypeScript → dist/;
 * 2) фронтенд AdminJS (включая собственные компоненты) → public/admin-assets/;
 * 3) сайт SDD-документации → public/sdd/;
 * 4) миграции и seed БД (если задан DATABASE_URL).
 */
import { execSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'

const run = (cmd: string) => execSync(cmd, { stdio: 'inherit', env: process.env })

rmSync('public', { recursive: true, force: true })
mkdirSync('public', { recursive: true })

run('npx tsc -p tsconfig.build.json')

const { bundle } = await import('@adminjs/bundler')
const { componentLoader } = await import('../src/adminjs/component-loader.js')
await bundle({ componentLoader, destinationDir: 'public/admin-assets' })
process.env.NODE_ENV = 'production'

run('sh tools/build_site.sh public/sdd')

if (process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED) {
  run('npx tsx src/infrastructure/db/migrate-cli.ts')
  run('npx tsx src/infrastructure/db/seed-cli.ts')
} else {
  console.warn('DATABASE_URL не задан: миграции пропущены')
}
