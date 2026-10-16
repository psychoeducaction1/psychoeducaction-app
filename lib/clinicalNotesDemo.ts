// Donnees entierement fictives. Etat en memoire de l'onglet uniquement.
export type DemoNoteStatus = 'prepare' | 'draft' | 'validated' | 'deposited'
export type DemoSession = {
  id: string
  date: string
  time: string
  mode: 'Teams' | 'Présentiel'
  template: 'suivi' | 'evaluation'
  consent: boolean
  sourceReady: boolean
  status: DemoNoteStatus
  text: string
  reviewed: boolean
}

export const demoTranscript = [
  { time: '04:12', speaker: 'Client fictif', text: 'Je garde mes tâches dans ma tête et j’en oublie. Quand je les écris, je choisis plus facilement par quoi commencer.' },
  { time: '12:35', speaker: 'Professionnel fictif', text: 'Nous pouvons reprendre un exemple et décomposer la tâche. Essayons une liste de trois priorités.' },
  { time: '31:08', speaker: 'Client fictif', text: 'Je vais préparer ma liste le soir et choisir la première petite étape.' },
  { time: '46:20', speaker: 'Professionnel fictif', text: 'Nous reviendrons sur cet essai lors du prochain suivi. La date reste à confirmer.' },
]

export function getDemoNote(template: DemoSession['template']) {
  if (template === 'evaluation') return `DEMONSTRATION — DONNEES FICTIVES

MOTIF ET OBJECTIF
Explorer les difficultés rapportées dans l’organisation des tâches quotidiennes.

INFORMATIONS RECUEILLIES
Le client fictif rapporte oublier certaines tâches lorsqu’il ne les note pas. Il indique qu’une liste facilite le choix d’une première action.

INTERVENTIONS ET OBSERVATIONS
Exploration d’une situation et décomposition en étapes. Présentation d’une liste de trois priorités. Le client fictif choisit une première action et un moment pour l’essayer.

ELEMENTS A COMPLETER PAR LE PROFESSIONNEL
L’extrait ne permet pas de conclure une évaluation. Compléter les informations pertinentes et vérifier les observations. Aucun diagnostic n’est proposé.

PLAN
Essayer une courte liste le soir. Revenir sur l’essai au prochain suivi. Date du prochain rendez-vous à confirmer.`

  return `DEMONSTRATION — DONNEES FICTIVES

OBJECTIF DE LA RENCONTRE
Soutenir l’organisation des tâches quotidiennes et explorer une stratégie de planification.

INFORMATIONS RAPPORTEES
Le client fictif rapporte oublier certaines tâches lorsqu’il tente de les garder en mémoire. Il précise qu’une liste l’aide à choisir par quoi commencer.

INTERVENTIONS
Exploration d’une situation concrète, décomposition de la tâche en étapes et proposition d’une liste de trois priorités.

REACTIONS ET OBSERVATIONS
Le client fictif choisit une première étape et un moment pour essayer la stratégie. Les observations doivent être vérifiées par le professionnel.

PLAN DE SUIVI
Essayer une courte liste le soir et revenir sur son utilisation au prochain suivi. Date du prochain rendez-vous à confirmer.`
}

export function createDemoSession(number: number): DemoSession {
  return {
    id: `FICT-${String(number).padStart(3, '0')}`,
    date: '2026-10-16', time: '09:00', mode: 'Teams', template: 'suivi',
    consent: false, sourceReady: false, status: 'prepare', text: '', reviewed: false,
  }
}

export function createDemoSessions(): DemoSession[] {
  return [
    { ...createDemoSession(1), consent: true, sourceReady: true, status: 'draft', text: getDemoNote('suivi') },
    { ...createDemoSession(2), time: '11:00' },
    { ...createDemoSession(3), time: '13:30', mode: 'Présentiel', template: 'evaluation' },
  ]
}

export type DemoNoteAction =
  | { type: 'configure'; date?: string; time?: string; mode?: DemoSession['mode']; template?: DemoSession['template']; consent?: boolean }
  | { type: 'source' }
  | { type: 'generate' }
  | { type: 'edit'; text: string }
  | { type: 'review'; checked: boolean }
  | { type: 'validate' }
  | { type: 'reopen' }
  | { type: 'deposit' }

export function transitionDemoNote(session: DemoSession, action: DemoNoteAction): DemoSession {
  switch (action.type) {
    case 'configure': {
      if (session.status !== 'prepare') return session
      return {
        ...session,
        date: action.date ?? session.date, time: action.time ?? session.time,
        mode: action.mode ?? session.mode, template: action.template ?? session.template,
        consent: action.consent ?? session.consent, sourceReady: false,
      }
    }
    case 'source':
      return session.status === 'prepare' && session.consent
        ? { ...session, sourceReady: true } : session
    case 'generate':
      return session.status === 'prepare' && session.consent && session.sourceReady
        ? { ...session, text: getDemoNote(session.template), status: 'draft', reviewed: false } : session
    case 'edit':
      return session.status === 'draft' || session.status === 'validated'
        ? { ...session, text: action.text, status: 'draft', reviewed: false } : session
    case 'review':
      return session.status === 'draft' ? { ...session, reviewed: action.checked } : session
    case 'validate':
      return session.status === 'draft' && session.reviewed && session.text.trim()
        ? { ...session, status: 'validated' } : session
    case 'reopen':
      return session.status === 'validated' ? { ...session, status: 'draft', reviewed: false } : session
    case 'deposit':
      return session.status === 'validated' ? { ...session, status: 'deposited' } : session
  }
}

export function getDemoCopyText(session: DemoSession) {
  if (session.status !== 'validated' && session.status !== 'deposited') return null
  return `DEMONSTRATION — NE PAS DEPOSER DANS UN VRAI DOSSIER\nRéférence fictive : ${session.id}\nRencontre fictive : ${session.date} à ${session.time} — ${session.mode}\n\n${session.text}`
}
