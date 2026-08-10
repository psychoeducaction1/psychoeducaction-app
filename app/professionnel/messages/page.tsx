'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import { buttonClass, EmptyState, PageHeader } from '@/components/ui/index'
import { supabase } from '@/lib/supabaseClient'
import { internalMessageSelect, type InternalMessage } from '@/lib/internalMessages'

function formatMessageTime(value: string): string {
  return new Intl.DateTimeFormat('fr-CA', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

export default function ProfessionnelMessagesPage() {
  const router = useRouter()
  const [currentUserId, setCurrentUserId] = useState('')
  const [currentUserName, setCurrentUserName] = useState<string | null>(null)
  const [messages, setMessages] = useState<InternalMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const loadMessages = async () => {
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

      const { data: profile, error: profileError } = await supabase
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

      if (profile?.role !== 'professionnel') {
        router.push('/')
        return
      }

      setCurrentUserId(user.id)
      setCurrentUserName(profile.full_name?.trim() || profile.email?.trim() || null)

      const { data: messagesData, error: messagesError } = await supabase
        .from('internal_messages')
        .select(internalMessageSelect)
        .eq('professional_id', user.id)
        .order('created_at', { ascending: true })

      if (messagesError) {
        setError(messagesError.message)
        setLoading(false)
        return
      }

      const loadedMessages = (messagesData ?? []) as InternalMessage[]
      setMessages(loadedMessages)
      setLoading(false)

      const unreadFromDirectionIds = loadedMessages
        .filter((message) => message.sender_role === 'direction' && !message.read_at)
        .map((message) => message.id)

      if (unreadFromDirectionIds.length > 0) {
        await supabase
          .from('internal_messages')
          .update({ read_at: new Date().toISOString() })
          .in('id', unreadFromDirectionIds)
      }
    }

    loadMessages()
  }, [router])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const body = draft.trim()
    if (!body || !currentUserId) return

    setSending(true)
    setSendError('')

    const { data, error: insertError } = await supabase
      .from('internal_messages')
      .insert({
        professional_id: currentUserId,
        sender_id: currentUserId,
        sender_role: 'professionnel',
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
        <div className="mx-auto max-w-3xl">
          <PageHeader
            eyebrow="Espace professionnel"
            title="Messages"
            description="Échangez directement avec la direction."
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
            <div className="flex flex-col gap-4">
              <div className="max-h-[60vh] min-h-[20vh] space-y-3 overflow-y-auto rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-4">
                {messages.length === 0 ? (
                  <EmptyState
                    title="Aucun message pour l'instant"
                    description="Écrivez à la direction ci-dessous pour démarrer la conversation."
                  />
                ) : (
                  messages.map((message) => {
                    const isSelf = message.sender_role === 'professionnel'
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
                            {message.sender_name || (isSelf ? 'Vous' : 'Direction')}
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
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={handleSend} className="flex flex-col gap-2 sm:flex-row">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Écrire un message à la direction..."
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
            </div>
          )}
        </div>
      </main>
    </>
  )
}
