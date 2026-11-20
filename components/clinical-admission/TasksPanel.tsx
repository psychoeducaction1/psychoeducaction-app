'use client'

import { useState } from 'react'
import { Badge, buttonClass } from '@/components/Ui'
import { getAdministrativeTaskAssigneeLabel } from '@/lib/administrativeTaskAccess'
import { visibleAdministrativeTasks } from '@/lib/clinical-admission/tasks'
import { ActionForm, Fold, Pager, Search, dateTime, pageRows, panelClass, terminalProcess, text, utc, type AdmissionUi } from './shared'

const statusLabels = { pending: 'À faire', in_progress: 'En cours', completed: 'Terminée', cancelled: 'Annulée' } as const

export function TasksPanel({ ui }: { ui: AdmissionUi }) {
  const [creating, setCreating] = useState(false)
  const history = ui.query.get('tab') === 'history'
  const tasks = visibleAdministrativeTasks(ui.data.tasks, ui.query)
  return <div className="grid gap-5">
    <div className="flex flex-wrap gap-2">
      <button className={buttonClass(history ? 'secondary' : 'primary')} onClick={() => void ui.select({ tab: null, page: null })}>À faire</button>
      <button className={buttonClass(history ? 'primary' : 'secondary')} onClick={() => void ui.select({ tab: 'history', page: null })}>Historique</button>
      <button className={buttonClass('primary')} onClick={() => setCreating(value => !value)}>Nouvelle tâche</button>
    </div>
    {creating && <section className={panelClass} aria-label="Créer une tâche administrative">
      <h2 className="mb-3 text-lg font-semibold">Créer une tâche</h2>
      <ActionForm fields={[
        { name: 'title', label: 'Titre', required: true, maxLength: 300 },
        { name: 'assignedTo', label: 'Assignée à', type: 'select', required: true, initial: 'both', options: [{ value: 'hajar', label: 'Hajar' }, { value: 'fatima', label: 'Fatima Zahra' }, { value: 'both', label: 'Les deux' }] },
        { name: 'description', label: 'Description', type: 'textarea', maxLength: 3000 },
        { name: 'dueAt', label: 'Échéance (facultative)', type: 'datetime-local' },
      ]} submitLabel="Créer et notifier (simulation)" onSubmit={async values => {
        await ui.run('tasks.create', null, { title: text(values.title), assignedTo: text(values.assignedTo), description: text(values.description), ...(text(values.dueAt) ? { dueAt: utc(values.dueAt) } : {}) })
        return () => setCreating(false)
      }} />
    </section>}
    <section className={panelClass}><Search ui={ui} /></section>
    <section aria-label="Tâches administratives">
      <div className="grid gap-4 lg:grid-cols-2">{pageRows(tasks, ui.query).map(task => {
        const admission = ui.data.admissions.find(item => item.id === task.admissionId)
        const process = ui.data.processes.find(item => item.id === task.processId)
        const overdue = Boolean(task.dueAt && Date.parse(task.dueAt) < Date.now() && task.status !== 'completed')
        return <article key={task.id} className="rounded-xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">{task.title}</h2><p className="mt-1 text-sm text-[#7a6859]">{getAdministrativeTaskAssigneeLabel(task.assignedTo)}</p></div><Badge tone={task.status === 'completed' ? 'success' : overdue ? 'danger' : task.status === 'in_progress' ? 'warning' : 'neutral'}>{statusLabels[task.status]}</Badge></div>
          {task.description && <p className="mt-3 whitespace-pre-wrap text-sm">{task.description}</p>}
          <p className={`mt-4 text-sm ${overdue ? 'font-semibold text-red-700' : 'text-[#7a6859]'}`}>{admission ? `${admission.firstName} ${admission.lastName}` : 'Tâche générale'} · {overdue ? 'En retard · ' : ''}Échéance : {task.dueAt ? dateTime(task.dueAt) : 'Aucune'}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {process && <button className={buttonClass('ghost')} onClick={() => void ui.navigate('processes', { process: process.id, tab: terminalProcess(process.status) ? 'history' : 'active' })}>Ouvrir la démarche</button>}
            {admission && <button className={buttonClass('ghost')} onClick={() => void ui.navigate('waiting', { admission: admission.id, tab: admission.stage === 'waiting' ? 'waiting' : 'history' })}>Ouvrir la demande</button>}
            {task.status === 'pending' && <button className={buttonClass('secondary')} disabled={ui.busy} onClick={() => void ui.run('tasks.update', task.id, { expectedVersion: task.version, status: 'in_progress' }).catch(() => undefined)}>Commencer</button>}
            {(task.status === 'pending' || task.status === 'in_progress') && <>
              <button className={buttonClass('primary')} disabled={ui.busy} onClick={() => void ui.run('tasks.update', task.id, { expectedVersion: task.version, status: 'completed' }).catch(() => undefined)}>Marquer terminée</button>
              <button className={buttonClass('secondary')} disabled={ui.busy} onClick={() => { if (window.confirm('Annuler cette tâche ?')) void ui.run('tasks.update', task.id, { expectedVersion: task.version, status: 'cancelled' }).catch(() => undefined) }}>Annuler la tâche</button>
            </>}
          </div>
          <Fold title={`Notes internes (${task.notes.length})`}>
            <div className="grid gap-2">{task.notes.map(note => <div key={note.id} className="border-l-2 border-[#d9b591] pl-3 text-sm"><p className="whitespace-pre-wrap">{note.note}</p><p className="text-xs">{note.authorName} · {dateTime(note.createdAt)}</p></div>)}</div>
            <ActionForm key={task.version} fields={[{ name: 'note', label: 'Ajouter une note interne', required: true, maxLength: 1000 }]} submitLabel="Ajouter" onSubmit={async values => { await ui.run('tasks.note', task.id, { expectedVersion: task.version, note: text(values.note) }) }} />
          </Fold>
        </article>
      })}{!tasks.length && <p className="text-sm">Aucune tâche dans cette section.</p>}</div>
      <Pager total={tasks.length} query={ui.query} select={ui.select} />
    </section>
  </div>
}
