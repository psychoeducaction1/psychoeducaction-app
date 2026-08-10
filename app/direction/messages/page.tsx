'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import { Badge, buttonClass, EmptyState, PageHeader } from '@/components/ui/index'
import { supabase } from '@/lib/supabaseClient'
import { internalMessageSelect, type InternalMessage } from '@/lib/internalMessages'

type Professional = {
  id: string
  full_name: string | null
  email: string | null
}

type ProfessionalThreadInfo = {
  professional: Professional
  lastMessage: InternalMessage | null
  unreadCount: number
}

function formatMessageTime(value: string): string {
  return new Intl.DateTimeFormat('fr-CA', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

export default function DirectionMessagesPage() {
  const router = useRouter()
  const [currentUserId, setCurrentUserId] = useState('')
  const [currentUserName, setCurrentUserName] = useState<string | null>(null)
  const [professionals, setProfessionals] = useState<Professional[]>([])
  const [messages, setMessages] = useState<InternalMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedProfessionalId, setSelectedProfessionalId] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      setError('')

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        router.push('/login')
        return
      }

      const { data: currentProfile, error: profileError } = await supabase
        .from('profiles')
        .select('role, full_name, email')
        .eq('id', user.id)
        .limit(1)
        .maybeSingle()

      if (profileError) {
        setError(profileError.message)
        setLoading(false)
        return
      }

      if (currentProfile?.role !== 'direction') {
        router.push('/')
        return
      }

      setCurrentUserId(user.id)
      setCurrentUserName(
        currentProfile.full_name?.trim() || currentProfile.email?.trim() || null
      )

      const [professionalsResponse, messagesResponse] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, email')
          .eq('role', 'professionnel')
          .eq('is_active', true)
          .order('full_name', { ascending: true }),
        supabase
          .from('internal_messages')
          .select(internalMessageSelect)
          .order('created_at', { ascending: true }),
      ])

      if (professionalsResponse.error) {
        setError(professionalsResponse.error.message)
        setLoading(false)
        return
      }

      if (messagesResponse.error) {
        setError(messagesResponse.error.message)
        setLoading(false)
        return
      }

      setProfessionals((professionalsResponse.data ?? []) as Professional[])
      setMessages((messagesResponse.data ?? []) as InternalMessage[])
      setLoading(false)
    }

    loadData()
  }, [router])

  const threadsByProfessionalId = useMemo(() => {
    const map = new Map<string, ProfessionalThreadInfo>()

    professionals.forEach((professional) => {
      map.set(professional.id, {
        professional,
        lastMessage: null,
        unreadCount: 0,
      })
    })

    messages.forEach((message) => {
      const entry = map.get(message.professional_id)
      if (!entry) return

      entry.lastMessage = message

      if (message.sender_role === 'professionnel' && !message.read_at) {
        entry.unreadCount += 1
      }
    })

    return map
  }, [professionals, messages])

  const sortedThreads = useMemo(
    () =>
      Array.from(threadsByProfessionalId.values()).sort((a, b) => {
        const aTime = a.lastMessage ? new Date(a.lastMessage.created_at).getTime() : 0
        const bTime = b.lastMessage ? new Date(b.lastMessage.created_at).getTime() : 0
        return bTime - aTime
      }),
    [threadsByProfessionalId]
  )

  const selectedThreadMessages = messages.filter(
    (message) => message.professional_id === selectedProfessionalId
  )
  const selectedProfessional =
    threadsByProfessionalId.get(selectedProfessionalId)?.professional

  const handleSelectProfessional = async (professionalId: string) => {
    setSelectedProfessionalId(professionalId)
    setSendError('')

    const unreadIds = messages
      .filter(
        (message) =>
          message.professional_id === professionalId &&
          message.sender_role === 'professionnel' &&
          !message.read_at
      )
      .map((message) => message.id)

    if (unreadIds.length === 0) return

    const now = new Date().toISOString()

    setMessages((current) =>
      current.map((message) =>
        unreadIds.includes(message.id) ? { ...message, read_at: now } : message
      )
    )

    await supabase.from('internal_messages').update({ read_at: now }).in('id', unreadIds)
  }

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const body = draft.trim()
    if (!body || !currentUserId || !selectedProfessionalId) return

    setSending(true)
    setSendError('')

    const { data, error: insertError } = await supabase
      .from('internal_messages')
      .insert({
        professional_id: selectedProfessionalId,
        sender_id: currentUserId,
        sender_role: 'direction',
        sender_name: currentUserName,
        body,
      })
      .select(internalMessageSelect)
      .limit(1)
      .maybeSingle()

    setSending(false)

    if (insertError) {
      setSendError(insertError.message)
      return
    }

    if (data) {
      setMessages((current) => [...current, data as InternalMessage])
      setDraft('')
    }
  }

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <PageHeader
            eyebrow="Direction"
            title="Messages"
            description="Échangez directement avec chaque professionnel."
          />

          {loading && (
            <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 text-sm text-[#7a6859]">
              Chargement...
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              {error}
            </div>
          )}

          {!loading && !error && (
            <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
              <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-3">
                {sortedThreads.length === 0 ? (
                  <EmptyState title="Aucun professionnel actif." />
                ) : (
                  <div className="max-h-[70vh] space-y-1 overflow-y-auto">
                    {sortedThreads.map(({ professional, lastMessage, unreadCount }) => (
                      <button
                        key={professional.id}
                        type="button"
                        onClick={() => handleSelectProfessional(professional.id)}
                        className={`w-full rounded-xl px-3 py-2.5 text-left transition-colors ${
                          selectedProfessionalId === professional.id
                            ? 'bg-[#efe1d2]'
                            : 'hover:bg-[#f5ebe0]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-[#332820]">
                            {professional.full_name || professional.email || 'Professionnel'}
                          </p>
                          {unreadCount > 0 && <Badge tone="warning">{unreadCount}</Badge>}
                        </div>
                        {lastMessage && (
                          <p className="mt-1 truncate text-xs text-[#8a6f5d]">
                            {lastMessage.body}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-4">
                {!selectedProfessionalId ? (
                  <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-[#dfd0bf] bg-[#fbf6ef] p-10">
                    <p className="text-sm text-[#8a6f5d]">
                      Sélectionnez un professionnel pour voir la conversation.
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-[#332820]">
                      {selectedProfessional?.full_name || selectedProfessional?.email}
                    </p>
                    <div className="max-h-[55vh] min-h-[20vh] space-y-3 overflow-y-auto rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-4">
                      {selectedThreadMessages.length === 0 ? (
                        <EmptyState
                          title="Aucun message pour l'instant"
                          description="Écrivez au professionnel ci-dessous pour démarrer la conversation."
                        />
                      ) : (
                        selectedThreadMessages.map((message) => {
                          const isSelf = message.sender_role === 'direction'
                          return (
                            <div
                              key={message.id}
                              className={`flex ${isSelf ? 'justify-end' : 'justify-start'}`}
                            >
                              <div
                                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                                  isSelf
                                    ? 'bg-[#8a5633] text-white'
                                    : 'border border-[#eadfd2] bg-white text-[#332820]'
                                }`}
                              >
                                <p
                                  className={`text-xs font-semibold ${
                                    isSelf ? 'text-[#f1ead9]' : 'text-[#9b6a3d]'
                                  }`}
                                >
                                  {message.sender_name || (isSelf ? 'Vous' : 'Professionnel')}
                                </p>
                                <p className="mt-1 whitespace-pre-wrap break-words">
                                  {message.body}
                                </p>
                                <p
                                  className={`mt-1 text-[11px] ${
                                    isSelf ? 'text-[#ead2bd]' : 'text-[#a89686]'
                                  }`}
                                >
                                  {formatMessageTime(message.created_at)}
                                </p>
                              </div>
                            </div>
                          )
                        })
                      )}
                    </div>

                    <form onSubmit={handleSend} className="flex flex-col gap-2 sm:flex-row">
                      <textarea
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        placeholder="Écrire un message..."
                        rows={2}
                        className="w-full flex-1 rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                      />
                      <button
                        type="submit"
                        disabled={sending || !draft.trim()}
                        className={buttonClass('primary')}
                      >
                        {sending ? 'Envoi...' : 'Envoyer'}
                      </button>
                    </form>
                    {sendError && <p className="text-sm text-red-700">{sendError}</p>}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
