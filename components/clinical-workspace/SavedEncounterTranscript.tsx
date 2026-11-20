'use client'
import { useState } from 'react'
import { clinicalRequest } from '@/lib/clinical-workspace/api'
import { validEncounterTranscript } from './useEncounterTranscript'
export function SavedEncounterTranscript({ actorId,recordId,appointmentId }: {actorId:string;recordId:string;appointmentId:string}) {
  const [text,setText]=useState<string|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false)
  const load=async()=>{if(text!==null || loading)return;setLoading(true);setError('');try{const v=await clinicalRequest<unknown>({actorId,context:'clinical'},'/records/'+recordId+'/appointments/'+appointmentId+'/transcript');if(!validEncounterTranscript(v,recordId,appointmentId))throw new Error('Transcription inaccessible.');setText(v.text)}catch(e){setError(e instanceof Error?e.message:'Transcription inaccessible.')}finally{setLoading(false)}}
  return <details className="mt-4 rounded-xl border border-[#dfd0bf] p-4" onToggle={event=>{if(event.currentTarget.open)void load()}}><summary className="cursor-pointer font-semibold">Transcription de la rencontre</summary>{loading && <p role="status">Chargement…</p>}{error && <p role="alert">{error}</p>}{text!==null && <p className="mt-3 whitespace-pre-wrap text-sm">{text || 'Aucune transcription enregistrée pour cette rencontre.'}</p>}</details>
}
