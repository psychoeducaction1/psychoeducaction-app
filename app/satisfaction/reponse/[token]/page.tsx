'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Star } from 'lucide-react'

// TODO : remplacer par le vrai lien « Laisser un avis Google » de la clinique.
// Ce lien est affiché de façon NEUTRE à tous les répondants, quelle que soit
// leur note, sans sélectionner uniquement les clients satisfaits.
const GOOGLE_REVIEW_URL =
  'https://www.google.com/maps/search/?api=1&query=PsychoEducAction'

const NOTE_LABELS: Record<number, string> = {
  1: 'Très insatisfait',
  2: 'Insatisfait',
  3: 'Neutre',
  4: 'Satisfait',
  5: 'Très satisfait',
}

export default function SatisfactionReponsePage() {
  const params = useParams()
  const token = Array.isArray(params.token) ? params.token[0] : params.token

  const [loading, setLoading] = useState(true)
  const [invalid, setInvalid] = useState(false)
  const [prenom, setPrenom] = useState('')
  const [alreadyResponded, setAlreadyResponded] = useState(false)
  const [note, setNote] = useState(0)
  const [commentaire, setCommentaire] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!token) {
      setLoading(false)
      setInvalid(true)
      return
    }

    const load = async () => {
      try {
        const response = await fetch(
          `/api/satisfaction/respond?token=${encodeURIComponent(token)}`
        )
        const body = (await response.json()) as {
          prenom?: string
          alreadyResponded?: boolean
          error?: string
        }

        if (!response.ok) {
          setInvalid(true)
          return
        }

        setPrenom(body.prenom ?? '')
        setAlreadyResponded(Boolean(body.alreadyResponded))
      } catch {
        setInvalid(true)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [token])

  const handleSubmit = async () => {
    if (note < 1 || note > 5 || submitting) return

    setSubmitting(true)
    setSubmitError('')

    try {
      const response = await fetch('/api/satisfaction/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, note, commentaire: commentaire.trim() }),
      })
      const body = (await response.json()) as { error?: string }

      if (!response.ok) {
        setSubmitError(body.error ?? "Erreur pendant l'envoi de votre réponse.")
        return
      }

      setDone(true)
    } catch {
      setSubmitError("Erreur pendant l'envoi de votre réponse.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fbf7f1] px-4 py-10">
      <main className="w-full max-w-xl rounded-3xl border border-[#eadfd2] bg-[#fffdf9] p-6 shadow-lg sm:p-10">
        <p className="text-center text-xs font-semibold uppercase tracking-widest text-[#9b6a3d]">
          Clinique PsychoÉducAction
        </p>
        <h1 className="mt-2 text-center text-2xl font-bold text-[#332820]">
          Votre avis compte pour nous
        </h1>

        {loading ? (
          <p className="mt-8 text-center text-sm text-[#8a6f5d]">
            Chargement…
          </p>
        ) : invalid ? (
          <p className="mt-8 text-center text-sm text-[#8a6f5d]">
            Ce lien est invalide ou a expiré. Si vous croyez qu’il s’agit d’une
            erreur, communiquez avec la clinique.
          </p>
        ) : done || alreadyResponded ? (
          <div className="mt-8 text-center">
            <p className="text-base font-semibold text-[#332820]">
              Merci{prenom ? ` ${prenom}` : ''} pour votre réponse !
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[#6c5a4d]">
              Votre retour nous aide à améliorer nos services.
            </p>
            <div className="mt-6 rounded-2xl border border-[#eadfd2] bg-[#fbf7f1] p-5">
              <p className="text-sm text-[#6c5a4d]">
                Si vous souhaitez aussi partager votre expérience publiquement,
                voici notre fiche Google :
              </p>
              <a
                href={GOOGLE_REVIEW_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block rounded-xl bg-[#9b6a3d] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#7d5527]"
              >
                Laisser un avis Google
              </a>
            </div>
          </div>
        ) : (
          <div className="mt-8">
            <p className="text-center text-sm text-[#6c5a4d]">
              Bonjour{prenom ? ` ${prenom}` : ''}, comment évaluez-vous votre
              expérience globale à la clinique ?
            </p>

            <div
              className="mt-5 flex items-center justify-center gap-2"
              role="radiogroup"
              aria-label="Note de satisfaction"
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={note === value}
                  aria-label={`${value} — ${NOTE_LABELS[value]}`}
                  title={NOTE_LABELS[value]}
                  onClick={() => setNote(value)}
                  className="rounded-full p-1 transition hover:scale-110"
                >
                  <Star
                    className={`h-10 w-10 ${
                      value <= note
                        ? 'fill-[#c98b52] text-[#c98b52]'
                        : 'text-[#dfd0bf]'
                    }`}
                  />
                </button>
              ))}
            </div>

            {note > 0 && (
              <p className="mt-2 text-center text-sm font-medium text-[#9b6a3d]">
                {NOTE_LABELS[note]}
              </p>
            )}

            <label
              htmlFor="satisfaction-commentaire"
              className="mt-6 block text-sm font-medium text-[#332820]"
            >
              Un commentaire à nous partager ? (optionnel)
            </label>
            <textarea
              id="satisfaction-commentaire"
              value={commentaire}
              onChange={(event) => setCommentaire(event.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Dites-nous ce qui vous a plu, ou ce que nous pourrions améliorer…"
              className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] shadow-sm outline-none transition focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
            />

            {submitError && (
              <p className="mt-3 text-center text-sm font-medium text-red-700">
                {submitError}
              </p>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={note < 1 || submitting}
              className="mt-6 w-full rounded-xl bg-[#9b6a3d] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#7d5527] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Envoi en cours…' : 'Envoyer ma réponse'}
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
