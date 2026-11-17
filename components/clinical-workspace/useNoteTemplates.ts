'use client'
import { useCallback, useEffect, useState } from 'react'
import { clinicalRequest } from '@/lib/clinical-workspace/api'
import { isNoteTemplateList, type PersonalNoteTemplate } from '@/lib/clinical-workspace/noteTemplates'

export function useNoteTemplates(actorId: string, enabled: boolean) {
  const [state, setState] = useState<{ actorId: string; templates: PersonalNoteTemplate[] }>({ actorId: '', templates: [] })
  const [error, setError] = useState(''), [loading, setLoading] = useState(enabled)
  const reload = useCallback(async (signal?: AbortSignal) => {
    if (!enabled) { setLoading(false); return }
    setLoading(true)
    try {
      const result = await clinicalRequest<{ templates: PersonalNoteTemplate[] }>({ actorId, context: 'clinical' }, '/note-templates', undefined, 'GET', signal, undefined, isNoteTemplateList)
      if (!signal?.aborted) { setState({ actorId, templates: result.templates }); setError('') }
    } catch (cause) { if (!signal?.aborted) { setState({ actorId, templates: [] }); setError(cause instanceof Error ? cause.message : 'Gabarits personnels indisponibles.') } }
    finally { if (!signal?.aborted) setLoading(false) }
  }, [actorId, enabled])
  useEffect(() => { const controller = new AbortController(); void reload(controller.signal); return () => controller.abort() }, [reload])
  return { templates: enabled && state.actorId === actorId ? state.templates : [], error, loading, reload }
}
