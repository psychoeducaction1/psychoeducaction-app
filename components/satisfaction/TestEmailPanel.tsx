'use client'
import { useState } from 'react'
import { buildSatisfactionEmail, getFirstName } from '@/lib/satisfaction'
import { AlertBanner, buttonClass, SectionCard } from '@/components/ui/index'

const input = 'w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm'
export function TestEmailPanel({ authedFetch }: { authedFetch: (path: string, options?: RequestInit) => Promise<Response> }) {
  const [email, setEmail] = useState(''), [name, setName] = useState('')
  const [preview, setPreview] = useState(false), [sending, setSending] = useState(false)
  const [message, setMessage] = useState(''), [error, setError] = useState('')
  const content = buildSatisfactionEmail({ destinatairePrenom: getFirstName(name || 'Exemple'),
    lienReponse: '', lienDesabonnement: '', test: true,
    testAppUrl: typeof window === 'undefined' ? undefined : window.location.origin })
  async function send() {
    if (sending || !window.confirm(`Envoyer uniquement ce courriel TEST à ${email} ?\n\nAucun client ne sera sollicité. Les liens ouvrent une démonstration et aucun résultat réel ne sera enregistré.`)) return
    setSending(true); setMessage(''); setError('')
    try {
      const response = await authedFetch('/api/satisfaction/test', { method: 'POST', body: JSON.stringify({ email, name, confirm: true }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Envoi test impossible.')
      setMessage(`Courriel test envoyé uniquement à ${email}.`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Envoi test impossible.') }
    finally { setSending(false) }
  }
  return <div className="mt-6"><SectionCard title="Courriel test et aperçu" description="Validez le courriel et ses liens sur votre propre adresse. Les liens ouvrent une démonstration : aucun résultat réel n’est enregistré.">
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Adresse de test<input type="email" className={input} value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label className="text-sm">Nom de démonstration<input className={input} value={name} onChange={e => setName(e.target.value)} /></label>
    </div>
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={buttonClass('secondary')} onClick={() => setPreview(!preview)}>{preview ? 'Fermer l’aperçu' : 'Voir le courriel'}</button>
      <button type="button" className={buttonClass('primary')} onClick={() => void send()} disabled={sending || !email.trim() || !name.trim()}>{sending ? 'Envoi test…' : 'Envoyer uniquement le test'}</button></div>
    {preview && <div className="mt-4"><p className="mb-2 text-sm">Objet : {content.subject}</p><iframe title="Aperçu du courriel test" sandbox="" srcDoc={content.html} className="h-[650px] w-full rounded-xl border" /></div>}
    {message && <div className="mt-3"><AlertBanner tone="success" title="Test envoyé" description={message} /></div>}
    {error && <div className="mt-3"><AlertBanner tone="danger" title="Erreur" description={error} /></div>}
  </SectionCard></div>
}
