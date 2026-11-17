import type { AdmissionTask } from './types'

export function visibleAdministrativeTasks(tasks: readonly AdmissionTask[], query: URLSearchParams): AdmissionTask[] {
  const history = query.get('tab') === 'history'
  const search = (query.get('recherche') ?? '').trim().toLocaleLowerCase('fr')
  return tasks.filter(task => (history ? task.status === 'completed' || task.status === 'cancelled' : task.status === 'pending' || task.status === 'in_progress')
    && (!search || task.title.toLocaleLowerCase('fr').includes(search)))
    .sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999') || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}
