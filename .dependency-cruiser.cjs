/** Архитектурные правила ADR-004 / NFR-MAINT-001. */
module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure',
      comment: 'domain не зависит от application, infrastructure, adminjs, server и внешних фреймворков',
      severity: 'error',
      from: { path: '^src/domain' },
      to: {
        path: [
          '^src/(application|infrastructure|adminjs|server)',
          'node_modules/(adminjs|@adminjs|express|kysely|pg|react)',
        ],
      },
    },
    {
      name: 'application-no-ui-no-db',
      comment: 'application не зависит от adminjs, server, infrastructure и драйверов БД',
      severity: 'error',
      from: { path: '^src/application' },
      to: { path: ['^src/(adminjs|server|infrastructure)', 'node_modules/(adminjs|@adminjs|express|react|pg)'] },
    },
    {
      name: 'adminjs-no-db',
      comment: 'UI-адаптер не обращается к БД напрямую',
      severity: 'error',
      from: { path: '^src/adminjs' },
      to: { path: ['^src/infrastructure/db', 'node_modules/(kysely|pg)'] },
    },
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: 'src/adminjs/components' },
  },
}
