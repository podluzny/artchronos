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
  MediaThumb: componentLoader.add('MediaThumb', path.join(dir, 'MediaThumb')),
  MediaUpload: componentLoader.add('MediaUpload', path.join(dir, 'MediaUpload')),
  ItemEditor: componentLoader.add('ItemEditor', path.join(dir, 'ItemEditor')),
  ItemCard: componentLoader.add('ItemCard', path.join(dir, 'ItemCard')),
  ItemPreview: componentLoader.add('ItemPreview', path.join(dir, 'ItemPreview')),
  JsonView: componentLoader.add('JsonView', path.join(dir, 'JsonView')),
  TestBuilder: componentLoader.add('TestBuilder', path.join(dir, 'TestBuilder')),
  TestPreview: componentLoader.add('TestPreview', path.join(dir, 'TestPreview')),
  ReviewWorkspace: componentLoader.add('ReviewWorkspace', path.join(dir, 'ReviewWorkspace')),
  AssignmentSummary: componentLoader.add('AssignmentSummary', path.join(dir, 'AssignmentSummary')),
}
