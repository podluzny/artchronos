import { DomainError } from '../shared/errors.js'

export const MAX_TOPIC_DEPTH = 3

/**
 * SPEC-EDU-001: родитель в том же курсе, без циклов, глубина ≤ 3.
 * `ancestors` — цепочка предков нового родителя (от родителя к корню), включая его самого.
 */
export function validateTopicParent(args: {
  topicId: string | null
  courseId: string
  parent: { id: string; courseId: string } | null
  ancestorIds: string[]
  subtreeDepth: number
}): void {
  const { topicId, courseId, parent, ancestorIds, subtreeDepth } = args
  if (!parent) {
    if (subtreeDepth > MAX_TOPIC_DEPTH)
      throw DomainError.validation([{ field: 'parentId', message: 'Превышена глубина вложенности тем (3)' }])
    return
  }
  if (parent.courseId !== courseId) {
    throw DomainError.validation([{ field: 'parentId', message: 'Родительская тема должна быть в том же курсе' }])
  }
  if (topicId && (parent.id === topicId || ancestorIds.includes(topicId))) {
    throw DomainError.validation([{ field: 'parentId', message: 'Циклическая вложенность тем' }])
  }
  const depth = ancestorIds.length + subtreeDepth
  if (depth > MAX_TOPIC_DEPTH) {
    throw DomainError.validation([{ field: 'parentId', message: 'Превышена глубина вложенности тем (3)' }])
  }
}
