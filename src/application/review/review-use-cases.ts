import { requireScope, scopeFilter, type Actor } from '../../domain/authorization/actor.js'
import type { Scope } from '../../domain/authorization/scope.js'
import {
  assertCanRequestChanges,
  assertNotAuthor,
  assertOpen,
  blockingOpen,
  missingMandatory,
  nextIssueStatus,
  type ChecklistItem,
  type IssueSeverity,
  type IssueStatus,
  type ReviewerRole,
} from '../../domain/review/review-rules.js'
import { DomainError } from '../../domain/shared/errors.js'
import { transition, type VersionState } from '../../domain/versioning/state-machine.js'
import type { AssessmentTx, TestRecord } from '../assessment/ports.js'
import type { ItemRecord } from '../itembank/ports.js'
import type { ItemUseCases } from '../itembank/item-use-cases.js'
import type { Clock, RequestContext } from '../shared/context.js'
import type { ListQuery } from '../shared/query.js'
import type { UnitOfWork } from '../shared/uow.js'
import { useCase } from '../shared/use-case.js'
import type {
  ChecklistAnswerRecord,
  ChecklistTemplateRecord,
  CommentAnchor,
  ContentIssueRecord,
  ReviewAssignmentRecord,
  ReviewCommentRecord,
  ReviewRecord,
  ReviewTx,
} from './ports.js'

/** Хуки рабочего процесса тестов и вопросов выполняются в их транзакции; AppTx содержит репозиторий review. */
const rtx = (tx: unknown) => tx as ReviewTx

async function eligibleReviewer(tx: ReviewTx, userId: string | null, authors: string[]): Promise<boolean> {
  if (!userId || authors.includes(userId)) return false
  return tx.education.userHasPermission(userId, 'review.perform')
}

/**
 * Хуки SPEC-REVIEW-001: создание Review при отправке (с автоназначением PRIMARY), отмена при отзыве,
 * перенос незакрытых замечаний на новую версию (FR-REVIEW-009).
 */
export function createReviewHooks() {
  async function create(
    tx: ReviewTx,
    actor: Actor,
    d: {
      kind: 'TEST_VERSION' | 'ITEM_VERSION'
      versionId: string
      testId: string | null
      itemId: string | null
      courseId: string
      assignmentId: string | null
      authors: string[]
    },
    ctx: RequestContext,
  ) {
    const template = await tx.reviews.activeTemplate(d.kind)
    if (!template) throw new Error(`Нет активного шаблона checklist для ${d.kind}`)
    const reviewId = await tx.reviews.insertReview({
      subjectType: d.kind,
      testVersionId: d.kind === 'TEST_VERSION' ? d.versionId : null,
      itemVersionId: d.kind === 'ITEM_VERSION' ? d.versionId : null,
      testId: d.testId,
      itemId: d.itemId,
      courseId: d.courseId,
      assignmentId: d.assignmentId,
      checklistTemplateId: template.id,
    })
    const a = d.assignmentId ? await tx.education.findAssignment(d.assignmentId) : null
    const candidate = a ? (a.defaultReviewerId ?? a.ownerId) : null
    let reviewerId: string | null = null
    if (await eligibleReviewer(tx, candidate, d.authors)) {
      reviewerId = candidate
      await tx.reviews.insertAssignment({
        reviewId,
        reviewerId: candidate!,
        role: 'PRIMARY',
        assignedBy: null,
        reason: null,
      })
    }
    await tx.audit.record(
      actor,
      {
        action: 'review.created',
        resourceType: 'review',
        resourceId: reviewId,
        changes: {
          subjectType: d.kind,
          versionId: d.versionId,
          primaryReviewerId: reviewerId,
          unassigned: !reviewerId,
        },
      },
      ctx,
    )
  }

  async function cancel(
    tx: ReviewTx,
    actor: Actor,
    kind: 'TEST_VERSION' | 'ITEM_VERSION',
    versionId: string,
    ctx: RequestContext,
  ) {
    const open = await tx.reviews.openForVersion(kind, versionId)
    if (!open) return
    await tx.reviews.setStatus(open.id, { status: 'CANCELLED' })
    await tx.reviews.closeAssignments(open.id, 'REVOKED')
    await tx.audit.record(actor, { action: 'review.cancelled', resourceType: 'review', resourceId: open.id }, ctx)
  }

  return {
    testSubmitted: async (
      tx: AssessmentTx,
      actor: Actor,
      test: TestRecord,
      version: { id: string; packageItemVersionIds: string[] },
      ctx: RequestContext,
    ) => {
      const v = (await tx.tests.findVersion(version.id))!
      await create(
        rtx(tx),
        actor,
        {
          kind: 'TEST_VERSION',
          versionId: version.id,
          testId: test.id,
          itemId: null,
          courseId: test.courseId,
          assignmentId: test.assignmentId,
          authors: [...new Set([test.ownerId, ...v.authorIds])],
        },
        ctx,
      )
    },
    testRecalled: async (tx: AssessmentTx, actor: Actor, _test: TestRecord, versionId: string, ctx: RequestContext) =>
      cancel(rtx(tx), actor, 'TEST_VERSION', versionId, ctx),
    itemSubmitted: async (tx: unknown, actor: Actor, item: ItemRecord, versionId: string, ctx: RequestContext) => {
      const v = (await rtx(tx).items.findVersion(versionId))!
      await create(
        rtx(tx),
        actor,
        {
          kind: 'ITEM_VERSION',
          versionId,
          testId: null,
          itemId: item.id,
          courseId: item.courseId,
          assignmentId: item.assignmentId,
          authors: [...new Set([item.ownerId, ...v.authorIds])],
        },
        ctx,
      )
    },
    itemRecalled: async (tx: unknown, actor: Actor, versionId: string, ctx: RequestContext) =>
      cancel(rtx(tx), actor, 'ITEM_VERSION', versionId, ctx),
    newVersion: async (
      tx: unknown,
      actor: Actor,
      kind: 'test' | 'item',
      containerId: string,
      versionId: string,
      ctx: RequestContext,
    ) => {
      const n = await rtx(tx).reviews.linkOpenIssues(kind, containerId, versionId)
      if (n)
        await rtx(tx).audit.record(
          actor,
          {
            action: 'review.issues.carried',
            resourceType: kind,
            resourceId: containerId,
            changes: { versionId, issues: n },
          },
          ctx,
        )
    },
  }
}

export type ReviewHooks = ReturnType<typeof createReviewHooks>

export interface ReviewDeps {
  uow: UnitOfWork<ReviewTx>
  clock: Clock
  items: ItemUseCases
}

export interface PackageEntry {
  itemId: string
  itemVersionId: string
  versionNo: number
  state: VersionState
  stem: string
  questionTypeName: string
  inPackage: boolean
  authorIds: string[]
  ownerId: string
}

export interface ReviewDetails {
  review: ReviewRecord
  assignments: ReviewAssignmentRecord[]
  template: ChecklistTemplateRecord
  answers: ChecklistAnswerRecord[]
  comments: ReviewCommentRecord[]
  /** Замечания контейнера: этого review и перенесенные из предыдущих. */
  issues: (ContentIssueRecord & { carried: boolean })[]
  package: PackageEntry[]
  myRole: ReviewerRole | null
  isAuthor: boolean
  canAssign: boolean
  canStart: boolean
  canChecklist: boolean
  canComment: boolean
  canRaiseIssue: boolean
  canDecide: boolean
  missingChecklist: string[]
  openBlocking: number
}

export function createReviewUseCases(deps: ReviewDeps) {
  const { uow, clock } = deps
  const r = () => uow.read

  async function loadReview(id: string) {
    const rv = await r().reviews.findById(id)
    if (!rv) throw DomainError.notFound()
    return rv
  }

  async function reviewScopes(actor: Actor, rv: ReviewRecord) {
    const rel = await r().reviews.relations(actor.userId, rv.id)
    const s = new Set<Scope>()
    if (rel.own) s.add('OWN')
    if (rel.assigned || rel.assignmentManager) s.add('ASSIGNED')
    if (rel.courseTeacher) s.add('COURSE')
    return { scopes: s, rel }
  }

  async function requireRead(actor: Actor, rv: ReviewRecord) {
    const x = await reviewScopes(actor, rv)
    requireScope(actor, 'review.read', x.scopes, 'read')
    return x
  }

  function activeRole(assignments: ReviewAssignmentRecord[], userId: string): ReviewerRole | null {
    const a = assignments.filter((x) => x.reviewerId === userId && x.status === 'ACTIVE')
    if (a.some((x) => x.role === 'PRIMARY')) return 'PRIMARY'
    return a.length ? 'ADVISORY' : null
  }

  /** Авторы объекта и вопросов пакета (BR-001, BR-027). */
  async function authorsOf(rv: ReviewRecord, pkg: PackageEntry[]) {
    return [
      ...new Set([
        rv.ownerId,
        ...rv.authorIds,
        ...pkg.filter((p) => p.inPackage).flatMap((p) => [p.ownerId, ...p.authorIds]),
      ]),
    ]
  }

  async function packageOf(rv: ReviewRecord): Promise<PackageEntry[]> {
    if (rv.subjectType !== 'TEST_VERSION') return []
    const v = (await r().tests.findVersion(rv.testVersionId!))!
    const s = await r().tests.structure(v.id)
    const pkg = new Set(v.packageItemVersionIds)
    return s.fixed.map((f) => ({
      itemId: f.itemId,
      itemVersionId: f.itemVersionId,
      versionNo: f.versionNo,
      state: f.versionState,
      stem: f.stem,
      questionTypeName: f.questionTypeName,
      inPackage: pkg.has(f.itemVersionId),
      authorIds: f.versionAuthorIds,
      ownerId: f.itemOwnerId,
    }))
  }

  async function containerIssues(rv: ReviewRecord) {
    const all = await r().reviews.issuesForContainer(rv.testId ? 'test' : 'item', (rv.testId ?? rv.itemId)!)
    return all
      .filter(
        (i) =>
          i.reviewId === rv.id ||
          i.status === 'OPEN' ||
          i.status === 'ADDRESSED' ||
          i.linkedVersionId === (rv.testVersionId ?? rv.itemVersionId),
      )
      .map((i) => ({ ...i, carried: i.reviewId !== rv.id }))
  }

  async function details(actor: Actor, rv: ReviewRecord): Promise<ReviewDetails> {
    const { scopes, rel } = await requireRead(actor, rv)
    const assignments = await r().reviews.assignments(rv.id)
    const template = (await r().reviews.template(rv.checklistTemplateId))!
    const answers = await r().reviews.answers(rv.id)
    const pkg = await packageOf(rv)
    const issues = await containerIssues(rv)
    const myRole = activeRole(assignments, actor.userId)
    const open = rv.status === 'OPEN' || rv.status === 'IN_PROGRESS'
    const assignScopes = actor.scopes('review.assign')
    const canAssign =
      open &&
      (assignScopes.has('ANY') ||
        (assignScopes.has('ASSIGNED') && rel.assignmentManager) ||
        (assignScopes.has('COURSE') && rel.courseTeacher))
    const authors = await authorsOf(rv, pkg)
    const isAuthor = authors.includes(actor.userId)
    const performer = actor.has('review.perform') && !!myRole && !isAuthor
    const commentScopes = actor.scopes('review.comment')
    return {
      review: rv,
      assignments,
      template,
      answers,
      comments: await r().reviews.comments(rv.id),
      issues,
      package: pkg,
      myRole,
      isAuthor,
      canAssign,
      canStart: performer && myRole === 'PRIMARY' && rv.status === 'OPEN',
      canChecklist: performer && myRole === 'PRIMARY' && rv.status === 'IN_PROGRESS',
      canComment:
        open && ((commentScopes.has('ASSIGNED') && !!myRole) || (commentScopes.has('OWN') && scopes.has('OWN'))),
      canRaiseIssue: performer && rv.status === 'IN_PROGRESS',
      canDecide: performer && myRole === 'PRIMARY' && rv.status === 'IN_PROGRESS',
      missingChecklist: missingMandatory(template.items, answers).map((i) => i.text),
      openBlocking: blockingOpen(issues).length,
    }
  }

  /** PRIMARY активного назначения, не автор (BR-001, BR-030). */
  async function requirePrimary(actor: Actor, rv: ReviewRecord, what: string) {
    const assignments = await r().reviews.assignments(rv.id)
    const role = activeRole(assignments, actor.userId)
    if (!role) throw DomainError.forbidden('Вы не назначены на эту экспертизу')
    if (role !== 'PRIMARY')
      throw DomainError.rule('BR-030', `${what} — только основной эксперт (PRIMARY); консультант лишь комментирует`)
    assertNotAuthor(actor.userId, await authorsOf(rv, await packageOf(rv)), 'теста или вопросов пакета')
  }

  return {
    listReviews: useCase<ListQuery, { records: ReviewRecord[]; total: number }>({
      name: 'review.list',
      permission: 'review.read',
      run: async (actor, q) => {
        if (q.filters.queue === 'mine') q.filters.userId = actor.userId
        return r().reviews.list(scopeFilter(actor, 'review.read'), q)
      },
    }),

    getReview: useCase<{ id: string }, ReviewDetails>({
      name: 'review.get',
      permission: 'review.read',
      run: async (actor, { id }) => details(actor, await loadReview(id)),
    }),

    /** Кандидаты в эксперты (BR-027): активные, с review.perform, не авторы. */
    reviewerOptions: useCase<{ reviewId: string }, { value: string; label: string }[]>({
      name: 'review.reviewerOptions',
      permission: 'review.assign',
      async run(actor, { reviewId }) {
        const d = await details(actor, await loadReview(reviewId))
        if (!d.canAssign) throw DomainError.forbidden()
        const authors = await authorsOf(d.review, d.package)
        return (await r().reviews.reviewerCandidates())
          .filter((c) => !authors.includes(c.id))
          .map((c) => ({ value: c.id, label: `${c.name} (${c.email})` }))
      },
    }),

    /** SPEC-REVIEW-001: назначение / переназначение PRIMARY, добавление ADVISORY. */
    assignReviewer: useCase<
      { reviewId: string; reviewerId: string; role?: ReviewerRole; reason?: string | null },
      { assignmentId: string }
    >({
      name: 'review.assign',
      permission: 'review.assign',
      async run(actor, input, ctx) {
        const rv = await loadReview(input.reviewId)
        const { scopes, rel } = await reviewScopes(actor, rv)
        requireScope(actor, 'review.read', scopes, 'read')
        const assignScopes = new Set<Scope>()
        if (rel.assignmentManager) assignScopes.add('ASSIGNED')
        if (rel.courseTeacher) assignScopes.add('COURSE')
        requireScope(actor, 'review.assign', assignScopes)
        assertOpen(rv.status)
        const role: ReviewerRole = input.role === 'ADVISORY' ? 'ADVISORY' : 'PRIMARY'
        const u = await r().reviews.userBrief(input.reviewerId)
        if (!u) throw DomainError.validation([{ field: 'reviewerId', message: 'Пользователь не найден' }])
        if (u.status !== 'ACTIVE')
          throw DomainError.rule('BR-027', 'Эксперт должен быть активным пользователем', 'reviewerId')
        if (!(await r().education.userHasPermission(u.id, 'review.perform')))
          throw DomainError.rule('BR-027', 'У пользователя нет права проводить экспертизу', 'reviewerId')
        const authors = await authorsOf(rv, await packageOf(rv))
        if (authors.includes(u.id))
          throw DomainError.rule('BR-027', 'Автор не может быть экспертом собственного контента', 'reviewerId')
        const current = await r().reviews.assignments(rv.id)
        const activePrimary = current.find((a) => a.role === 'PRIMARY' && a.status === 'ACTIVE')
        if (current.some((a) => a.reviewerId === u.id && a.status === 'ACTIVE'))
          throw DomainError.validation([
            { field: 'reviewerId', message: 'Пользователь уже назначен на эту экспертизу' },
          ])
        const reason = input.reason?.trim() || null
        if (role === 'PRIMARY' && activePrimary && !reason)
          throw DomainError.validation([{ field: 'reason', message: 'Укажите причину переназначения' }])
        return uow.transaction(async (tx) => {
          if (role === 'PRIMARY' && activePrimary)
            await tx.reviews.setAssignmentStatus(activePrimary.id, 'REVOKED', reason)
          const assignmentId = await tx.reviews.insertAssignment({
            reviewId: rv.id,
            reviewerId: u.id,
            role,
            assignedBy: actor.userId,
            reason,
          })
          await tx.audit.record(
            actor,
            {
              action: activePrimary && role === 'PRIMARY' ? 'review.reassigned' : 'review.assigned',
              resourceType: 'review',
              resourceId: rv.id,
              changes: {
                reviewerId: u.id,
                role,
                previous: role === 'PRIMARY' ? (activePrimary?.reviewerId ?? null) : undefined,
              },
              reason,
            },
            ctx,
          )
          return { assignmentId }
        })
      },
    }),

    /** T5: начало экспертизы — версия (и пакет) → IN_REVIEW; recall больше невозможен (BR-038). */
    startReview: useCase<{ reviewId: string }, void>({
      name: 'review.start',
      permission: 'review.perform',
      async run(actor, { reviewId }, ctx) {
        const rv = await loadReview(reviewId)
        await requireRead(actor, rv)
        await requirePrimary(actor, rv, 'Начать экспертизу')
        if (rv.status !== 'OPEN') throw new DomainError('INVALID_TRANSITION', 'Экспертиза уже начата или завершена')
        const pkg = await packageOf(rv)
        await uow.transaction(async (tx) => {
          if (rv.subjectType === 'TEST_VERSION') {
            const v = (await tx.tests.findVersion(rv.testVersionId!))!
            await tx.tests.setVersionState(v.id, { from: v.state, state: transition(v.state, 'startReview', 'test') })
            for (const p of pkg.filter((x) => x.inPackage))
              await tx.items.setVersionState(p.itemVersionId, {
                from: p.state,
                state: transition(p.state, 'startReview', 'item'),
              })
          } else {
            const v = (await tx.items.findVersion(rv.itemVersionId!))!
            await tx.items.setVersionState(v.id, { from: v.state, state: transition(v.state, 'startReview', 'item') })
          }
          await tx.reviews.setStatus(rv.id, { status: 'IN_PROGRESS' }, rv.revision)
          await tx.audit.record(actor, { action: 'review.started', resourceType: 'review', resourceId: rv.id }, ctx)
        })
      },
    }),

    answerChecklist: useCase<{ reviewId: string; code: string; checked: boolean; note?: string | null }, void>({
      name: 'review.checklist',
      permission: 'review.perform',
      async run(actor, input, ctx) {
        const rv = await loadReview(input.reviewId)
        await requireRead(actor, rv)
        assertOpen(rv.status)
        await requirePrimary(actor, rv, 'Отмечать checklist')
        if (rv.status !== 'IN_PROGRESS') throw new DomainError('INVALID_STATE', 'Сначала начните экспертизу')
        const t = (await r().reviews.template(rv.checklistTemplateId))!
        if (!t.items.some((i) => i.code === input.code))
          throw DomainError.validation([{ field: 'code', message: 'Нет такого пункта checklist' }])
        await uow.transaction(async (tx) => {
          await tx.reviews.upsertAnswer({
            reviewId: rv.id,
            code: input.code,
            checked: input.checked === true || (input.checked as unknown) === 'true',
            note: input.note?.trim() || null,
            by: actor.userId,
          })
          await tx.audit.record(
            actor,
            {
              action: 'review.checklist',
              resourceType: 'review',
              resourceId: rv.id,
              changes: { code: input.code, checked: input.checked },
            },
            ctx,
          )
        })
      },
    }),

    /** Комментарий (эксперт или автор); эксперт может сразу оформить его как замечание (ContentIssue). */
    addComment: useCase<
      {
        reviewId: string
        body: string
        anchor?: CommentAnchor
        parentId?: string | null
        severity?: IssueSeverity | null
      },
      { commentId: string; issueId: string | null }
    >({
      name: 'review.comment',
      permission: 'review.comment',
      async run(actor, input, ctx) {
        const rv = await loadReview(input.reviewId)
        const d = await details(actor, rv)
        assertOpen(rv.status)
        if (!d.canComment) throw DomainError.forbidden('Комментировать могут назначенные эксперты и автор')
        const body = String(input.body ?? '').trim()
        if (!body || body.length > 5000)
          throw DomainError.validation([{ field: 'body', message: 'Комментарий — от 1 до 5000 символов' }])
        const severity = input.severity || null
        if (severity && !d.canRaiseIssue)
          throw DomainError.forbidden('Замечания создают назначенные эксперты во время экспертизы')
        if (severity && !['BLOCKING', 'MAJOR', 'MINOR'].includes(severity))
          throw DomainError.validation([{ field: 'severity', message: 'Неизвестная важность' }])
        const anchor: CommentAnchor = {
          itemVersionId: input.anchor?.itemVersionId || null,
          sectionId: input.anchor?.sectionId || null,
          fieldPath: input.anchor?.fieldPath || null,
        }
        if (
          anchor.itemVersionId &&
          rv.subjectType === 'TEST_VERSION' &&
          !d.package.some((p) => p.itemVersionId === anchor.itemVersionId)
        )
          throw DomainError.validation([{ field: 'anchor', message: 'Вопрос не входит в эту версию теста' }])
        if (input.parentId && !d.comments.some((c) => c.id === input.parentId))
          throw DomainError.validation([{ field: 'parentId', message: 'Комментарий не найден' }])
        return uow.transaction(async (tx) => {
          const commentId = await tx.reviews.insertComment({
            reviewId: rv.id,
            parentId: input.parentId || null,
            authorId: actor.userId,
            anchor,
            body,
          })
          let issueId: string | null = null
          if (severity) {
            issueId = await tx.reviews.insertIssue({
              reviewId: rv.id,
              originCommentId: commentId,
              testId: rv.testId,
              itemId: rv.itemId,
              linkedVersionId: (rv.testVersionId ?? rv.itemVersionId)!,
              anchor,
              body,
              severity,
              raisedBy: actor.userId,
            })
          }
          await tx.audit.record(
            actor,
            {
              action: severity ? 'review.issue.raised' : 'review.commented',
              resourceType: 'review',
              resourceId: rv.id,
              changes: { commentId, issueId, severity, anchor },
            },
            ctx,
          )
          return { commentId, issueId }
        })
      },
    }),

    /** Автор: OPEN → ADDRESSED; основной эксперт текущей экспертизы: RESOLVED / WONT_FIX / повторно OPEN. */
    setIssueStatus: useCase<{ issueId: string; status: IssueStatus; note?: string | null }, void>({
      name: 'review.issue.status',
      permission: 'review.comment',
      async run(actor, input, ctx) {
        const issue = await r().reviews.findIssue(input.issueId)
        if (!issue) throw DomainError.notFound()
        const origin = await loadReview(issue.reviewId)
        await requireRead(actor, origin)
        const kind = issue.testId ? 'test' : 'item'
        const containerId = (issue.testId ?? issue.itemId)!
        // контекст решения: текущая открытая экспертиза контейнера (или исходная, если она еще открыта)
        const latest = await r().reviews.latestForContainer(kind, containerId)
        const current = latest && (latest.status === 'OPEN' || latest.status === 'IN_PROGRESS') ? latest : null
        const authors = await authorsOf(origin, await packageOf(origin))
        const isAuthor = authors.includes(actor.userId)
        let as: 'AUTHOR' | 'PRIMARY'
        if (isAuthor) as = 'AUTHOR'
        else {
          if (!current)
            throw DomainError.rule('BR-040', 'Экспертиза завершена — статус замечания меняется в следующей экспертизе')
          const role = activeRole(await r().reviews.assignments(current.id), actor.userId)
          if (role !== 'PRIMARY')
            throw DomainError.forbidden('Закрывать замечания может только основной эксперт текущей экспертизы (BR-030)')
          as = 'PRIMARY'
        }
        const status = nextIssueStatus(issue.status, input.status, as)
        let addressedIn: string | null | undefined
        if (as === 'AUTHOR') {
          if (kind === 'test') {
            const t = await r().tests.findById(containerId)
            addressedIn = t?.currentDraftVersionId ?? issue.linkedVersionId
          } else {
            const it = await r().items.findById(containerId)
            addressedIn = it?.currentDraftVersionId ?? issue.linkedVersionId
          }
        }
        await uow.transaction(async (tx) => {
          await tx.reviews.updateIssue(issue.id, {
            status,
            note: input.note?.trim() || null,
            by: actor.userId,
            ...(addressedIn !== undefined ? { addressedInVersionId: addressedIn } : {}),
          })
          await tx.audit.record(
            actor,
            {
              action: 'review.issue.status',
              resourceType: 'review',
              resourceId: (current ?? origin).id,
              changes: { issueId: issue.id, from: issue.status, to: status },
            },
            ctx,
          )
        })
      },
    }),

    /** T6 (SPEC-REVIEW-003): вернуть на доработку — тест и пакет → CHANGES_REQUESTED атомарно. */
    requestChanges: useCase<{ reviewId: string; summary?: string | null; revision?: number }, void>({
      name: 'review.requestChanges',
      permission: 'review.perform',
      async run(actor, input, ctx) {
        const rv = await loadReview(input.reviewId)
        await requireRead(actor, rv)
        assertOpen(rv.status)
        await requirePrimary(actor, rv, 'Решение')
        if (rv.status !== 'IN_PROGRESS') throw new DomainError('INVALID_TRANSITION', 'Экспертиза не начата')
        const issues = await containerIssues(rv)
        const summary = input.summary?.trim() || null
        assertCanRequestChanges(issues.filter((i) => i.status === 'OPEN').length, summary)
        const pkg = await packageOf(rv)
        await uow.transaction(async (tx) => {
          if (rv.subjectType === 'TEST_VERSION') {
            const v = (await tx.tests.findVersion(rv.testVersionId!))!
            await tx.tests.setVersionState(v.id, {
              from: v.state,
              state: transition(v.state, 'requestChanges', 'test'),
            })
            for (const p of pkg.filter((x) => x.inPackage && x.state === 'IN_REVIEW'))
              await tx.items.setVersionState(p.itemVersionId, {
                from: p.state,
                state: transition(p.state, 'requestChanges', 'item'),
              })
          } else {
            const v = (await tx.items.findVersion(rv.itemVersionId!))!
            await tx.items.setVersionState(v.id, {
              from: v.state,
              state: transition(v.state, 'requestChanges', 'item'),
            })
          }
          await tx.reviews.setStatus(
            rv.id,
            {
              status: 'CHANGES_REQUESTED',
              decision: 'REQUEST_CHANGES',
              decidedBy: actor.userId,
              decidedAt: clock.now(),
              summary,
            },
            input.revision !== undefined ? Number(input.revision) : rv.revision,
          )
          await tx.reviews.closeAssignments(rv.id, 'COMPLETED')
          await tx.audit.record(
            actor,
            { action: 'review.changes_requested', resourceType: 'review', resourceId: rv.id, changes: { summary } },
            ctx,
          )
          await tx.audit.record(
            actor,
            {
              action: rv.subjectType === 'TEST_VERSION' ? 'test.changes_requested' : 'item.changes_requested',
              resourceType: rv.subjectType === 'TEST_VERSION' ? 'test' : 'item',
              resourceId: (rv.testId ?? rv.itemId)!,
              changes: { versionId: rv.testVersionId ?? rv.itemVersionId, reviewId: rv.id },
            },
            ctx,
          )
        })
      },
    }),

    /** T7 (SPEC-REVIEW-003): принять — пакет и тест → APPROVED, пулы правил замораживаются атомарно. */
    approve: useCase<{ reviewId: string; revision?: number }, void>({
      name: 'review.approve',
      permission: 'review.perform',
      async run(actor, input, ctx) {
        const rv = await loadReview(input.reviewId)
        await requireRead(actor, rv)
        assertOpen(rv.status)
        await requirePrimary(actor, rv, 'Решение')
        if (rv.status !== 'IN_PROGRESS') throw new DomainError('INVALID_TRANSITION', 'Экспертиза не начата')
        const template = (await r().reviews.template(rv.checklistTemplateId))!
        const problems: { field: string; message: string }[] = []
        for (const m of missingMandatory(template.items, await r().reviews.answers(rv.id)))
          problems.push({ field: `checklist.${m.code}`, message: `Не отмечен пункт checklist: ${m.text}` })
        for (const i of blockingOpen(await containerIssues(rv)))
          problems.push({ field: `issue.${i.id}`, message: `Открыто блокирующее замечание: ${i.body}` })
        if (problems.length)
          throw new DomainError('RULE_VIOLATION', 'Принять нельзя: ' + problems[0]!.message, {
            ruleId: 'BR-028',
            fieldErrors: problems,
          })

        const pkg = await packageOf(rv)
        const pkgErrors: { field: string; message: string }[] = []
        const versionIds = rv.subjectType === 'TEST_VERSION' ? pkg.map((p) => p.itemVersionId) : [rv.itemVersionId!]
        for (const p of pkg) {
          if (!(p.state === 'APPROVED' || (p.inPackage && p.state === 'IN_REVIEW')))
            pkgErrors.push({
              field: `item.${p.itemId}`,
              message: `Вопрос v${p.versionNo} не утвержден и не входит в пакет (BR-011)`,
            })
        }
        for (const id of versionIds) {
          for (const i of await deps.items.internal.validateVersion(id))
            if (i.severity === 'ERROR') pkgErrors.push({ field: `item.${id}`, message: i.message })
        }
        const pools: { ruleId: string; versionIds: string[] }[] = []
        if (rv.subjectType === 'TEST_VERSION') {
          const t = (await r().tests.findById(rv.testId!))!
          const s = await r().tests.structure(rv.testVersionId!)
          for (const rule of s.rules) {
            const pool = await r().tests.poolCandidates(
              t.courseId,
              rule.filter,
              s.fixed.map((f) => f.itemId),
            )
            if (pool.length < rule.count)
              pkgErrors.push({
                field: `rule.${rule.id}`,
                message: `В пуле правила ${pool.length} вопросов, требуется ${rule.count} (BR-012)`,
              })
            pools.push({ ruleId: rule.id, versionIds: pool.map((p) => p.itemVersionId) })
          }
        }
        if (pkgErrors.length) {
          const rule = pkgErrors.map((e) => /BR-\d+/.exec(e.message)?.[0]).find(Boolean) ?? 'BR-011'
          throw new DomainError('RULE_VIOLATION', 'Принять нельзя: ' + pkgErrors[0]!.message, {
            ruleId: rule,
            fieldErrors: pkgErrors,
          })
        }
        const now = clock.now()
        await uow.transaction(async (tx) => {
          const approveItem = async (versionId: string, itemId: string, state: VersionState) => {
            await tx.items.setVersionState(versionId, {
              from: state,
              state: transition(state, 'approve', 'item'),
              approvedAt: now,
              approvedBy: actor.userId,
            })
            await tx.items.setItemPointers(itemId, { latestApprovedVersionId: versionId })
            await tx.audit.record(
              actor,
              {
                action: 'item.approved',
                resourceType: 'item',
                resourceId: itemId,
                changes: { versionId, reviewId: rv.id },
              },
              ctx,
            )
          }
          if (rv.subjectType === 'TEST_VERSION') {
            for (const p of pkg.filter((x) => x.inPackage && x.state === 'IN_REVIEW'))
              await approveItem(p.itemVersionId, p.itemId, p.state)
            // пул замораживается, пока версия еще IN_REVIEW (триггер БД)
            for (const p of pools) await tx.tests.insertPoolEntries(p.ruleId, p.versionIds)
            const v = (await tx.tests.findVersion(rv.testVersionId!))!
            await tx.tests.setVersionState(v.id, {
              from: v.state,
              state: transition(v.state, 'approve', 'test'),
              approvedAt: now,
              approvedBy: actor.userId,
            })
            await tx.audit.record(
              actor,
              {
                action: 'test.approved',
                resourceType: 'test',
                resourceId: rv.testId!,
                changes: {
                  versionId: v.id,
                  reviewId: rv.id,
                  frozenPools: pools.map((p) => ({ ruleId: p.ruleId, size: p.versionIds.length })),
                },
              },
              ctx,
            )
          } else {
            const v = (await tx.items.findVersion(rv.itemVersionId!))!
            await approveItem(v.id, rv.itemId!, v.state)
          }
          await tx.reviews.setStatus(
            rv.id,
            { status: 'APPROVED', decision: 'APPROVE', decidedBy: actor.userId, decidedAt: now },
            input.revision !== undefined ? Number(input.revision) : rv.revision,
          )
          await tx.reviews.closeAssignments(rv.id, 'COMPLETED')
          await tx.audit.record(actor, { action: 'review.approved', resourceType: 'review', resourceId: rv.id }, ctx)
        })
      },
    }),

    // ---------------- шаблоны checklist ----------------
    listTemplates: useCase<Record<string, never>, ChecklistTemplateRecord[]>({
      name: 'checklist.list',
      permission: 'review.read',
      run: async () => r().reviews.listTemplates(),
    }),

    /** Новая версия шаблона: применяется к новым Review; существующие хранят ссылку на свою версию. */
    updateTemplate: useCase<
      { appliesTo: 'TEST_VERSION' | 'ITEM_VERSION'; name: string; items: ChecklistItem[] },
      { id: string }
    >({
      name: 'checklist.update',
      permission: 'checklist.manage',
      async run(actor, input, ctx) {
        const items = (input.items ?? []).map((i) => ({
          code: String(i.code ?? '')
            .trim()
            .toUpperCase(),
          text: String(i.text ?? '').trim(),
          mandatory: i.mandatory !== false,
        }))
        const e: { field: string; message: string }[] = []
        if (!items.length) e.push({ field: 'items', message: 'Добавьте хотя бы один пункт' })
        if (new Set(items.map((i) => i.code)).size !== items.length)
          e.push({ field: 'items', message: 'Коды пунктов должны быть уникальны' })
        if (items.some((i) => !/^[A-Z0-9_]{2,30}$/.test(i.code) || !i.text))
          e.push({ field: 'items', message: 'Каждый пункт: код (латиница, 2–30) и текст' })
        if (!input.name?.trim()) e.push({ field: 'name', message: 'Укажите название' })
        if (e.length) throw DomainError.validation(e)
        return uow.transaction(async (tx) => {
          const id = await tx.reviews.insertTemplate({
            name: input.name.trim(),
            appliesTo: input.appliesTo,
            items,
            createdBy: actor.userId,
          })
          await tx.audit.record(
            actor,
            {
              action: 'checklist.updated',
              resourceType: 'checklist',
              resourceId: id,
              changes: { appliesTo: input.appliesTo, items: items.length },
            },
            ctx,
          )
          return { id }
        })
      },
    }),
  }
}

export type ReviewUseCases = ReturnType<typeof createReviewUseCases>
