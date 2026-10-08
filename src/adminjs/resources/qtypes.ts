import type { ResourceWithOptions } from 'adminjs'
import type { QuestionTypeFull } from '../../application/itembank/ports.js'
import type { QtypeUseCases } from '../../application/itembank/qtype-use-cases.js'
import { DomainError } from '../../domain/shared/errors.js'
import { formAction, visibleIf } from '../actions.js'
import { Components } from '../component-loader.js'
import { currentScope } from '../context.js'
import { DomainResource, type ResourceGateway } from './domain-resource.js'
import { hidden } from './helpers.js'

const QT_STATUS = [
  { value: 'ACTIVE', label: 'Активен' },
  { value: 'INACTIVE', label: 'Неактивен' },
]

function record(t: QuestionTypeFull) {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    description: t.description ?? '',
    interactionKey: t.interactionKey,
    status: t.status,
    version: t.currentVersion ? `v${t.currentVersion.versionNo}` : '—',
    config: JSON.stringify(t.currentVersion?.interactionConfig ?? {}, null, 2),
    evaluation: t.currentVersion?.evaluation.method ?? '',
    versions: t.versions.map((v) => `v${v.versionNo} — ${v.createdAt.toISOString().slice(0, 10)}`).join('\n'),
    itemCount: t.itemCount,
    activeAssignmentCount: t.activeAssignmentCount,
    revision: t.revision,
  }
}

function parseJson(text: string, field: string): unknown {
  try {
    return JSON.parse(text || '{}')
  } catch {
    throw DomainError.validation([{ field, message: 'Некорректный JSON' }])
  }
}

export function qtypeResources(uc: QtypeUseCases): ResourceWithOptions[] {
  const ctx = () => currentScope().ctx
  const gateway: ResourceGateway = {
    list: async (a, q, c) => {
      const r = await uc.listQuestionTypesFull.run(a, q, c)
      return { records: r.records.map(record), total: r.total }
    },
    get: async (a, id, c) => record(await uc.getQuestionType.run(a, { id }, c)),
    update: async (a, id, p, c) => {
      await uc.updateQuestionType.run(
        a,
        { id, name: p.name, description: p.description, revision: Number(p.revision) },
        c,
      )
      return record(await uc.getQuestionType.run(a, { id }, c))
    },
  }
  const interactionOptions = async (actor: Parameters<ResourceGateway['list']>[0]) =>
    (await uc.listInteractions.run(actor, undefined, ctx())).map((i) => ({
      value: i.key,
      label: `${i.title} (${i.key})`,
    }))
  const evaluatorOptions = async (actor: Parameters<ResourceGateway['list']>[0]) =>
    (await uc.listInteractions.run(actor, undefined, ctx())).flatMap((i) =>
      i.evaluators.map((e) => ({ value: e.key, label: `${e.label} (${e.key})`, group: i.title })),
    )
  const back = (h: any, id: string) =>
    h.recordActionUrl({ resourceId: 'QuestionType', recordId: id, actionName: 'show' })

  return [
    {
      resource: new DomainResource({
        id: 'QuestionType',
        gateway,
        properties: [
          { path: 'id', isId: true, type: 'uuid' },
          { path: 'code' },
          { path: 'name' },
          { path: 'description', type: 'textarea' },
          { path: 'interactionKey' },
          { path: 'status', availableValues: QT_STATUS },
          { path: 'version' },
          { path: 'config', type: 'textarea' },
          { path: 'evaluation' },
          { path: 'versions', type: 'textarea' },
          { path: 'itemCount', type: 'number' },
          { path: 'activeAssignmentCount', type: 'number' },
          { path: 'revision', type: 'number' },
        ],
      }),
      options: {
        id: 'QuestionType',
        navigation: { name: 'Банк вопросов', icon: 'Database' },
        titleProperty: 'name',
        listProperties: ['name', 'code', 'interactionKey', 'version', 'status'],
        showProperties: [
          'name',
          'code',
          'description',
          'interactionKey',
          'status',
          'version',
          'evaluation',
          'config',
          'versions',
          'itemCount',
          'activeAssignmentCount',
        ],
        editProperties: ['name', 'description'],
        filterProperties: ['name', 'status'],
        properties: {
          revision: hidden,
          status: { availableValues: QT_STATUS },
          config: { components: { show: Components.JsonView } },
        },
        actions: {
          list: { isAccessible: visibleIf((a) => a.has('qtype.read')) },
          search: { isAccessible: visibleIf((a) => a.has('qtype.read')) },
          show: { isAccessible: visibleIf((a) => a.has('qtype.read')) },
          edit: { isAccessible: visibleIf((a) => a.has('qtype.manage')) },
          delete: { isAccessible: false, isVisible: false },
          bulkDelete: { isAccessible: false, isVisible: false },
          new: formAction({
            actionType: 'resource',
            icon: 'Plus',
            isAccessible: visibleIf((a) => a.has('qtype.manage')),
            description:
              'Новый тип настраивается на основе interaction-плагина из кода (BR-023). Конфигурация — JSON в пределах схемы плагина; пустое поле — конфигурация плагина по умолчанию. Тип создается неактивным.',
            submitLabel: 'Создать тип',
            fields: [
              { name: 'code', label: 'Код (латиница, a-z0-9_)', required: true },
              { name: 'name', label: 'Название', required: true },
              { name: 'description', label: 'Описание', type: 'textarea' },
              { name: 'interactionKey', label: 'Interaction', type: 'select', required: true },
              { name: 'config', label: 'Конфигурация (JSON)', type: 'textarea' },
              { name: 'evaluation', label: 'Метод оценивания', type: 'select', required: true },
            ],
            load: async (actor) => ({
              options: { interactionKey: await interactionOptions(actor), evaluation: await evaluatorOptions(actor) },
            }),
            submit: async (actor, p, _id, c, h) => {
              const { id } = await uc.createQuestionType.run(
                actor,
                {
                  code: p.code,
                  name: p.name,
                  description: p.description,
                  interactionKey: p.interactionKey,
                  config: p.config ? parseJson(p.config, 'config') : undefined,
                  evaluation: { method: p.evaluation },
                },
                c,
              )
              return { redirectUrl: back(h, id), notice: 'Тип создан (неактивен)' }
            },
          }),
          configure: formAction({
            actionType: 'record',
            icon: 'Settings',
            isAccessible: visibleIf((a) => a.has('qtype.manage')),
            description:
              'Изменение конфигурации создает новую версию типа (BR-022). Существующие вопросы остаются на своей версии.',
            submitLabel: 'Сохранить как новую версию',
            fields: [
              { name: 'config', label: 'Конфигурация (JSON)', type: 'textarea', required: true },
              { name: 'evaluation', label: 'Метод оценивания', type: 'select', required: true },
            ],
            load: async (actor, id) => {
              const t = await uc.getQuestionType.run(actor, { id: id! }, ctx())
              const ev = (await uc.listInteractions.run(actor, undefined, ctx())).find(
                (i) => i.key === t.interactionKey,
              )!.evaluators
              return {
                options: { evaluation: ev.map((e) => ({ value: e.key, label: e.label })) },
                initial: {
                  config: JSON.stringify(t.currentVersion?.interactionConfig ?? {}, null, 2),
                  evaluation: t.currentVersion?.evaluation.method,
                },
              }
            },
            submit: async (actor, p, id, c, h) => {
              const t = await uc.getQuestionType.run(actor, { id: id! }, c)
              const r = await uc.updateQuestionType.run(
                actor,
                {
                  id: id!,
                  config: parseJson(p.config, 'config'),
                  evaluation: { method: p.evaluation },
                  revision: t.revision,
                },
                c,
              )
              return {
                redirectUrl: back(h, id!),
                notice: r.versionNo ? `Создана версия v${r.versionNo}` : 'Изменений нет',
              }
            },
          }),
          activate: formAction({
            actionType: 'record',
            icon: 'Play',
            isAccessible: visibleIf((a, r) => a.has('qtype.manage') && r?.status === 'INACTIVE'),
            submitLabel: 'Активировать',
            fields: [],
            submit: async (actor, _p, id, c, h) => {
              await uc.setQuestionTypeStatus.run(actor, { id: id!, status: 'ACTIVE' }, c)
              return { redirectUrl: back(h, id!), notice: 'Тип активирован' }
            },
          }),
          deactivate: formAction({
            actionType: 'record',
            icon: 'Pause',
            variant: 'danger',
            isAccessible: visibleIf((a, r) => a.has('qtype.manage') && r?.status === 'ACTIVE'),
            description:
              'Новые вопросы этого типа создать будет нельзя; существующие вопросы и тесты не затрагиваются (BR-021).',
            submitLabel: 'Деактивировать',
            fields: [],
            submit: async (actor, _p, id, c, h) => {
              const r = await uc.setQuestionTypeStatus.run(actor, { id: id!, status: 'INACTIVE' }, c)
              return {
                redirectUrl: back(h, id!),
                notice: r.activeAssignments
                  ? `Тип деактивирован. Разрешен в активных заданиях: ${r.activeAssignments}`
                  : 'Тип деактивирован',
              }
            },
          }),
        },
      },
    },
  ]
}
