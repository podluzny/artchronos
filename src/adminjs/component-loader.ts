import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ComponentLoader } from 'adminjs'

const here = path.dirname(fileURLToPath(import.meta.url))
// Компоненты лежат в исходниках (src/adminjs/components) и в dist не копируются компилятором.
const dir = here.includes(`${path.sep}dist${path.sep}`)
  ? path.join(here, '..', '..', 'src', 'adminjs', 'components')
  : path.join(here, 'components')

export const componentLoader = new ComponentLoader()

export const Components = {
  ActionForm: componentLoader.add('ActionForm', path.join(dir, 'ActionForm')),
  Dashboard: componentLoader.add('Dashboard', path.join(dir, 'Dashboard')),
}
