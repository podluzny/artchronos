import { z } from 'zod'
import { DomainError } from '../../domain/shared/errors.js'
import type { InteractionRegistry } from '../../domain/itembank/interaction.js'
import { diff } from '../shared/audit.js'
import type { ListQuery } from '../shared/query.js'
import { schemaErrors } from '../shared/schema.js'
import type { UnitOfWork } from '../shared/uow.js'
import { useCase } from '../shared/use-case.js'
import type { ItemBankTx, QuestionTypeFull } from './ports.js'

export interface QtypeDeps {
  uow: UnitOfWork<ItemBankTx>
  registry: InteractionRegistry
}

/** Строит неизменяемую версию типа из конфигурации плагина (ADR-001 п.2). */
export function buildTypeVersion(
  registry: InteractionRegistry,
  interactionKey: string,
  config: unknown,
  evaluation: { method: string; params?: Record<string, unknown> },
) {
  const plugin = registry.get(interactionKey)
  if (!plugin)
    throw DomainError.rule('BR-023', `Interaction «${interactionKey}» не зарегистрирован в коде`, 'interactionKey')
  const cfg = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>
  const errors = schemaErrors(plugin.configSchema, cfg, 'config.')
  if (errors.length) throw DomainError.validation(errors, 'Конфигурация не соответствует плагину')
  const evaluator = plugin.evaluators[evaluation.method]
  if (!evaluator)
    throw DomainError.validation([
      { field: 'evaluation', message: `Плагин не поддерживает метод оценивания «${evaluation.method}»` },
    ])
  const pErrors = schemaErrors(evaluator.paramsSchema, evaluation.params ?? {}, 'evaluation.params.')
  if (pErrors.length) throw DomainError.validation(pErrors)
  return {
    interactionConfig: cfg,
    contentSchema: plugin.buildContentSchema(cfg),
    responseSchema: plugin.responseSchema(cfg),
    answerKeySchema: plugin.answerKeySchema(cfg),
    evaluation: { method: evaluation.method, params: evaluation.params ?? {} },
  }
}

export function createQtypeUseCases(deps: QtypeDeps) {
  const { uow, registry } = deps
  const repo = () => uow.read.qtypes

  async function load(id: string): Promise<QuestionTypeFull> {
    const t = await repo().findById(id)
    if (!t) throw DomainError.notFound()
    return t
  }

  return {
    listQuestionTypesFull: useCase<ListQuery, { records: QuestionTypeFull[]; total: number }>({
      name: 'qtype.list',
      permission: 'qtype.read',
      run: async (_a, q) => repo().list(q),
    }),

    getQuestionType: useCase<{ id: string }, QuestionTypeFull>({
      name: 'qtype.get',
      permission: 'qtype.read',
      run: async (_a, { id }) => load(id),
    }),

    /** Зарегистрированные interaction plugins (для формы создания типа). */
    listInteractions: useCase<
      void,
      {
        key: string
        title: string
        description: string
        defaultConfig: Record<string, unknown>
        evaluators: { key: string; label: string }[]
        configSchema: Record<string, unknown>
      }[]
    >({
      name: 'qtype.listInteractions',
      permission: 'qtype.read',
      async run() {
        return registry.keys().map((k) => {
          const p = registry.get(k)!
          return {
            key: p.key,
            title: p.title,
            description: p.description,
            defaultConfig: p.defaultConfig,
            evaluators: Object.entries(p.evaluators).map(([key, e]) => ({ key, label: e.label })),
            configSchema: p.configSchema,
          }
        })
      },
    }),

    /** SPEC-QTYPE-001: создание configurable type (INACTIVE + v1). */
    createQuestionType: useCase<
      {
        code: string
        name: string
        description?: string | null
        interactionKey: string
        config?: unknown
        evaluation: { method: string; params?: Record<string, unknown> }
      },
      { id: string }
    >({
      name: 'qtype.create',
      permission: 'qtype.manage',
      async run(actor, raw, ctx) {
        const d = z
          .object({
            code: z
              .string()
              .trim()
              .regex(/^[a-z][a-z0-9_]{1,49}$/, 'Код: латиница в нижнем регистре, цифры и _'),
            name: z.string().trim().min(1, 'Обязательное поле').max(200),
            description: z.string().trim().max(1000).nullish(),
            interactionKey: z.string(),
            config: z.unknown().optional(),
            evaluation: z.object({ method: z.string(), params: z.record(z.string(), z.unknown()).optional() }),
          })
          .safeParse(raw)
        if (!d.success)
          throw DomainError.validation(d.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })))
        const v = d.data
        const plugin = registry.get(v.interactionKey)
        const built = buildTypeVersion(registry, v.interactionKey, v.config ?? plugin?.defaultConfig, v.evaluation)
        return uow.transaction(async (tx) => {
          if (await tx.qtypes.findByCode(v.code))
            throw DomainError.validation([{ field: 'code', message: 'Тип с таким кодом уже есть' }])
          const id = await tx.qtypes.insertType({
            code: v.code,
            name: v.name,
            description: v.description ?? null,
            interactionKey: v.interactionKey,
          })
          const ver = await tx.qtypes.insertVersion({ questionTypeId: id, ...built, createdBy: actor.userId })
          await tx.qtypes.update(id, { currentVersionId: ver.id })
          await tx.audit.record(
            actor,
            {
              action: 'qtype.created',
              resourceType: 'question_type',
              resourceId: id,
              changes: {
                code: v.code,
                interactionKey: v.interactionKey,
                config: built.interactionConfig,
                evaluation: built.evaluation,
              },
            },
            ctx,
          )
          return { id }
        })
      },
    }),

    /** Изменение конфигурации → новая версия (BR-022); существующие вопросы остаются на своей версии. */
    updateQuestionType: useCase<
      {
        id: string
        name?: string
        description?: string | null
        config?: unknown
        evaluation?: { method: string; params?: Record<string, unknown> }
        revision: number
      },
      { versionNo: number | null }
    >({
      name: 'qtype.update',
      permission: 'qtype.manage',
      async run(actor, input, ctx) {
        const t = await load(input.id)
        if (
          (input as Record<string, unknown>).interactionKey &&
          (input as Record<string, unknown>).interactionKey !== t.interactionKey
        ) {
          throw DomainError.validation([{ field: 'interactionKey', message: 'Interaction типа изменить нельзя' }])
        }
        const cur = t.currentVersion!
        const configChanged =
          input.config !== undefined && JSON.stringify(input.config) !== JSON.stringify(cur.interactionConfig)
        const evalChanged =
          input.evaluation !== undefined &&
          JSON.stringify({ params: {}, ...input.evaluation }) !== JSON.stringify({ params: {}, ...cur.evaluation })
        return uow.transaction(async (tx) => {
          let versionNo: number | null = null
          const patch: Parameters<ItemBankTx['qtypes']['update']>[1] = {}
          if (input.name !== undefined) patch.name = z.string().trim().min(1).max(200).parse(input.name)
          if (input.description !== undefined) patch.description = input.description?.trim() || null
          if (configChanged || evalChanged) {
            const built = buildTypeVersion(
              registry,
              t.interactionKey,
              input.config ?? cur.interactionConfig,
              input.evaluation ?? cur.evaluation,
            )
            const ver = await tx.qtypes.insertVersion({ questionTypeId: t.id, ...built, createdBy: actor.userId })
            patch.currentVersionId = ver.id
            versionNo = ver.versionNo
          }
          await tx.qtypes.update(t.id, patch, input.revision)
          await tx.audit.record(
            actor,
            {
              action: versionNo ? 'qtype.version.created' : 'qtype.updated',
              resourceType: 'question_type',
              resourceId: t.id,
              changes: {
                ...diff(
                  { name: t.name, description: t.description },
                  { name: patch.name ?? t.name, description: patch.description ?? t.description },
                ),
                ...(versionNo ? { version: { from: cur.versionNo, to: versionNo } } : {}),
              },
            },
            ctx,
          )
          return { versionNo }
        })
      },
    }),

    /** BR-021: деактивация не затрагивает существующие вопросы; возвращает число активных заданий, где тип разрешен. */
    setQuestionTypeStatus: useCase<{ id: string; status: 'ACTIVE' | 'INACTIVE' }, { activeAssignments: number }>({
      name: 'qtype.setStatus',
      permission: 'qtype.manage',
      async run(actor, { id, status }, ctx) {
        const t = await load(id)
        if (!['ACTIVE', 'INACTIVE'].includes(status))
          throw DomainError.validation([{ field: 'status', message: 'Недопустимый статус' }])
        if (t.status === status) throw new DomainError('INVALID_STATE', 'Статус уже установлен')
        await uow.transaction(async (tx) => {
          await tx.qtypes.update(id, { status })
          await tx.audit.record(
            actor,
            {
              action: `qtype.${status === 'ACTIVE' ? 'activated' : 'deactivated'}`,
              resourceType: 'question_type',
              resourceId: id,
            },
            ctx,
          )
        })
        return { activeAssignments: t.activeAssignmentCount }
      },
    }),
  }
}

export type QtypeUseCases = ReturnType<typeof createQtypeUseCases>
