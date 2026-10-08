/**
 * Сборка для Vercel через Build Output API v3 (ADR-009). Результат — каталог .vercel/output:
 *   static/                       — сайт документации (/sdd/) и предсобранный фронтенд AdminJS (/admin-assets/)
 *   functions/index.func/         — serverless-функция: dist/ + зависимости, отобранные @vercel/nft
 *   config.json                   — маршрутизация: статика, иначе функция
 * Затем — миграции и seed БД (если задан DATABASE_URL).
 * Формирование вывода целиком в сборке делает состав функции детерминированным и проверяемым локально.
 */
import { execSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const run = (cmd: string) => execSync(cmd, { stdio: 'inherit', env: process.env })
const OUT = '.vercel/output'
const FUNC = `${OUT}/functions/index.func`

rmSync('public', { recursive: true, force: true })
rmSync(OUT, { recursive: true, force: true })
mkdirSync('public', { recursive: true })

// 1. Сервер
run('npx tsc -p tsconfig.build.json')

// 2. Фронтенд AdminJS (включая собственные компоненты)
const { bundle } = await import('@adminjs/bundler')
const { componentLoader } = await import('../src/adminjs/component-loader.js')
await bundle({ componentLoader, destinationDir: 'public/admin-assets' })

// 3. Документация
run('sh tools/build_site.sh public/sdd')

// 4. Build Output
mkdirSync(`${OUT}/static`, { recursive: true })
cpSync('public', `${OUT}/static`, { recursive: true })

const { nodeFileTrace } = await import('@vercel/nft')
const entry = 'dist/server/vercel.js'
const { fileList } = await nodeFileTrace([entry], { base: process.cwd() })
const files = new Set<string>([...fileList, 'package.json'])
for (const f of files) {
  const dest = path.join(FUNC, f)
  mkdirSync(path.dirname(dest), { recursive: true })
  cpSync(f, dest, { dereference: true })
}
// Пакеты, загружаемые динамически по имени платформы (nft их не видит). Сборка идет на linux-x64, как и рантайм Vercel.
for (const dir of ['node_modules/@rollup/rollup-linux-x64-gnu', 'node_modules/@esbuild/linux-x64']) {
  try {
    cpSync(dir, path.join(FUNC, dir), { recursive: true, dereference: true })
  } catch {
    console.warn(`нет ${dir} — пропущено`)
  }
}
// Исходники React-компонентов: ComponentLoader проверяет их наличие при старте (ассеты уже собраны).
cpSync('src/adminjs/components', path.join(FUNC, 'src/adminjs/components'), { recursive: true })
writeFileSync(
  `${FUNC}/.vc-config.json`,
  JSON.stringify(
    { runtime: 'nodejs22.x', handler: entry, launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 30 },
    null,
    2,
  ),
)
writeFileSync(
  `${OUT}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/sdd$', status: 308, headers: { Location: '/sdd/' } },
        { handle: 'filesystem' },
        { src: '^/(.*)$', dest: '/index' },
      ],
    },
    null,
    2,
  ),
)
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
console.log(`Build Output: функция ${files.size} файлов, статика public/ (${pkg.name}@${pkg.version})`)

// 5. БД
if (process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED) {
  run('npx tsx src/infrastructure/db/migrate-cli.ts')
  run('npx tsx src/infrastructure/db/seed-cli.ts')
} else {
  console.warn('DATABASE_URL не задан: миграции пропущены')
}
