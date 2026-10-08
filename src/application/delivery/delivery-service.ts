import {
  assertAttemptAllowed,
  assertDeliverable,
  buildDelivery,
  computeResult,
  deliveryView,
} from '../../domain/delivery/delivery.js'
import type { InteractionRegistry, ItemDocument } from '../../domain/itembank/interaction.js'
import { DomainError } from '../../domain/shared/errors.js'
import type { Clock } from '../shared/context.js'
import { schemaErrors } from '../shared/schema.js'
import type { UnitOfWork } from '../shared/uow.js'
import type { DeliveryTx } from './ports.js'

/**
 * Прототип прохождения (T-077, SPEC-DELIV-001). Не входит в MVP-интерфейс и не экспонируется в AdminJS:
 * используется тестом-прототипом, чтобы подтвердить, что модель контента достаточна для Runner и аналитики.
 * Авторизация будущих `attempt.*` permissions — вне MVP.
 */
export function createDeliveryService(deps: {
  uow: UnitOfWork<DeliveryTx>
  registry: InteractionRegistry
  clock: Clock
}) {
  const { uow, registry, clock } = deps

  async function docOf(tx: DeliveryTx, versionId: string) {
    const v = await tx.items.findVersion(versionId)
    if (!v) throw new Error(`Версия вопроса ${versionId} не найдена`)
    const item = (await tx.items.findById(v.itemId))!
    const qtv = (await tx.qtypes.findVersion(v.questionTypeVersionId))!
    return { doc: v.document, interactionKey: item.interactionKey, qtv }
  }

  return {
    async startAttempt(input: { userId: string; testVersionId: string; seed: number }) {
      return uow.transaction(async (tx) => {
        const version = await tx.tests.findVersion(input.testVersionId)
        if (!version) throw DomainError.notFound()
        assertDeliverable(version.state)
        const attemptNo = assertAttemptAllowed(
          await tx.delivery.countAttempts(version.id, input.userId),
          version.settings.maxAttempts,
        )
        const s = await tx.tests.structure(version.id)
        const rules = []
        for (const r of s.rules) rules.push({ ...r, pool: await tx.tests.frozenPool(r.id) })
        const docs = new Map<string, ItemDocument>()
        for (const id of [...s.fixed.map((f) => f.itemVersionId), ...rules.flatMap((r) => r.pool)])
          docs.set(id, (await docOf(tx, id)).doc)
        const delivered = buildDelivery(
          { sections: s.sections, fixed: s.fixed, rules, settings: version.settings },
          input.seed,
          docs,
        )
        const attemptId = await tx.delivery.insertAttempt({
          testVersionId: version.id,
          userId: input.userId,
          attemptNo,
          seed: input.seed,
          deliveredItems: delivered,
        })
        return { attemptId, attemptNo, items: delivered.map((d) => deliveryView(docs.get(d.itemVersionId)!, d)) }
      })
    },

    async answer(input: { attemptId: string; itemVersionId: string; payload: Record<string, unknown> }) {
      return uow.transaction(async (tx) => {
        const a = await tx.delivery.findAttempt(input.attemptId)
        if (!a) throw DomainError.notFound()
        if (a.status !== 'IN_PROGRESS') throw new DomainError('INVALID_STATE', 'Попытка завершена')
        if (!a.deliveredItems.some((d) => d.itemVersionId === input.itemVersionId))
          throw DomainError.validation([{ field: 'itemVersionId', message: 'Вопрос не входит в попытку' }])
        const { qtv } = await docOf(tx, input.itemVersionId)
        const errs = schemaErrors(qtv.responseSchema, input.payload, 'payload.')
        if (errs.length) throw DomainError.validation(errs, 'Ответ не соответствует формату вопроса')
        return tx.delivery.upsertResponse(a.id, input.itemVersionId, input.payload)
      })
    },

    async submit(attemptId: string) {
      return uow.transaction(async (tx) => {
        const a = await tx.delivery.findAttempt(attemptId)
        if (!a) throw DomainError.notFound()
        if (a.status !== 'IN_PROGRESS') throw new DomainError('INVALID_STATE', 'Попытка уже завершена')
        const version = (await tx.tests.findVersion(a.testVersionId))!
        const responses = new Map((await tx.delivery.responses(a.id)).map((r) => [r.itemVersionId, r]))
        const evals: { score: number | null; maxScore: number; points: number; sectionIndex: number }[] = []
        for (const d of a.deliveredItems) {
          const { doc, interactionKey, qtv } = await docOf(tx, d.itemVersionId)
          const plugin = registry.get(interactionKey)!
          const evaluator = plugin.evaluators[qtv.evaluation.method]!
          let resp = responses.get(d.itemVersionId)
          if (!resp) {
            const id = await tx.delivery.upsertResponse(a.id, d.itemVersionId, {})
            resp = { id, itemVersionId: d.itemVersionId, payload: {} }
          }
          const res = evaluator.evaluate(doc, resp.payload, qtv.evaluation.params ?? {})
          await tx.delivery.insertEvaluation({
            responseId: resp.id,
            method: res.score === null ? 'MANUAL' : 'AUTO',
            score: res.score,
            maxScore: res.maxScore,
            details: res.details,
          })
          evals.push({ score: res.score, maxScore: res.maxScore, points: d.points, sectionIndex: d.sectionIndex })
        }
        const total = computeResult(evals)
        const pass = version.settings.scoring.passingScore
        const result = {
          attemptId: a.id,
          ...total,
          passed: pass === null || total.pendingManual > 0 ? null : total.score >= pass,
        }
        const sections = [...new Set(evals.map((e) => e.sectionIndex))].map((i) => ({
          sectionIndex: i,
          ...computeResult(evals.filter((e) => e.sectionIndex === i)),
        }))
        await tx.delivery.insertResult({ ...result, sectionScores: sections })
        await tx.delivery.setSubmitted(a.id, clock.now())
        return result
      })
    },
  }
}

export type DeliveryService = ReturnType<typeof createDeliveryService>
