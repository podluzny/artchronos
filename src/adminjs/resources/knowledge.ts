import type { ResourceWithOptions } from 'adminjs'
import type { KnowledgeEntryRecord } from '../../application/knowledge/ports.js'
import type { KnowledgeUseCases } from '../../application/knowledge/use-cases.js'
import {
  KIND_ATTRS,
  KIND_PREFIX,
  LINK_RULES,
  WORK_KINDS,
  type KnowledgeKind,
  type LinkRelation,
} from '../../domain/knowledge/knowledge.js'
import { visibleIf } from '../actions.js'
import { DomainResource, type PropertyDef, type ResourceGateway } from './domain-resource.js'
import { archiveActions, hidden, STATUS_ARCHIVE } from './helpers.js'

export const NAV_MATERIALS = { name: 'Материалы', icon: 'Image' }

/** Ресурс AdminJS на каждый вид справочника (SPEC-KB-001, FR-KB-009). */
export const KNOWLEDGE_RESOURCES: Record<KnowledgeKind, string> = {
  PERSON: 'Person',
  ARTWORK: 'Artwork',
  COLLECTION: 'Collection',
  MOVEMENT: 'Movement',
  PERIOD: 'Period',
  TECHNIQUE: 'Technique',
  TERM: 'Term',
}

const USAGE_LABEL: Record<string, string> = {
  ITEM_VERSION: 'вопрос',
  TEST_VERSION: 'тест',
  ASSIGNMENT: 'задание',
  MEDIA: 'медиа (подпись)',
  KNOWLEDGE: 'объект (описание)',
  LINK: 'связь',
  MEDIA_ARTWORK: 'медиа (произведение)',
}

const ORDER: KnowledgeKind[] = ['PERSON', 'ARTWORK', 'COLLECTION', 'MOVEMENT', 'PERIOD', 'TECHNIQUE', 'TERM']

function toRecord(e: KnowledgeEntryRecord, usages?: { sourceType: string; title: string; field: string }[]) {
  const links: Record<string, string[]> = {}
  for (const rel of Object.keys(LINK_RULES[e.kind]) as LinkRelation[])
    links[rel] = (e.links[rel] ?? []).map((t) => t.id)
  const attrs: Record<string, string> = {}
  for (const k of KIND_ATTRS[e.kind]) {
    const v = e.attrs[k]
    attrs[k] = Array.isArray(v) ? v.join(', ') : v === undefined || v === null ? '' : String(v)
  }
  return {
    id: e.id,
    kind: e.kind,
    name: e.name,
    slug: e.slug,
    anchor: `@${KIND_PREFIX[e.kind]}:${e.slug}`,
    altNames: e.altNames.join(', '),
    yearFrom: e.yearFrom ?? '',
    yearTo: e.yearTo ?? '',
    description: e.description ?? '',
    attrs,
    links,
    usageCount: e.usageCount,
    usages: usages
      ? usages.length
        ? usages.map((u) => `${USAGE_LABEL[u.sourceType] ?? u.sourceType}: ${u.title}`).join('\n')
        : 'не используется'
      : '',
    status: e.status,
    archiveReason: e.archiveReason ?? '',
    revision: e.revision,
  }
}

function input(kind: KnowledgeKind, p: Record<string, any>) {
  const links: Partial<Record<LinkRelation, unknown>> = {}
  for (const rel of Object.keys(LINK_RULES[kind]) as LinkRelation[]) {
    const v = p.links?.[rel]
    links[rel] = Array.isArray(v) ? v : v ? [v] : []
  }
  return {
    name: p.name,
    slug: p.slug,
    altNames: p.altNames,
    description: p.description,
    yearFrom: p.yearFrom,
    yearTo: p.yearTo,
    attrs: p.attrs ?? {},
    links,
  }
}

const ATTR_LABEL_TYPE: Record<string, PropertyDef['type']> = { creditLineTemplate: 'textarea', forms: 'textarea' }
const YEARS: Partial<Record<KnowledgeKind, true>> = { PERSON: true, ARTWORK: true, MOVEMENT: true, PERIOD: true }

export function knowledgeResources(uc: KnowledgeUseCases): ResourceWithOptions[] {
  const canManage = (a: { has: (k: string) => boolean }) => a.has('knowledge.manage')
  return ORDER.map((kind) => {
    const id = KNOWLEDGE_RESOURCES[kind]
    const gateway: ResourceGateway = {
      list: async (a, q, c) => {
        const r = await uc.listEntries.run(a, { kind, query: q }, c)
        return { records: r.records.map((e) => toRecord(e)), total: r.total }
      },
      get: async (a, rid, c) => {
        const e = await uc.getEntry.run(a, { id: rid }, c)
        if (e.kind !== kind) throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' })
        return toRecord(e, await uc.usages.run(a, { id: rid }, c))
      },
      create: async (a, p, c) => {
        const { id: newId } = await uc.createEntry.run(a, { kind, ...input(kind, p) }, c)
        return toRecord(await uc.getEntry.run(a, { id: newId }, c))
      },
      update: async (a, rid, p, c) => {
        await uc.updateEntry.run(a, { id: rid, revision: Number(p.revision), ...input(kind, p) }, c)
        return toRecord(await uc.getEntry.run(a, { id: rid }, c))
      },
      delete: async (a, rid, c) => uc.deleteEntry.run(a, { id: rid }, c),
    }
    const attrPaths = KIND_ATTRS[kind].map((k) => `attrs.${k}`)
    const linkPaths = Object.keys(LINK_RULES[kind]).map((rel) => `links.${rel}`)
    const yearPaths = YEARS[kind] ? ['yearFrom', 'yearTo'] : []
    const properties: PropertyDef[] = [
      { path: 'id', isId: true, type: 'uuid' },
      { path: 'name', isSortable: true },
      { path: 'slug', isSortable: true },
      { path: 'anchor' },
      { path: 'altNames', type: 'textarea' },
      ...(YEARS[kind]
        ? [
            { path: 'yearFrom', type: 'number' as const, isSortable: true },
            { path: 'yearTo', type: 'number' as const },
          ]
        : []),
      ...KIND_ATTRS[kind].map((k): PropertyDef =>
        k === 'workKind'
          ? { path: `attrs.${k}`, availableValues: WORK_KINDS }
          : { path: `attrs.${k}`, type: ATTR_LABEL_TYPE[k] ?? 'string' },
      ),
      ...(Object.entries(LINK_RULES[kind]) as [LinkRelation, { to: KnowledgeKind; single?: boolean }][]).map(
        ([rel, rule]): PropertyDef => ({
          path: `links.${rel}`,
          type: 'reference',
          reference: KNOWLEDGE_RESOURCES[rule.to],
          isArray: !rule.single,
        }),
      ),
      { path: 'description', type: 'textarea' },
      { path: 'usageCount', type: 'number' },
      { path: 'usages', type: 'textarea' },
      { path: 'status', availableValues: STATUS_ARCHIVE },
      { path: 'archiveReason' },
      { path: 'revision', type: 'number' },
      { path: 'kind' },
    ]
    return {
      resource: new DomainResource({ id, gateway, properties }),
      options: {
        id,
        navigation: NAV_MATERIALS,
        titleProperty: 'name',
        listProperties: ['name', ...yearPaths, ...linkPaths.slice(0, 1), 'anchor', 'usageCount'],
        showProperties: [
          'name',
          'anchor',
          'altNames',
          ...yearPaths,
          ...attrPaths,
          ...linkPaths,
          'description',
          'usages',
          'status',
          'archiveReason',
        ],
        editProperties: ['name', 'slug', 'altNames', ...yearPaths, ...attrPaths, ...linkPaths, 'description'],
        filterProperties: ['name', 'slug', 'status'],
        properties: { revision: hidden, kind: hidden, status: { availableValues: STATUS_ARCHIVE } },
        actions: {
          list: { isAccessible: visibleIf((a) => a.has('knowledge.read')) },
          search: { isAccessible: visibleIf((a) => a.has('knowledge.read')) },
          show: { isAccessible: visibleIf((a) => a.has('knowledge.read')) },
          new: { isAccessible: visibleIf((a) => canManage(a)) },
          edit: { isAccessible: visibleIf((a, r) => r?.status !== 'ARCHIVED' && canManage(a)) },
          delete: {
            isAccessible: visibleIf((a) => canManage(a)),
            guard: 'Удалить? Используемые объекты удалить нельзя — их можно только архивировать (BR-047).',
          },
          bulkDelete: { isAccessible: false, isVisible: false },
          ...archiveActions({
            resourceId: id,
            canManage: (a) => canManage(a),
            archive: uc.archiveEntry.run,
            restore: uc.restoreEntry.run,
          }),
        },
      },
    }
  })
}
