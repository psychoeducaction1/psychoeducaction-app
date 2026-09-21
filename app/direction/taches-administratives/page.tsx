'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Clock3, Plus, Send } from 'lucide-react'
import { AppNav } from '@/components/AppNav'
import { Badge, buttonClass, EmptyState, PageHeader } from '@/components/ui/index'
import {
  getAdministrativeTaskAssigneeLabel,
  getAdministrativeTaskAssigneesForEmail,
  isAdministrativeTaskAuthorized,
  type AdministrativeTaskAssignee,
} from '@/lib/administrativeTaskAccess'
import { supabase } from '@/lib/supabaseClient'

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'canceled'
type Task = {
  id: string
  title: string
  description: string | null
  assigned_to: AdministrativeTaskAssignee
  status: TaskStatus
  due_at: string | null
  source_type: string | null
  source_id: string | null
  created_by: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}
type TaskNote = {
  id: string
  task_id: string
  note: string
  author_name: string | null
  created_at: string
}

const inputClass =
  'w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] shadow-sm outline-none transition focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]'

const statusLabels: Record<TaskStatus, string> = {
  pending: 'À faire',
  in_progress: 'En cours',
  completed: 'Terminée',
  canceled: 'Annulée',
}

function localDateTimeValue(hoursFromNow = 24) {
  const date = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16)
}

function formatDateTime(value: string | null) {
  if (!value) return 'Aucune échéance'
  return new Intl.DateTimeFormat('fr-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export default function AdministrativeTasksPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [tasks, setTasks] = useState<Task[]>([])
  const [notes, setNotes] = useState<TaskNote[]>([])
  const [view, setView] = useState<'active' | 'history'>('active')
  const [canCreate, setCanCreate] = useState(false)
  const [currentName, setCurrentName] = useState('')
  const [visibleAssignees, setVisibleAssignees] = useState<AdministrativeTaskAssignee[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    title: '',
    description: '',
    assignedTo: 'both' as AdministrativeTaskAssignee,
    dueAt: localDateTimeValue(),
  })
  const [noteValues, setNoteValues] = useState<Record<string, string>>({})

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, full_name, email')
      .eq('id', user.id)
      .limit(1)
      .maybeSingle()
    if (!isAdministrativeTaskAuthorized(user, profile)) {
      router.push('/')
      return
    }

    const { data: taskData, error: taskError } = await supabase
      .from('administrative_tasks')
      .select('*')
      .order('due_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
    if (taskError) {
      setError(taskError.message)
      setLoading(false)
      return
    }
    const loadedTasks = (taskData ?? []) as Task[]
    const taskIds = loadedTasks.map((task) => task.id)
    const noteResponse = taskIds.length
      ? await supabase
          .from('administrative_task_notes')
          .select('*')
          .in('task_id', taskIds)
          .order('created_at', { ascending: false })
      : { data: [], error: null }
    if (noteResponse.error) {
      setError(noteResponse.error.message)
      setLoading(false)
      return
    }

    setTasks(loadedTasks)
    setNotes((noteResponse.data ?? []) as TaskNote[])
    setCanCreate(profile?.role === 'direction')
    setCurrentName(profile?.full_name ?? profile?.email ?? user.email ?? 'Utilisateur')
    setVisibleAssignees(
      profile?.role === 'direction'
        ? ['hajar', 'fatima', 'both']
        : getAdministrativeTaskAssigneesForEmail(user.email)
    )
    setLoading(false)
  }, [router])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadData() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadData])

  const displayedTasks = useMemo(
    () => tasks.filter((task) =>
      view === 'active'
        ? task.status === 'pending' || task.status === 'in_progress'
        : task.status === 'completed' || task.status === 'canceled'
    ),
    [tasks, view]
  )

  const notifyTask = async (taskId: string) => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return
    const response = await fetch('/api/direction/administrative-task-notification', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ taskId }),
    })
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      throw new Error(payload?.error ?? 'La notification par courriel n’a pas pu être envoyée.')
    }
  }

  const createTask = async () => {
    if (!form.title.trim()) {
      setError('Indiquez un titre pour la tâche.')
      return
    }
    setSaving(true)
    setError('')
    setMessage('')
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error: insertError } = await supabase
      .from('administrative_tasks')
      .insert({
        title: form.title.trim(),
        description: form.description.trim() || null,
        assigned_to: form.assignedTo,
        due_at: form.dueAt ? new Date(form.dueAt).toISOString() : null,
        created_by: user?.id ?? null,
      })
      .select('*')
      .limit(1)
      .maybeSingle()
    if (insertError || !data) {
      setError(insertError?.message ?? 'Création impossible.')
      setSaving(false)
      return
    }
    setTasks((current) => [data as Task, ...current])
    setForm({ title: '', description: '', assignedTo: 'both', dueAt: localDateTimeValue() })
    setShowForm(false)
    try {
      await notifyTask(data.id)
      setMessage('Tâche créée. La notification a été envoyée à contact@psychoeducaction.com.')
    } catch (notificationError) {
      setMessage('Tâche créée, mais le courriel de notification n’a pas pu être envoyé.')
      console.error(notificationError)
    }
    setSaving(false)
  }

  const updateStatus = async (task: Task, status: TaskStatus) => {
    setSaving(true)
    setError('')
    const completedAt = status === 'completed' ? new Date().toISOString() : null
    const { error: updateError } = await supabase
      .from('administrative_tasks')
      .update({ status, completed_at: completedAt })
      .eq('id', task.id)
    if (updateError) setError(updateError.message)
    else setTasks((current) => current.map((item) =>
      item.id === task.id ? { ...item, status, completed_at: completedAt } : item
    ))
    setSaving(false)
  }

  const addNote = async (taskId: string) => {
    const note = noteValues[taskId]?.trim()
    if (!note) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error: insertError } = await supabase
      .from('administrative_task_notes')
      .insert({ task_id: taskId, note, author_id: user?.id ?? null, author_name: currentName })
      .select('*')
      .limit(1)
      .maybeSingle()
    if (insertError) setError(insertError.message)
    else if (data) {
      setNotes((current) => [data as TaskNote, ...current])
      setNoteValues((current) => ({ ...current, [taskId]: '' }))
    }
    setSaving(false)
  }

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-7xl space-y-6">
          <PageHeader
            eyebrow="Administration"
            title="Tâches administratives"
            description="Suivi des tâches confiées à Hajar et Fatima Zahra."
          />
          {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
          {message && <div className="rounded-xl border border-[#d8e2c7] bg-[#f6faef] p-4 text-sm text-[#3f4f2d]">{message}</div>}

          <section className="flex flex-col gap-4 border-y border-[#eadfd2] py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-2">
              <button type="button" onClick={() => setView('active')} className={buttonClass(view === 'active' ? 'primary' : 'secondary')}>À faire</button>
              <button type="button" onClick={() => setView('history')} className={buttonClass(view === 'history' ? 'primary' : 'secondary')}>Historique</button>
            </div>
            {canCreate && <button type="button" onClick={() => setShowForm((value) => !value)} className={buttonClass('primary')}><Plus className="h-4 w-4" />Nouvelle tâche</button>}
          </section>

          {showForm && canCreate && (
            <section className="rounded-xl border border-[#dfd0bf] bg-[#fffdf9] p-5">
              <h2 className="text-lg font-semibold text-[#332820]">Créer une tâche</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-sm font-medium text-[#5d4a3d]">Titre<input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} className={`${inputClass} mt-2`} /></label>
                <label className="text-sm font-medium text-[#5d4a3d]">Assignée à<select value={form.assignedTo} onChange={(event) => setForm((current) => ({ ...current, assignedTo: event.target.value as AdministrativeTaskAssignee }))} className={`${inputClass} mt-2`}><option value="hajar">Hajar</option><option value="fatima">Fatima Zahra</option><option value="both">Les deux</option></select></label>
                <label className="text-sm font-medium text-[#5d4a3d] md:col-span-2">Description<textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className={`${inputClass} mt-2 min-h-24`} /></label>
                <label className="text-sm font-medium text-[#5d4a3d]">Échéance<input type="datetime-local" value={form.dueAt} onChange={(event) => setForm((current) => ({ ...current, dueAt: event.target.value }))} className={`${inputClass} mt-2`} /></label>
              </div>
              <div className="mt-4 flex gap-2"><button type="button" disabled={saving} onClick={() => void createTask()} className={buttonClass('primary')}><Send className="h-4 w-4" />Créer et notifier</button><button type="button" onClick={() => setShowForm(false)} className={buttonClass('secondary')}>Annuler</button></div>
            </section>
          )}

          {loading ? <p className="text-sm text-[#7a6859]">Chargement...</p> : displayedTasks.length === 0 ? <EmptyState title="Aucune tâche dans cette section." /> : (
            <section className="grid gap-4 lg:grid-cols-2">
              {displayedTasks.map((task) => {
                const taskNotes = notes.filter((note) => note.task_id === task.id)
                const overdue = Boolean(task.due_at && new Date(task.due_at) < new Date() && task.status !== 'completed')
                return (
                  <article key={task.id} className="rounded-xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div><h2 className="font-semibold text-[#332820]">{task.title}</h2><p className="mt-1 text-sm text-[#7a6859]">{getAdministrativeTaskAssigneeLabel(task.assigned_to)}</p></div>
                      <Badge tone={task.status === 'completed' ? 'success' : overdue ? 'danger' : task.status === 'in_progress' ? 'warning' : 'neutral'}>{statusLabels[task.status]}</Badge>
                    </div>
                    {task.description && <p className="mt-4 whitespace-pre-wrap text-sm text-[#4f4035]">{task.description}</p>}
                    <p className={`mt-4 flex items-center gap-2 text-sm ${overdue ? 'font-semibold text-red-700' : 'text-[#7a6859]'}`}><Clock3 className="h-4 w-4" />{overdue ? 'En retard · ' : ''}{formatDateTime(task.due_at)}</p>
                    {(task.status === 'pending' || task.status === 'in_progress') && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {task.status === 'pending' && <button type="button" disabled={saving} onClick={() => void updateStatus(task, 'in_progress')} className={buttonClass('secondary')}>Commencer</button>}
                        <button type="button" disabled={saving} onClick={() => void updateStatus(task, 'completed')} className={buttonClass('primary')}><CheckCircle2 className="h-4 w-4" />Marquer terminée</button>
                        {canCreate && <button type="button" disabled={saving} onClick={() => void updateStatus(task, 'canceled')} className={buttonClass('secondary')}>Annuler la tâche</button>}
                      </div>
                    )}
                    <details className="mt-5 border-t border-[#eadfd2] pt-4">
                      <summary className="cursor-pointer text-sm font-semibold text-[#8a5633]">Notes internes ({taskNotes.length})</summary>
                      <div className="mt-3 space-y-2">
                        {taskNotes.map((note) => <div key={note.id} className="border-l-2 border-[#d9b591] pl-3 text-sm"><p className="whitespace-pre-wrap text-[#332820]">{note.note}</p><p className="mt-1 text-xs text-[#8a6f5d]">{note.author_name ?? 'Utilisateur'} · {formatDateTime(note.created_at)}</p></div>)}
                        <div className="flex gap-2 pt-2"><input value={noteValues[task.id] ?? ''} onChange={(event) => setNoteValues((current) => ({ ...current, [task.id]: event.target.value }))} className={inputClass} placeholder="Ajouter une note interne" /><button type="button" disabled={saving || !noteValues[task.id]?.trim()} onClick={() => void addNote(task.id)} className={buttonClass('secondary')}>Ajouter</button></div>
                      </div>
                    </details>
                  </article>
                )
              })}
            </section>
          )}
          {!canCreate && visibleAssignees.length > 0 && <p className="text-xs text-[#8a6f5d]">Vous voyez uniquement les tâches qui vous sont attribuées.</p>}
        </div>
      </main>
    </>
  )
}
