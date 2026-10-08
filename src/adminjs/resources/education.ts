import type { ResourceWithOptions } from 'adminjs'
import type { EducationUseCases } from '../../application/education/use-cases.js'
import { formAction, visibleIf } from '../actions.js'
import { currentScope } from '../context.js'
import { DomainResource, type ResourceGateway } from './domain-resource.js'
import { archiveActions, hidden, STATUS_ARCHIVE } from './helpers.js'

const NAV_EDU = { name: 'Учебная структура', icon: 'Book' }
const NAV_ASSIGN = { name: 'Задания', icon: 'Clipboard' }

const BLOOM = [
  { value: 'REMEMBER', label: 'Помнить' },
  { value: 'UNDERSTAND', label: 'Понимать' },
  { value: 'APPLY', label: 'Применять' },
  { value: 'ANALYZE', label: 'Анализировать' },
  { value: 'EVALUATE', label: 'Оценивать' },
  { value: 'CREATE', label: 'Создавать' },
]

const ASSIGNMENT_STATUS = [
  { value: 'DRAFT', label: 'Черновик' },
  { value: 'ACTIVE', label: 'Активно' },
  { value: 'CLOSED', label: 'Закрыто' },
  { value: 'ARCHIVED', label: 'В архиве' },
]

const QT_STATUS = [
  { value: 'ACTIVE', label: 'Активен' },
  { value: 'INACTIVE', label: 'Неактивен' },
]

/** AdminJS search по title-свойству приходит как фильтр этого свойства; переводим в фильтр use case. */
function renameFilter(q: { filters: Record<string, string> }, from: string, to: string) {
  if (q.filters[from] !== undefined) {
    q.filters[to] = q.filters[from]!
    delete q.filters[from]
  }
  return q
}

function iso(d: Date | null): string {
  return d ? d.toISOString() : ''
}

export function educationResources(edu: EducationUseCases): ResourceWithOptions[] {
  const ctx = () => currentScope().ctx

  // ---------------- Subject ----------------
  const subjectRecord = (s: Awaited<ReturnType<EducationUseCases['getSubject']['run']>>) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    courseCount: s.courseCount,
    status: s.status,
    archiveReason: s.archiveReason ?? '',
    revision: s.revision,
  })
  const subjects: ResourceGateway = {
    list: async (a, q, c) => {
      const r = await edu.listSubjects.run(a, q, c)
      return { records: r.records.map(subjectRecord), total: r.total }
    },
    get: async (a, id, c) => subjectRecord(await edu.getSubject.run(a, { id }, c)),
    create: async (a, p, c) => {
      const { id } = await edu.createSubject.run(a, { code: p.code, name: p.name }, c)
      return subjectRecord(await edu.getSubject.run(a, { id }, c))
    },
    update: async (a, id, p, c) => {
      await edu.updateSubject.run(a, { id, code: p.code, name: p.name, revision: Number(p.revision) }, c)
      return subjectRecord(await edu.getSubject.run(a, { id }, c))
    },
    delete: async (a, id, c) => edu.deleteSubject.run(a, { id }, c),
  }
  const isAdminTax = (a: { has: (k: string, s?: any) => boolean }) => a.has('taxonomy.manage', 'ANY')

  // ---------------- Course ----------------
  const courseRecord = (x: Awaited<ReturnType<EducationUseCases['getCourse']['run']>>) => ({
    id: x.id,
    subjectId: x.subjectId,
    code: x.code,
    name: x.name,
    academicPeriod: x.academicPeriod ?? '',
    teachers: x.teacherNames.join(', '),
    status: x.status,
    archiveReason: x.archiveReason ?? '',
    revision: x.revision,
  })
  const courses: ResourceGateway = {
    list: async (a, q, c) => {
      const r = await edu.listCourses.run(a, q, c)
      return { records: r.records.map(courseRecord), total: r.total }
    },
    get: async (a, id, c) => courseRecord(await edu.getCourse.run(a, { id }, c)),
    create: async (a, p, c) => {
      const { id } = await edu.createCourse.run(
        a,
        { subjectId: p.subjectId, code: p.code, name: p.name, academicPeriod: p.academicPeriod },
        c,
      )
      return courseRecord(await edu.getCourse.run(a, { id }, c))
    },
    update: async (a, id, p, c) => {
      await edu.updateCourse.run(
        a,
        {
          id,
          subjectId: p.subjectId,
          code: p.code,
          name: p.name,
          academicPeriod: p.academicPeriod,
          revision: Number(p.revision),
        },
        c,
      )
      return courseRecord(await edu.getCourse.run(a, { id }, c))
    },
    delete: async (a, id, c) => edu.deleteCourse.run(a, { id }, c),
  }

  // ---------------- Topic ----------------
  const topicRecord = (t: Awaited<ReturnType<EducationUseCases['getTopic']['run']>>) => ({
    id: t.id,
    courseId: t.courseId,
    parentId: t.parentId ?? '',
    name: t.name,
    path: t.path,
    depth: t.depth,
    ordinal: t.ordinal,
    status: t.status,
    archiveReason: t.archiveReason ?? '',
    revision: t.revision,
  })
  const topics: ResourceGateway = {
    list: async (a, q, c) => {
      const r = await edu.listTopics.run(a, renameFilter(q, 'path', 'name') as typeof q, c)
      return { records: r.records.map(topicRecord), total: r.total }
    },
    get: async (a, id, c) => topicRecord(await edu.getTopic.run(a, { id }, c)),
    create: async (a, p, c) => {
      const { id } = await edu.createTopic.run(
        a,
        { courseId: p.courseId, parentId: p.parentId || null, name: p.name, ordinal: p.ordinal },
        c,
      )
      return topicRecord(await edu.getTopic.run(a, { id }, c))
    },
    update: async (a, id, p, c) => {
      await edu.updateTopic.run(
        a,
        { id, parentId: p.parentId || null, name: p.name, ordinal: p.ordinal, revision: Number(p.revision) },
        c,
      )
      return topicRecord(await edu.getTopic.run(a, { id }, c))
    },
    delete: async (a, id, c) => edu.deleteTopic.run(a, { id }, c),
  }

  // ---------------- Objective ----------------
  const objectiveRecord = (o: Awaited<ReturnType<EducationUseCases['getObjective']['run']>>) => ({
    id: o.id,
    courseId: o.courseId,
    topicId: o.topicId,
    code: o.code,
    text: o.text,
    bloomLevel: o.bloomLevel ?? '',
    status: o.status,
    archiveReason: o.archiveReason ?? '',
    revision: o.revision,
  })
  const objectives: ResourceGateway = {
    list: async (a, q, c) => {
      const r = await edu.listObjectives.run(a, q, c)
      return { records: r.records.map(objectiveRecord), total: r.total }
    },
    get: async (a, id, c) => objectiveRecord(await edu.getObjective.run(a, { id }, c)),
    create: async (a, p, c) => {
      const { id } = await edu.createObjective.run(
        a,
        { topicId: p.topicId, code: p.code, text: p.text, bloomLevel: p.bloomLevel },
        c,
      )
      return objectiveRecord(await edu.getObjective.run(a, { id }, c))
    },
    update: async (a, id, p, c) => {
      await edu.updateObjective.run(
        a,
        { id, topicId: p.topicId, code: p.code, text: p.text, bloomLevel: p.bloomLevel, revision: Number(p.revision) },
        c,
      )
      return objectiveRecord(await edu.getObjective.run(a, { id }, c))
    },
    delete: async (a, id, c) => edu.deleteObjective.run(a, { id }, c),
  }

  // ---------------- Group ----------------
  const groupRecord = (g: Awaited<ReturnType<EducationUseCases['getGroup']['run']>>) => ({
    id: g.id,
    courseId: g.courseId,
    name: g.name,
    members: g.memberNames.join(', '),
    memberCount: g.memberIds.length,
    status: g.status,
    archiveReason: g.archiveReason ?? '',
    revision: g.revision,
  })
  const groups: ResourceGateway = {
    list: async (a, q, c) => {
      const r = await edu.listGroups.run(a, q, c)
      return { records: r.records.map(groupRecord), total: r.total }
    },
    get: async (a, id, c) => groupRecord(await edu.getGroup.run(a, { id }, c)),
    create: async (a, p, c) => {
      const { id } = await edu.createGroup.run(a, { courseId: p.courseId, name: p.name }, c)
      return groupRecord(await edu.getGroup.run(a, { id }, c))
    },
    update: async (a, id, p, c) => {
      await edu.updateGroup.run(a, { id, name: p.name, revision: Number(p.revision) }, c)
      return groupRecord(await edu.getGroup.run(a, { id }, c))
    },
  }

  // ---------------- Assignment ----------------
  const assignmentRecord = (
    x:
      | Awaited<ReturnType<EducationUseCases['getAssignment']['run']>>
      | Awaited<ReturnType<EducationUseCases['listAssignments']['run']>>['records'][number],
  ) => ({
    id: x.id,
    courseId: x.courseId,
    title: x.title,
    instructions: x.instructions ?? '',
    minItems: x.minItems,
    maxItems: x.maxItems,
    maxTestsPerStudent: x.maxTestsPerStudent,
    deadlineAt: iso(x.deadlineAt),
    myDeadline: 'myDeadline' in x ? iso(x.myDeadline) : '',
    status: x.status,
    owner: x.ownerName,
    defaultReviewer: x.defaultReviewerName ?? '',
    topicCount: x.topicIds.length,
    questionTypeCount: x.questionTypeIds.length,
    targetCount: x.targetUserIds.length + x.targetGroupIds.length,
    revision: x.revision,
  })
  const assignments: ResourceGateway = {
    list: async (a, q, c) => {
      const r = await edu.listAssignments.run(a, q, c)
      return { records: r.records.map(assignmentRecord), total: r.total }
    },
    get: async (a, id, c) => assignmentRecord(await edu.getAssignment.run(a, { id }, c)),
    create: async (a, p, c) => {
      const { id } = await edu.createAssignment.run(
        a,
        {
          courseId: p.courseId,
          title: p.title,
          instructions: p.instructions,
          minItems: p.minItems,
          maxItems: p.maxItems,
          maxTestsPerStudent: p.maxTestsPerStudent,
          deadlineAt: p.deadlineAt || null,
        },
        c,
      )
      return assignmentRecord(await edu.getAssignment.run(a, { id }, c))
    },
    update: async (a, id, p, c) => {
      await edu.updateAssignment.run(
        a,
        {
          id,
          title: p.title,
          instructions: p.instructions,
          minItems: p.minItems,
          maxItems: p.maxItems,
          maxTestsPerStudent: p.maxTestsPerStudent,
          deadlineAt: p.deadlineAt || null,
          revision: Number(p.revision),
        },
        c,
      )
      return assignmentRecord(await edu.getAssignment.run(a, { id }, c))
    },
  }

  const qtGateway: ResourceGateway = {
    list: async (a, q, c) => {
      const r = await edu.listQuestionTypes.run(a, q, c)
      return { records: r.records.map((t) => ({ ...t })), total: r.total }
    },
    get: async (a, id, c) => {
      const r = await edu.listQuestionTypes.run(a, { filters: {}, limit: 200, offset: 0 }, c)
      const t = r.records.find((x) => x.id === id)
      if (!t) throw new (await import('../../domain/shared/errors.js')).DomainError('NOT_FOUND', 'Тип не найден')
      return { ...t }
    },
  }

  const statusProp = { availableValues: STATUS_ARCHIVE }
  const crud = (read: string, manage: (a: any, r: any) => boolean) => ({
    list: { isAccessible: visibleIf((a) => a.has(read)) },
    search: { isAccessible: visibleIf((a) => a.has(read)) },
    show: { isAccessible: visibleIf((a) => a.has(read)) },
    new: { isAccessible: visibleIf((a) => manage(a, null)) },
    edit: { isAccessible: visibleIf((a, r) => r?.status !== 'ARCHIVED' && manage(a, r)) },
    delete: {
      isAccessible: visibleIf((a, r) => manage(a, r)),
      guard: 'Удалить? Используемые объекты удалить нельзя — их можно только архивировать.',
    },
    bulkDelete: { isAccessible: false, isVisible: false },
  })

  const goShow = (h: any, resourceId: string, id: string) =>
    h.recordActionUrl({ resourceId, recordId: id, actionName: 'show' })

  return [
    {
      resource: new DomainResource({
        id: 'Subject',
        gateway: subjects,
        properties: [
          { path: 'id', isId: true, type: 'uuid' },
          { path: 'code', isSortable: true },
          { path: 'name', isSortable: true },
          { path: 'courseCount', type: 'number' },
          { path: 'status' },
          { path: 'archiveReason' },
          { path: 'revision', type: 'number' },
        ],
      }),
      options: {
        id: 'Subject',
        navigation: NAV_EDU,
        titleProperty: 'name',
        listProperties: ['code', 'name', 'courseCount', 'status'],
        showProperties: ['code', 'name', 'courseCount', 'status', 'archiveReason'],
        editProperties: ['code', 'name'],
        filterProperties: ['code', 'name', 'status'],
        properties: { revision: hidden, status: statusProp },
        actions: {
          ...crud('taxonomy.read', isAdminTax),
          ...archiveActions({
            resourceId: 'Subject',
            canManage: isAdminTax,
            archive: edu.archiveSubject.run,
            restore: edu.restoreSubject.run,
          }),
        },
      },
    },
    {
      resource: new DomainResource({
        id: 'Course',
        gateway: courses,
        properties: [
          { path: 'id', isId: true, type: 'uuid' },
          { path: 'subjectId', type: 'reference', reference: 'Subject' },
          { path: 'code', isSortable: true },
          { path: 'name', isSortable: true },
          { path: 'academicPeriod' },
          { path: 'teachers' },
          { path: 'status' },
          { path: 'archiveReason' },
          { path: 'revision', type: 'number' },
        ],
      }),
      options: {
        id: 'Course',
        navigation: NAV_EDU,
        titleProperty: 'name',
        listProperties: ['code', 'name', 'subjectId', 'academicPeriod', 'teachers', 'status'],
        showProperties: ['code', 'name', 'subjectId', 'academicPeriod', 'teachers', 'status', 'archiveReason'],
        editProperties: ['subjectId', 'code', 'name', 'academicPeriod'],
        filterProperties: ['subjectId', 'code', 'name', 'status'],
        properties: { revision: hidden, status: statusProp },
        actions: {
          ...crud('taxonomy.read', isAdminTax),
          ...archiveActions({
            resourceId: 'Course',
            canManage: isAdminTax,
            archive: edu.archiveCourse.run,
            restore: edu.restoreCourse.run,
          }),
          teachers: formAction({
            actionType: 'record',
            icon: 'Users',
            isAccessible: visibleIf((a, r) => isAdminTax(a) && r?.status === 'ACTIVE'),
            submitLabel: 'Сохранить преподавателей',
            fields: [{ name: 'teacherIds', label: 'Преподаватели курса', type: 'checkboxes' }],
            load: async (actor, id) => {
              const c = await edu.getCourse.run(actor, { id: id! }, ctx())
              return {
                options: { teacherIds: await edu.userCandidates.run(actor, { role: 'TEACHER' }, ctx()) },
                initial: { teacherIds: c.teacherIds },
              }
            },
            submit: async (actor, p, id, c, h) => {
              const course = await edu.getCourse.run(actor, { id: id! }, c)
              await edu.updateCourse.run(
                actor,
                {
                  id: id!,
                  subjectId: course.subjectId,
                  code: course.code,
                  name: course.name,
                  academicPeriod: course.academicPeriod,
                  teacherIds: p.teacherIds ?? [],
                  revision: course.revision,
                },
                c,
              )
              return { redirectUrl: goShow(h, 'Course', id!), notice: 'Преподаватели сохранены' }
            },
          }),
        },
      },
    },
    {
      resource: new DomainResource({
        id: 'Topic',
        gateway: topics,
        properties: [
          { path: 'id', isId: true, type: 'uuid' },
          { path: 'courseId', type: 'reference', reference: 'Course' },
          { path: 'parentId', type: 'reference', reference: 'Topic' },
          { path: 'name' },
          { path: 'path' },
          { path: 'depth', type: 'number' },
          { path: 'ordinal', type: 'number' },
          { path: 'status' },
          { path: 'archiveReason' },
          { path: 'revision', type: 'number' },
        ],
      }),
      options: {
        id: 'Topic',
        navigation: NAV_EDU,
        titleProperty: 'path',
        listProperties: ['path', 'courseId', 'ordinal', 'status'],
        showProperties: ['path', 'name', 'courseId', 'parentId', 'ordinal', 'status', 'archiveReason'],
        editProperties: ['courseId', 'parentId', 'name', 'ordinal'],
        filterProperties: ['courseId', 'parentId', 'path', 'status'],
        properties: { revision: hidden, depth: hidden, status: statusProp },
        actions: {
          ...crud('taxonomy.read', (a) => a.has('taxonomy.manage')),
          ...archiveActions({
            resourceId: 'Topic',
            canManage: (a) => a.has('taxonomy.manage'),
            archive: edu.archiveTopic.run,
            restore: edu.restoreTopic.run,
            extraFields: [
              {
                name: 'cascade',
                label: 'Подтемы',
                type: 'select',
                options: [
                  { value: 'no', label: 'Не архивировать (отказ, если есть активные подтемы)' },
                  { value: 'yes', label: 'Архивировать вместе с подтемами' },
                ],
              },
            ],
          }),
        },
      },
    },
    {
      resource: new DomainResource({
        id: 'LearningObjective',
        gateway: objectives,
        properties: [
          { path: 'id', isId: true, type: 'uuid' },
          { path: 'courseId', type: 'reference', reference: 'Course' },
          { path: 'topicId', type: 'reference', reference: 'Topic' },
          { path: 'code' },
          { path: 'text', type: 'textarea' },
          { path: 'bloomLevel', availableValues: BLOOM },
          { path: 'status' },
          { path: 'archiveReason' },
          { path: 'revision', type: 'number' },
        ],
      }),
      options: {
        id: 'LearningObjective',
        navigation: NAV_EDU,
        titleProperty: 'code',
        listProperties: ['code', 'text', 'topicId', 'bloomLevel', 'status'],
        showProperties: ['code', 'text', 'courseId', 'topicId', 'bloomLevel', 'status', 'archiveReason'],
        editProperties: ['topicId', 'code', 'text', 'bloomLevel'],
        filterProperties: ['courseId', 'topicId', 'code', 'text', 'status'],
        properties: { revision: hidden, status: statusProp, bloomLevel: { availableValues: BLOOM } },
        actions: {
          ...crud('taxonomy.read', (a) => a.has('taxonomy.manage')),
          ...archiveActions({
            resourceId: 'LearningObjective',
            canManage: (a) => a.has('taxonomy.manage'),
            archive: edu.archiveObjective.run,
            restore: edu.restoreObjective.run,
          }),
        },
      },
    },
    {
      resource: new DomainResource({
        id: 'StudentGroup',
        gateway: groups,
        properties: [
          { path: 'id', isId: true, type: 'uuid' },
          { path: 'courseId', type: 'reference', reference: 'Course' },
          { path: 'name' },
          { path: 'members', type: 'textarea' },
          { path: 'memberCount', type: 'number' },
          { path: 'status' },
          { path: 'archiveReason' },
          { path: 'revision', type: 'number' },
        ],
      }),
      options: {
        id: 'StudentGroup',
        navigation: NAV_EDU,
        titleProperty: 'name',
        listProperties: ['name', 'courseId', 'memberCount', 'status'],
        showProperties: ['name', 'courseId', 'members', 'memberCount', 'status', 'archiveReason'],
        editProperties: ['courseId', 'name'],
        filterProperties: ['courseId', 'name', 'status'],
        properties: { revision: hidden, status: statusProp },
        actions: {
          ...crud('group.read', (a) => a.has('group.manage')),
          delete: { isAccessible: false, isVisible: false },
          ...archiveActions({
            resourceId: 'StudentGroup',
            canManage: (a) => a.has('group.manage'),
            archive: edu.archiveGroup.run,
            restore: edu.restoreGroup.run,
          }),
          members: formAction({
            actionType: 'record',
            icon: 'Users',
            isAccessible: visibleIf((a, r) => a.has('group.manage') && r?.status === 'ACTIVE'),
            submitLabel: 'Сохранить состав',
            fields: [{ name: 'memberIds', label: 'Студенты', type: 'checkboxes' }],
            load: async (actor, id) => {
              const g = await edu.getGroup.run(actor, { id: id! }, ctx())
              return {
                options: { memberIds: await edu.userCandidates.run(actor, { role: 'STUDENT' }, ctx()) },
                initial: { memberIds: g.memberIds },
              }
            },
            submit: async (actor, p, id, c, h) => {
              await edu.setGroupMembers.run(actor, { id: id!, memberIds: p.memberIds ?? [] }, c)
              return { redirectUrl: goShow(h, 'StudentGroup', id!), notice: 'Состав группы сохранен' }
            },
          }),
        },
      },
    },
    {
      resource: new DomainResource({
        id: 'QuestionType',
        gateway: qtGateway,
        properties: [
          { path: 'id', isId: true, type: 'uuid' },
          { path: 'code' },
          { path: 'name' },
          { path: 'interactionKey' },
          { path: 'status', availableValues: QT_STATUS },
        ],
      }),
      options: {
        id: 'QuestionType',
        navigation: { name: 'Банк вопросов', icon: 'Database' },
        titleProperty: 'name',
        listProperties: ['name', 'code', 'interactionKey', 'status'],
        filterProperties: ['name', 'status'],
        properties: { status: { availableValues: QT_STATUS } },
        actions: {
          list: { isAccessible: visibleIf((a) => a.has('qtype.read')) },
          search: { isAccessible: visibleIf((a) => a.has('qtype.read')) },
          show: { isAccessible: visibleIf((a) => a.has('qtype.read')) },
          new: { isAccessible: false, isVisible: false },
          edit: { isAccessible: false, isVisible: false },
          delete: { isAccessible: false, isVisible: false },
          bulkDelete: { isAccessible: false, isVisible: false },
        },
      },
    },
    {
      resource: new DomainResource({
        id: 'Assignment',
        gateway: assignments,
        properties: [
          { path: 'id', isId: true, type: 'uuid' },
          { path: 'courseId', type: 'reference', reference: 'Course' },
          { path: 'title', isSortable: true },
          { path: 'instructions', type: 'textarea' },
          { path: 'minItems', type: 'number' },
          { path: 'maxItems', type: 'number' },
          { path: 'maxTestsPerStudent', type: 'number' },
          { path: 'deadlineAt', type: 'datetime', isSortable: true },
          { path: 'myDeadline', type: 'datetime' },
          { path: 'status', isSortable: true, availableValues: ASSIGNMENT_STATUS },
          { path: 'owner' },
          { path: 'defaultReviewer' },
          { path: 'topicCount', type: 'number' },
          { path: 'questionTypeCount', type: 'number' },
          { path: 'targetCount', type: 'number' },
          { path: 'revision', type: 'number' },
        ],
      }),
      options: {
        id: 'Assignment',
        navigation: NAV_ASSIGN,
        titleProperty: 'title',
        sort: { sortBy: 'deadlineAt', direction: 'asc' },
        listProperties: ['title', 'courseId', 'deadlineAt', 'status', 'owner'],
        showProperties: [
          'title',
          'courseId',
          'status',
          'instructions',
          'deadlineAt',
          'myDeadline',
          'minItems',
          'maxItems',
          'maxTestsPerStudent',
          'owner',
          'defaultReviewer',
          'topicCount',
          'questionTypeCount',
          'targetCount',
        ],
        editProperties: [
          'courseId',
          'title',
          'instructions',
          'minItems',
          'maxItems',
          'maxTestsPerStudent',
          'deadlineAt',
        ],
        filterProperties: ['courseId', 'title', 'status'],
        properties: { revision: hidden, status: { availableValues: ASSIGNMENT_STATUS } },
        actions: {
          list: { isAccessible: visibleIf((a) => a.has('assignment.read')) },
          search: { isAccessible: visibleIf((a) => a.has('assignment.read')) },
          show: { isAccessible: visibleIf((a) => a.has('assignment.read')) },
          new: { isAccessible: visibleIf((a) => a.has('assignment.create')) },
          edit: {
            isAccessible: visibleIf((a, r) => a.has('assignment.update') && ['DRAFT', 'ACTIVE'].includes(r?.status)),
          },
          delete: { isAccessible: false, isVisible: false },
          bulkDelete: { isAccessible: false, isVisible: false },
          configure: formAction({
            actionType: 'record',
            icon: 'Settings',
            isAccessible: visibleIf((a, r) => a.has('assignment.update') && ['DRAFT', 'ACTIVE'].includes(r?.status)),
            description: 'Темы и учебные цели задания, допустимые типы вопросов, адресаты и эксперт по умолчанию.',
            submitLabel: 'Сохранить настройки',
            fields: [
              { name: 'topicIds', label: 'Темы', type: 'checkboxes', required: true },
              { name: 'objectiveIds', label: 'Учебные цели (из выбранных тем)', type: 'checkboxes' },
              { name: 'questionTypeIds', label: 'Допустимые типы вопросов', type: 'checkboxes', required: true },
              { name: 'targetGroupIds', label: 'Группы', type: 'checkboxes' },
              { name: 'targetUserIds', label: 'Отдельные студенты', type: 'checkboxes' },
              {
                name: 'defaultReviewerId',
                label: 'Эксперт по умолчанию',
                type: 'select',
                help: 'По умолчанию — автор задания',
              },
            ],
            load: async (actor, id) => {
              const [o, a] = await Promise.all([
                edu.assignmentOptions.run(actor, { id: id! }, ctx()),
                edu.getAssignment.run(actor, { id: id! }, ctx()),
              ])
              return {
                options: {
                  topicIds: o.topics,
                  objectiveIds: o.objectives,
                  questionTypeIds: o.questionTypes,
                  targetGroupIds: o.groups,
                  targetUserIds: o.students,
                  defaultReviewerId: o.reviewers,
                },
                initial: {
                  topicIds: a.topicIds,
                  objectiveIds: a.objectiveIds,
                  questionTypeIds: a.questionTypeIds,
                  targetGroupIds: a.targetGroupIds,
                  targetUserIds: a.targetUserIds,
                  defaultReviewerId: a.defaultReviewerId ?? '',
                },
              }
            },
            submit: async (actor, p, id, c, h) => {
              await edu.configureAssignment.run(
                actor,
                {
                  id: id!,
                  topicIds: p.topicIds ?? [],
                  objectiveIds: p.objectiveIds ?? [],
                  questionTypeIds: p.questionTypeIds ?? [],
                  targetGroupIds: p.targetGroupIds ?? [],
                  targetUserIds: p.targetUserIds ?? [],
                  defaultReviewerId: p.defaultReviewerId || null,
                },
                c,
              )
              return { redirectUrl: goShow(h, 'Assignment', id!), notice: 'Настройки задания сохранены' }
            },
          }),
          ...Object.fromEntries(
            (
              [
                ['activate', 'Активировать', 'Play', ['DRAFT'], 'Задание станет доступно адресатам.'],
                [
                  'close',
                  'Закрыть',
                  'Lock',
                  ['ACTIVE'],
                  'Новые вопросы, тесты и отправки по заданию станут невозможны; начатые экспертизы продолжаются.',
                ],
                ['reopen', 'Открыть заново', 'Unlock', ['CLOSED'], 'Задание снова станет активным.'],
                ['archive', 'В архив', 'Archive', ['DRAFT', 'CLOSED'], 'Задание будет скрыто из рабочих списков.'],
              ] as const
            ).map(([name, label, icon, from, description]) => [
              name,
              formAction({
                actionType: 'record',
                icon,
                label,
                description,
                submitLabel: label,
                variant: name === 'archive' ? 'danger' : 'contained',
                isAccessible: visibleIf(
                  (a, r) => a.has('assignment.update') && (from as readonly string[]).includes(r?.status),
                ),
                fields: name === 'activate' ? [] : [{ name: 'reason', label: 'Комментарий', type: 'textarea' }],
                submit: async (actor, p, id, c, h) => {
                  await edu.changeAssignmentStatus.run(actor, { id: id!, action: name, reason: p.reason }, c)
                  return { redirectUrl: goShow(h, 'Assignment', id!), notice: 'Статус задания изменен' }
                },
              }),
            ]),
          ),
          extendDeadline: formAction({
            actionType: 'record',
            icon: 'Calendar',
            isAccessible: visibleIf((a, r) => a.has('assignment.update') && r?.status === 'ACTIVE'),
            description: 'Персональное продление срока для студента (BR-031).',
            submitLabel: 'Продлить',
            fields: [
              { name: 'userId', label: 'Студент', type: 'select', required: true },
              {
                name: 'newDeadlineAt',
                label: 'Новый срок',
                type: 'text',
                required: true,
                help: 'Формат: ГГГГ-ММ-ДД ЧЧ:ММ',
              },
              { name: 'reason', label: 'Причина', type: 'textarea' },
            ],
            load: async (actor, id) => {
              const o = await edu.assignmentOptions.run(actor, { id: id! }, ctx())
              return { options: { userId: o.students } }
            },
            submit: async (actor, p, id, c, h) => {
              await edu.extendDeadline.run(
                actor,
                { id: id!, userId: p.userId, newDeadlineAt: p.newDeadlineAt, reason: p.reason },
                c,
              )
              return { redirectUrl: goShow(h, 'Assignment', id!), notice: 'Срок продлен' }
            },
          }),
        },
      },
    },
  ]
}
