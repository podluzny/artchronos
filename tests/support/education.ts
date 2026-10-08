import type { Actor } from '../../src/domain/authorization/actor.js'
import type { Services } from '../../src/server/container.js'
import { ctx, makeUser } from './fixtures.js'

let n = 0
/** Предмет + курс с преподавателем + тема/подтема + цель + группа со студентом + задание (ACTIVE). */
export async function makeCourseWorld(services: Services, admin: Actor) {
  n += 1
  const teacher = await makeUser(services, admin, ['TEACHER'])
  const student = await makeUser(services, admin, ['STUDENT'])
  const { id: subjectId } = await services.education.createSubject.run(
    admin,
    { code: `S${n}${Date.now() % 100000}`, name: `Предмет ${n}` },
    ctx,
  )
  const { id: courseId } = await services.education.createCourse.run(
    admin,
    { subjectId, code: `C${n}`, name: `Курс ${n}`, teacherIds: [teacher.id] },
    ctx,
  )
  const { id: topicId } = await services.education.createTopic.run(
    teacher.actor,
    { courseId, name: 'Пейзаж XIX века' },
    ctx,
  )
  const { id: subtopicId } = await services.education.createTopic.run(
    teacher.actor,
    { courseId, parentId: topicId, name: 'Передвижники' },
    ctx,
  )
  const { id: objectiveId } = await services.education.createObjective.run(
    teacher.actor,
    { topicId: subtopicId, code: `LO-${n}`, text: 'Атрибутировать произведение по стилю' },
    ctx,
  )
  const { id: groupId } = await services.education.createGroup.run(
    teacher.actor,
    { courseId, name: `Г-${n}`, memberIds: [student.id] },
    ctx,
  )
  const types = await services.education.listQuestionTypes.run(admin, { filters: {}, limit: 50, offset: 0 }, ctx)
  const qt = (code: string) => types.records.find((t) => t.code === code)!.id
  const { id: assignmentId } = await services.education.createAssignment.run(
    teacher.actor,
    {
      courseId,
      title: `Тест по пейзажу ${n}`,
      minItems: 2,
      maxItems: 5,
      deadlineAt: new Date(Date.now() + 7 * 24 * 3600_000),
    },
    ctx,
  )
  await services.education.configureAssignment.run(
    teacher.actor,
    {
      id: assignmentId,
      topicIds: [topicId],
      objectiveIds: [objectiveId],
      questionTypeIds: [qt('single_choice'), qt('image_choice')],
      targetUserIds: [],
      targetGroupIds: [groupId],
    },
    ctx,
  )
  await services.education.changeAssignmentStatus.run(teacher.actor, { id: assignmentId, action: 'activate' }, ctx)
  return { teacher, student, subjectId, courseId, topicId, subtopicId, objectiveId, groupId, assignmentId, qt }
}
