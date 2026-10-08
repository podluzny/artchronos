import { createRegistry, type InteractionPlugin } from '../../domain/itembank/interaction.js'
import { choicePlugin } from './choice.js'
import { matchPlugin } from './match.js'
import { orderPlugin } from './order.js'
import { extendedTextPlugin, textEntryPlugin } from './text.js'

/** Реестр interaction-плагинов (ADR-001). Новый interaction = новый модуль + строка здесь. */
export const MVP_PLUGINS: InteractionPlugin[] = [
  choicePlugin,
  matchPlugin,
  orderPlugin,
  textEntryPlugin,
  extendedTextPlugin,
]

export function createInteractionRegistry(extra: InteractionPlugin[] = []) {
  return createRegistry([...MVP_PLUGINS, ...extra])
}
