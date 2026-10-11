import { z } from 'zod'
import {
  assertYears,
  FORBIDDEN_LABEL_CHARS,
  KIND_ATTRS,
  KIND_LABEL,
  KNOWLEDGE_KINDS,
  LINK_RULES,
  slugify,
  validateLinks,
  validateSlug,
  WORK_KINDS,
  type KnowledgeKind,
  type LinkRelation,
} from '../../domain/knowledge/knowledge.js'
import { assertCanArchive, assertCanRestore } from '../../domain/shared/archivable.js'
import { DomainError, type FieldError } from '../../domain/shared/errors.js'
import { diff } from '../shared/audit.js'
import type { ListQuery } from '../shared/query.js'
import type { UnitOfWork } from '../shared/uow.js'
import { useCase } from '../shared/use-case.js'
import type { KnowledgeEntryData, KnowledgeEntryRecord, KnowledgeTx, KnowledgeUsage } from './ports.js'
import { normalizeTexts } from './references.js'

export interface KnowledgeDeps {
  uow: UnitOfWork<KnowledgeTx>
}

/** Входные данные формы: строки из AdminJS или массивы из API. */
export interface KnowledgeInput {
  name?: unknown
  slug?: unknown
  altNames?: unknown
  description?: unknown
  yearFrom?: unknown
  yearTo?: unknown
  attrs?: Record<string, unknown>
  links?: Partial<Record<LinkRelation, unknown>>
}

const list = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  if (typeof v === 'string')
    return v
      .split(/[\n,;]/)
      .map((x) => x.trim())
      .filter(Boolean)
  return []
}
const ids = (v: unknown): string[] => [...new Set(list(v))]
const text = (v: unknown, max: number, field: string, errors: FieldError[]): string | null => {
  const s = v === null || v === undefined ? '' : String(v).trim()
  if (s.length > max) errors.push({ field, message: `Не более ${max} символов` })
  return s ? s : null
}
const year = (v: unknown, field: string, errors: FieldError[]): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isInteger(n)) {
    errors.push({ field, message: 'Целое число' })
    return null
  }
  return n
}

function parseData(kind: KnowledgeKind, input: KnowledgeInput): KnowledgeEntryData {
  const errors: FieldError[] = []
  const name = text(input.name, 300, 'name', errors)
  if (!name) errors.push({ field: 'name', message: 'Обязательное поле' })
  else if (FORBIDDEN_LABEL_CHARS.test(name))
    errors.push({ field: 'name', message: 'Название не может содержать [ ] < >' })
  const slug = (text(input.slug, 80, 'slug', errors) ?? slugify(name ?? '')).toLowerCase()
  const slugErr = validateSlug(slug)
  if (slugErr) errors.push(slugErr)
  const altNames = list(input.altNames).slice(0, 30)
  if (altNames.some((a) => a.length > 300 || FORBIDDEN_LABEL_CHARS.test(a)))
    errors.push({ field: 'altNames', message: 'Вариант: до 300 символов, без [ ] < >' })
  const description = text(input.description, 5000, 'description', errors)
  const yearFrom = year(input.yearFrom, 'yearFrom', errors)
  const yearTo = year(input.yearTo, 'yearTo', errors)
  const attrs: Record<string, unknown> = {}
  for (const k of KIND_ATTRS[kind]) {
    const v = input.attrs?.[k]
    if (k === 'forms') {
      const forms = list(v).slice(0, 30)
      if (forms.length) attrs.forms = forms
      continue
    }
    const s = text(v, k === 'creditLineTemplate' ? 500 : 300, `attrs.${k}`, errors)
    if (!s) continue
    if (k === 'workKind' && !WORK_KINDS.some((w) => w.value === s))
      errors.push({ field: 'attrs.workKind', message: 'Неизвестный вид произведения' })
    if (k === 'url' && !/^https?:\/\//i.test(s))
      errors.push({ field: 'attrs.url', message: 'URL должен начинаться с http(s)://' })
    attrs[k] = s
  }
  if (errors.length) throw DomainError.validation(errors)
  assertYears(yearFrom, yearTo)
  return { slug, name: name!, altNames, description, yearFrom, yearTo, attrs }
}

function parseLinks(kind: KnowledgeKind, input: KnowledgeInput): Partial<Record<LinkRelation, string[]>> {
  const out: Partial<Record<LinkRelation, string[]>> = {}
  for (const [rel, v] of Object.entries(input.links ?? {}) as [LinkRelation, unknown][]) {
    const l = ids(v)
    if (l.length || LINK_RULES[kind][rel]) out[rel] = l
  }
  return out
}

const kindSchema = z.enum(KNOWLEDGE_KINDS)

export function createKnowledgeUseCases(deps: KnowledgeDeps) {
  const { uow } = deps
  const repo = () => uow.read.knowledge

  async function load(id: string) {
    const e = await repo().findById(id)
    if (!e) throw DomainError.notFound()
    return e
  }

  async function checkLinks(
    kind: KnowledgeKind,
    selfId: string | null,
    links: Partial<Record<LinkRelation, string[]>>,
    before: KnowledgeEntryRecord | null,
  ) {
    const all = Object.values(links).flat() as string[]
    const targets = new Map((await repo().findTargets(all)).map((t) => [t.id, t]))
    const previous = new Set(
      Object.entries(before?.links ?? {}).flatMap(([rel, l]) => (l ?? []).map((t) => `${rel}:${t.id}`)),
    )
    const errors = validateLinks(kind, selfId, links, targets, previous)
    if (errors.length) throw DomainError.validation(errors)
  }

  const snapshot = (d: KnowledgeEntryData, links: Partial<Record<LinkRelation, string[]>>) => ({
    ...d,
    links,
  })

  return {
    listEntries: useCase<
      { kind: KnowledgeKind | null; query: ListQuery },
      { records: KnowledgeEntryRecord[]; total: number }
    >({
      name: 'knowledge.list',
      permission: 'knowledge.read',
      run: async (_a, { kind, query }) => repo().list(kind, query),
    }),

    getEntry: useCase<{ id: string }, KnowledgeEntryRecord>({
      name: 'knowledge.get',
      permission: 'knowledge.read',
      run: async (_a, { id }) => load(id),
    }),

    usages: useCase<{ id: string }, KnowledgeUsage[]>({
      name: 'knowledge.usages',
      permission: 'knowledge.read',
      async run(_a, { id }) {
        await load(id)
        return repo().usages(id)
      },
    }),

    /** AC-KB-001.1, .2, .4: создание; slug по умолчанию — из названия. */
    createEntry: useCase<KnowledgeInput & { kind: string }, { id: string }>({
      name: 'knowledge.create',
      permission: 'knowledge.manage',
      async run(actor, input, ctx) {
        const k = kindSchema.safeParse(input.kind)
        if (!k.success) throw DomainError.validation([{ field: 'kind', message: 'Неизвестный вид объекта' }])
        const kind = k.data
        const d = parseData(kind, input)
        if (await repo().slugTaken(kind, d.slug, null))
          throw DomainError.validation([{ field: 'slug', message: `Slug «${d.slug}» уже занят в этом справочнике` }])
        const links = parseLinks(kind, input)
        await checkLinks(kind, null, links, null)
        const norm = await normalizeTexts(repo(), { description: d.description })
        d.description = norm.texts.description ?? null
        return uow.transaction(async (tx) => {
          const id = await tx.knowledge.insert(kind, d, actor.userId)
          await tx.knowledge.setLinks(id, links)
          await tx.knowledge.replaceRefs('KNOWLEDGE', id, norm.refs)
          await tx.audit.record(
            actor,
            {
              action: 'knowledge.created',
              resourceType: 'knowledge',
              resourceId: id,
              changes: { kind, ...snapshot(d, links) },
            },
            ctx,
          )
          return { id }
        })
      },
    }),

    /** AC-KB-001.6: slug используемого объекта не меняется (BR-048). */
    updateEntry: useCase<KnowledgeInput & { id: string; revision: number }, void>({
      name: 'knowledge.update',
      permission: 'knowledge.manage',
      async run(actor, input, ctx) {
        const before = await load(input.id)
        if (before.status === 'ARCHIVED') throw new DomainError('INVALID_STATE', 'Объект в архиве')
        const d = parseData(before.kind, { slug: before.slug, ...input })
        if (d.slug !== before.slug) {
          if ((await repo().usageCount(before.id)) > 0)
            throw DomainError.rule('BR-048', 'На объект есть ссылки — slug изменить нельзя', 'slug')
          if (await repo().slugTaken(before.kind, d.slug, before.id))
            throw DomainError.validation([{ field: 'slug', message: `Slug «${d.slug}» уже занят в этом справочнике` }])
        }
        const links =
          input.links === undefined
            ? Object.fromEntries(Object.entries(before.links).map(([r, l]) => [r, (l ?? []).map((t) => t.id)]))
            : parseLinks(before.kind, input)
        await checkLinks(before.kind, before.id, links, before)
        const allow = new Set(await repo().refsOf('KNOWLEDGE', before.id))
        const norm = await normalizeTexts(repo(), { description: d.description }, allow)
        d.description = norm.texts.description ?? null
        await uow.transaction(async (tx) => {
          await tx.knowledge.update(before.id, d, Number(input.revision))
          await tx.knowledge.setLinks(before.id, links)
          await tx.knowledge.replaceRefs(
            'KNOWLEDGE',
            before.id,
            norm.refs.filter((r) => r.entryId !== before.id),
          )
          const prevLinks = Object.fromEntries(
            Object.entries(before.links).map(([r, l]) => [r, (l ?? []).map((t) => t.id)]),
          )
          await tx.audit.record(
            actor,
            {
              action: 'knowledge.updated',
              resourceType: 'knowledge',
              resourceId: before.id,
              changes: diff(
                snapshot(
                  {
                    slug: before.slug,
                    name: before.name,
                    altNames: before.altNames,
                    description: before.description,
                    yearFrom: before.yearFrom,
                    yearTo: before.yearTo,
                    attrs: before.attrs,
                  },
                  prevLinks,
                ),
                snapshot(d, links),
              ),
            },
            ctx,
          )
        })
      },
    }),

    archiveEntry: useCase<{ id: string; reason?: string }, void>({
      name: 'knowledge.archive',
      permission: 'knowledge.manage',
      async run(actor, { id, reason }, ctx) {
        const e = await load(id)
        const r = assertCanArchive(e.status, reason)
        await uow.transaction(async (tx) => {
          await tx.knowledge.setArchived(id, true, actor.userId, r)
          await tx.audit.record(
            actor,
            {
              action: 'knowledge.archived',
              resourceType: 'knowledge',
              resourceId: id,
              reason: r,
              changes: { name: e.name },
            },
            ctx,
          )
        })
      },
    }),

    restoreEntry: useCase<{ id: string }, void>({
      name: 'knowledge.restore',
      permission: 'knowledge.manage',
      async run(actor, { id }, ctx) {
        const e = await load(id)
        assertCanRestore(e.status)
        await uow.transaction(async (tx) => {
          await tx.knowledge.setArchived(id, false, actor.userId, null)
          await tx.audit.record(
            actor,
            { action: 'knowledge.restored', resourceType: 'knowledge', resourceId: id, changes: { name: e.name } },
            ctx,
          )
        })
      },
    }),

    /** AC-KB-001.5: используемый объект не удаляется (BR-047). */
    deleteEntry: useCase<{ id: string }, void>({
      name: 'knowledge.delete',
      permission: 'knowledge.manage',
      async run(actor, { id }, ctx) {
        const e = await load(id)
        if ((await repo().usageCount(id)) > 0)
          throw DomainError.rule(
            'BR-047',
            `${KIND_LABEL[e.kind]} «${e.name}» используется — удаление невозможно, используйте архивирование`,
          )
        await uow.transaction(async (tx) => {
          await tx.knowledge.delete(id)
          await tx.audit.record(
            actor,
            {
              action: 'knowledge.deleted',
              resourceType: 'knowledge',
              resourceId: id,
              changes: { kind: e.kind, slug: e.slug, name: e.name },
            },
            ctx,
          )
        })
      },
    }),
  }
}

export type KnowledgeUseCases = ReturnType<typeof createKnowledgeUseCases>
