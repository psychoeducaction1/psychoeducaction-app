'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  FileUp,
  Plus,
  Send,
} from 'lucide-react'
import { AppNav } from '@/components/AppNav'
import { Badge, EmptyState, PageHeader } from '@/components/ui/index'
import { buttonClass } from '@/components/Ui'
import { supabase } from '@/lib/supabaseClient'

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'canceled'
type Priority = 'low' | 'normal' | 'high'
type Staff = {
  id: string
  profile_id: string | null
  full_name: string
  email: string
}
type Task = {
  id: string
  staff_id: string
  title: string
  description: string | null
  priority: Priority
  status: TaskStatus
  due_at: string | null
  completed_at: string | null
  created_at: string
}
type TaskNote = {
  id: string
  task_id: string
  note: string
  author_name: string | null
  created_at: string
}
type TaskFile = {
  id: string
  task_id: string
  storage_path: string
  file_name: string
  file_size: number | null
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

const priorityLabels: Record<Priority, string> = {
  low: 'Basse',
  normal: 'Normale',
  high: 'Haute',
}

function formatDateTime(value: string | null) {
  if (!value) return 'Aucune échéance'
  return new Intl.DateTimeFormat('fr-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function localDateTimeValue() {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16)
}

export default function MarketingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingTaskId, setUploadingTaskId] = useState<string | null>(null)
  const [isDirection, setIsDirection] = useState(false)
  const [readOnlyPreview, setReadOnlyPreview] = useState(false)
  const [currentName, setCurrentName] = useState('')
  const [staff, setStaff] = useState<Staff | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [notes, setNotes] = useState<TaskNote[]>([])
  const [files, setFiles] = useState<TaskFile[]>([])
  const [view, setView] = useState<'active' | 'history'>('active')
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [noteValues, setNoteValues] = useState<Record<string, string>>({})
  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    priority: 'normal' as Priority,
    dueAt: localDateTimeValue(),
  })

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, full_name, email')
      .eq('id', user.id)
      .maybeSingle()
    if (profileError || !profile || !['direction', 'marketing'].includes(profile.role)) {
      router.push('/')
      return
    }

    const direction = profile.role === 'direction'
    setIsDirection(direction)
    setCurrentName(profile.full_name ?? profile.email ?? user.email ?? 'Utilisateur')

    const { data: staffData, error: staffError } = await supabase
      .from('marketing_staff')
      .select('id, profile_id, full_name, email')
      .eq('email', 'camille.payette@psychoeducaction.com')
      .maybeSingle()
    if (staffError) {
      setError(staffError.message)
      setLoading(false)
      return
    }
    if (!staffData) {
      setStaff(null)
      setLoading(false)
      return
    }

    const loadedStaff = staffData as Staff
    setStaff(loadedStaff)
    const taskResponse = await supabase
      .from('marketing_tasks')
      .select('*')
      .eq('staff_id', loadedStaff.id)
      .order('due_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
    if (taskResponse.error) {
      setError(taskResponse.error.message)
      setLoading(false)
      return
    }

    const loadedTasks = (taskResponse.data ?? []) as Task[]
    const taskIds = loadedTasks.map((task) => task.id)
    const [noteResponse, fileResponse] = taskIds.length
      ? await Promise.all([
          supabase.from('marketing_task_notes').select('*').in('task_id', taskIds).order('created_at', { ascending: false }),
          supabase.from('marketing_task_files').select('*').in('task_id', taskIds).order('created_at', { ascending: false }),
        ])
      : [{ data: [], error: null }, { data: [], error: null }]
    if (noteResponse.error || fileResponse.error) {
      setError(noteResponse.error?.message ?? fileResponse.error?.message ?? 'Chargement impossible.')
      setLoading(false)
      return
    }

    setTasks(loadedTasks)
    setNotes((noteResponse.data ?? []) as TaskNote[])
    setFiles((fileResponse.data ?? []) as TaskFile[])
    setLoading(false)
  }, [router])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadData])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (new URLSearchParams(window.location.search).get('preview') === 'camille') {
        setReadOnlyPreview(true)
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const displayedTasks = useMemo(
    () => tasks.filter((task) =>
      view === 'active'
        ? task.status === 'pending' || task.status === 'in_progress'
        : task.status === 'completed' || task.status === 'canceled'
    ),
    [tasks, view]
  )

  const inviteCamille = async () => {
    setSaving(true)
    setError('')
    setMessage('')
    const { data: { session } } = await supabase.auth.getSession()
    const response = await fetch('/api/direction/invite-marketing', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
    })
    const payload = (await response.json().catch(() => null)) as { error?: string; message?: string } | null
    if (!response.ok) setError(payload?.error ?? "L'invitation n'a pas pu être envoyée.")
    else {
      setMessage(payload?.message ?? 'Compte marketing préparé.')
      await loadData()
    }
    setSaving(false)
  }

  const updatePreview = (enabled: boolean) => {
    setReadOnlyPreview(enabled)
    setShowTaskForm(false)
    window.history.replaceState(
      null,
      '',
      enabled ? '/marketing?preview=camille' : '/marketing'
    )
  }

  const createTask = async () => {
    if (!staff || !taskForm.title.trim()) return
    setSaving(true)
    setError('')
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error: insertError } = await supabase
      .from('marketing_tasks')
      .insert({
        staff_id: staff.id,
        title: taskForm.title.trim(),
        description: taskForm.description.trim() || null,
        priority: taskForm.priority,
        due_at: taskForm.dueAt ? new Date(taskForm.dueAt).toISOString() : null,
        created_by: user?.id ?? null,
      })
      .select('*')
      .single()
    if (insertError) setError(insertError.message)
    else {
      setTasks((current) => [data as Task, ...current])
      setTaskForm({ title: '', description: '', priority: 'normal', dueAt: localDateTimeValue() })
      setShowTaskForm(false)
      const { data: { session } } = await supabase.auth.getSession()
      const notificationResponse = await fetch('/api/marketing/task-notification', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token ?? ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ taskId: data.id }),
      }).catch(() => null)

      if (notificationResponse?.ok) {
        setMessage(
          isDirection
            ? 'Tâche créée. Camille a reçu une notification par courriel.'
            : 'Tâche créée. Camille et la direction ont reçu une notification par courriel.'
        )
      } else {
        const notificationPayload = notificationResponse
          ? await notificationResponse.json().catch(() => null) as { error?: string } | null
          : null
        setMessage(
          `La tâche a été créée, mais le courriel n’a pas pu être envoyé${
            notificationPayload?.error ? ` : ${notificationPayload.error}` : '.'
          }`
        )
      }
    }
    setSaving(false)
  }

  const updateTaskStatus = async (task: Task, status: TaskStatus) => {
    setSaving(true)
    setError('')
    const completedAt = status === 'completed' ? new Date().toISOString() : null
    const response = isDirection
      ? await supabase.from('marketing_tasks').update({ status, completed_at: completedAt }).eq('id', task.id)
      : await supabase.rpc('update_own_marketing_task_status', {
          target_task_id: task.id,
          next_status: status,
        })
    if (response.error) setError(response.error.message)
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
      .from('marketing_task_notes')
      .insert({ task_id: taskId, note, author_id: user?.id, author_name: currentName })
      .select('*')
      .single()
    if (insertError) setError(insertError.message)
    else {
      setNotes((current) => [data as TaskNote, ...current])
      setNoteValues((current) => ({ ...current, [taskId]: '' }))
    }
    setSaving(false)
  }

  const uploadFile = async (taskId: string, file: File | null) => {
    if (!staff || !file) return
    if (file.size > 50 * 1024 * 1024) {
      setError('Le fichier dépasse la limite de 50 Mo.')
      return
    }
    setUploadingTaskId(taskId)
    setError('')
    const { data: { user } } = await supabase.auth.getUser()
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-')
    const storagePath = `${staff.id}/${taskId}/${crypto.randomUUID()}-${safeName}`
    const { error: uploadError } = await supabase.storage
      .from('marketing-task-files')
      .upload(storagePath, file, { contentType: file.type || undefined })
    if (uploadError) {
      setError(uploadError.message)
      setUploadingTaskId(null)
      return
    }
    const { data, error: metadataError } = await supabase
      .from('marketing_task_files')
      .insert({
        task_id: taskId,
        storage_path: storagePath,
        file_name: file.name,
        mime_type: file.type || null,
        file_size: file.size,
        uploaded_by: user?.id,
      })
      .select('*')
      .single()
    if (metadataError) {
      await supabase.storage.from('marketing-task-files').remove([storagePath])
      setError(metadataError.message)
    } else {
      setFiles((current) => [data as TaskFile, ...current])
      setMessage('Fichier ajouté à la tâche.')
    }
    setUploadingTaskId(null)
  }

  const openFile = async (file: TaskFile) => {
    const { data, error: signedUrlError } = await supabase.storage
      .from('marketing-task-files')
      .createSignedUrl(file.storage_path, 60)
    if (signedUrlError) setError(signedUrlError.message)
    else window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <>
      <AppNav
        previewRole={readOnlyPreview ? 'marketing' : undefined}
        previewProfileName={readOnlyPreview ? staff?.full_name : undefined}
        onExitPreview={readOnlyPreview ? () => updatePreview(false) : undefined}
      />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-7xl space-y-7">
          <PageHeader
            eyebrow="Marketing"
            title={isDirection && !readOnlyPreview ? 'Suivi marketing' : 'Mon espace marketing'}
            description="Tâches en cours, livrables et historique du travail réalisé."
            actions={isDirection ? (
              <>
                {!readOnlyPreview && (
                  <Link href="/marketing/calendrier" className={buttonClass('secondary')}>
                    <CalendarDays className="h-4 w-4" />
                    Calendrier marketing
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => updatePreview(!readOnlyPreview)}
                  className={buttonClass(readOnlyPreview ? 'primary' : 'secondary')}
                >
                  <Eye className="h-4 w-4" />
                  {readOnlyPreview ? 'Retour à la vue Direction' : "Voir l’espace de Camille"}
                </button>
              </>
            ) : undefined}
          />

          {readOnlyPreview && (
            <div className="rounded-xl border border-[#d9b591] bg-[#fbf1e7] px-4 py-3 text-sm text-[#6d3f1f]">
              Vue sécurisée en lecture seule. Aucune action ne sera enregistrée au nom de Camille.
            </div>
          )}

          {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
          {message && <div className="rounded-xl border border-[#d8e2c7] bg-[#f6faef] p-4 text-sm text-[#3f4f2d]">{message}</div>}

          {!loading && !staff && isDirection && !readOnlyPreview && (
            <section className="border-y border-[#eadfd2] py-6">
              <h2 className="text-lg font-semibold text-[#332820]">Préparer le compte de Camille</h2>
              <p className="mt-2 text-sm text-[#7a6859]">Exécutez d’abord le script SQL, puis envoyez l’invitation à camille.payette@psychoeducaction.com.</p>
            </section>
          )}

          {staff && isDirection && !readOnlyPreview && !staff.profile_id && (
            <section className="flex flex-col gap-4 border-y border-[#eadfd2] py-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold text-[#332820]">Compte de Camille non relié</h2>
                <p className="mt-1 text-sm text-[#7a6859]">Envoyez son invitation pour activer l’espace marketing.</p>
              </div>
              <button type="button" disabled={saving} onClick={() => void inviteCamille()} className={buttonClass('primary')}>
                <Send className="h-4 w-4" /> Inviter Camille
              </button>
            </section>
          )}

          {staff && (
            <>
              <section className="border-y border-[#eadfd2] py-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setView('active')} className={buttonClass(view === 'active' ? 'primary' : 'secondary')}>Tâches actives</button>
                    <button type="button" onClick={() => setView('history')} className={buttonClass(view === 'history' ? 'primary' : 'secondary')}>Historique</button>
                  </div>
                  <button
                    type="button"
                    disabled={readOnlyPreview}
                    onClick={() => setShowTaskForm((value) => !value)}
                    className={buttonClass('primary')}
                    title={readOnlyPreview ? 'Désactivé dans la vue en lecture seule' : undefined}
                  >
                    <Plus className="h-4 w-4" /> Nouvelle tâche
                  </button>
                </div>
              </section>

              {showTaskForm && (
                <section className="border-b border-[#eadfd2] pb-6">
                  <h2 className="text-lg font-semibold text-[#332820]">
                    {isDirection ? 'Créer une tâche pour Camille' : 'Créer une nouvelle tâche'}
                  </h2>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="text-sm font-medium text-[#5d4a3d]">Titre<input className={`${inputClass} mt-2`} value={taskForm.title} onChange={(event) => setTaskForm((current) => ({ ...current, title: event.target.value }))} /></label>
                    <label className="text-sm font-medium text-[#5d4a3d]">Priorité<select className={`${inputClass} mt-2`} value={taskForm.priority} onChange={(event) => setTaskForm((current) => ({ ...current, priority: event.target.value as Priority }))}><option value="low">Basse</option><option value="normal">Normale</option><option value="high">Haute</option></select></label>
                    <label className="text-sm font-medium text-[#5d4a3d] md:col-span-2">Description<textarea className={`${inputClass} mt-2 min-h-28`} value={taskForm.description} onChange={(event) => setTaskForm((current) => ({ ...current, description: event.target.value }))} /></label>
                    <label className="text-sm font-medium text-[#5d4a3d]">Échéance<input type="datetime-local" className={`${inputClass} mt-2`} value={taskForm.dueAt} onChange={(event) => setTaskForm((current) => ({ ...current, dueAt: event.target.value }))} /></label>
                  </div>
                  <div className="mt-4 flex gap-2"><button type="button" disabled={saving || !taskForm.title.trim()} onClick={() => void createTask()} className={buttonClass('primary')}>Créer</button><button type="button" onClick={() => setShowTaskForm(false)} className={buttonClass('secondary')}>Annuler</button></div>
                </section>
              )}

              {loading ? <p className="text-sm text-[#7a6859]">Chargement...</p> : displayedTasks.length === 0 ? <EmptyState title="Aucune tâche dans cette section." /> : (
                <section className="grid gap-4 lg:grid-cols-2">
                  {displayedTasks.map((task) => {
                    const taskNotes = notes.filter((note) => note.task_id === task.id)
                    const taskFiles = files.filter((file) => file.task_id === task.id)
                    const overdue = Boolean(task.due_at && new Date(task.due_at) < new Date() && !['completed', 'canceled'].includes(task.status))
                    return (
                      <article key={task.id} className="rounded-lg border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div><h2 className="font-semibold text-[#332820]">{task.title}</h2><p className="mt-1 text-xs text-[#8a6f5d]">Priorité {priorityLabels[task.priority].toLowerCase()}</p></div>
                          <Badge tone={task.status === 'completed' ? 'success' : overdue ? 'danger' : task.status === 'in_progress' ? 'warning' : 'neutral'}>{statusLabels[task.status]}</Badge>
                        </div>
                        {task.description && <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-[#4f4035]">{task.description}</p>}
                        <p className={`mt-4 flex items-center gap-2 text-sm ${overdue ? 'font-semibold text-red-700' : 'text-[#7a6859]'}`}><Clock3 className="h-4 w-4" />{overdue ? 'En retard · ' : ''}{formatDateTime(task.due_at)}</p>
                        {(task.status === 'pending' || task.status === 'in_progress') && (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {task.status === 'pending' && <button type="button" disabled={saving || readOnlyPreview} onClick={() => void updateTaskStatus(task, 'in_progress')} className={buttonClass('secondary')}>Commencer</button>}
                            <button type="button" disabled={saving || readOnlyPreview} onClick={() => void updateTaskStatus(task, 'completed')} className={buttonClass('primary')}><CheckCircle2 className="h-4 w-4" /> Terminer</button>
                            {isDirection && !readOnlyPreview && <button type="button" disabled={saving} onClick={() => void updateTaskStatus(task, 'canceled')} className={buttonClass('ghost')}>Annuler la tâche</button>}
                          </div>
                        )}
                        <div className="mt-5 border-t border-[#eadfd2] pt-4">
                          <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-[#5d4a3d]">Fichiers ({taskFiles.length})</h3><label className={`${buttonClass('secondary')} ${readOnlyPreview ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}><FileUp className="h-4 w-4" />{uploadingTaskId === task.id ? 'Téléversement...' : 'Ajouter'}<input type="file" className="sr-only" disabled={readOnlyPreview || uploadingTaskId === task.id} onChange={(event) => { void uploadFile(task.id, event.target.files?.[0] ?? null); event.currentTarget.value = '' }} /></label></div>
                          <div className="mt-3 space-y-2">{taskFiles.length === 0 ? <p className="text-sm text-[#8a6f5d]">Aucun fichier déposé.</p> : taskFiles.map((file) => <button key={file.id} type="button" onClick={() => void openFile(file)} className="flex w-full items-center gap-2 rounded-lg border border-[#eadfd2] px-3 py-2 text-left text-sm text-[#6d3f1f] hover:bg-[#fbf6ef]"><Download className="h-4 w-4 shrink-0" /><span className="truncate">{file.file_name}</span></button>)}</div>
                        </div>
                        <details className="mt-5 border-t border-[#eadfd2] pt-4">
                          <summary className="cursor-pointer text-sm font-semibold text-[#8a5633]">Notes ({taskNotes.length})</summary>
                          <div className="mt-3 space-y-3">{taskNotes.map((note) => <div key={note.id} className="border-l-2 border-[#d9b591] pl-3 text-sm"><p className="whitespace-pre-wrap text-[#332820]">{note.note}</p><p className="mt-1 text-xs text-[#8a6f5d]">{note.author_name ?? 'Utilisateur'} · {formatDateTime(note.created_at)}</p></div>)}<div className="flex flex-col gap-2 sm:flex-row"><input className={inputClass} disabled={readOnlyPreview} placeholder="Ajouter une note" value={noteValues[task.id] ?? ''} onChange={(event) => setNoteValues((current) => ({ ...current, [task.id]: event.target.value }))} /><button type="button" disabled={readOnlyPreview || saving || !noteValues[task.id]?.trim()} onClick={() => void addNote(task.id)} className={buttonClass('secondary')}>Ajouter</button></div></div>
                        </details>
                      </article>
                    )
                  })}
                </section>
              )}

            </>
          )}
        </div>
      </main>
    </>
  )
}
