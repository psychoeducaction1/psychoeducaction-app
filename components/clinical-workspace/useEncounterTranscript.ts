'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { clinicalRequest } from '@/lib/clinical-workspace/api'
import { useClinicalNavigation } from './NavigationGuard'
export type SavedEncounterTranscript = { appointmentId: string; recordId: string; version: number; text: string; reviewed: boolean; updatedAt: string | null }
export function validEncounterTranscript(value: unknown, recordId: string, appointmentId: string): value is SavedEncounterTranscript {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return v.appointmentId===appointmentId && v.recordId===recordId && Number.isSafeInteger(v.version) && Number(v.version)>=0 && typeof v.text==='string' && v.text.length<=250000 && typeof v.reviewed==='boolean' && (v.updatedAt===null || typeof v.updatedAt==='string')
}
export function useEncounterTranscript({ enabled, actorId, recordId, appointmentId, text, reviewed, restore }: { enabled: boolean; actorId?: string; recordId: string; appointmentId: string; text: string; reviewed: boolean; restore: (text: string, reviewed: boolean) => void }) {
  const navigation=useClinicalNavigation()
  const [refresh,setRefresh]=useState(0)
  const [loaded,setLoaded]=useState(!enabled),[saving,setSaving]=useState(false),[error,setError]=useState('')
  const state=useRef({loaded:!enabled,version:0,savedText:'',savedReviewed:false})
  const latest=useRef({text,reviewed}),restoreRef=useRef(restore),pending=useRef<Promise<void>|null>(null),live=useRef(true)
  latest.current={text,reviewed};restoreRef.current=restore
  const path='/records/'+recordId+'/appointments/'+appointmentId+'/transcript'
  useEffect(()=>{live.current=true;return()=>{live.current=false}},[])
  useEffect(()=>{
    if(!enabled || !actorId)return
    const abort=new AbortController();state.current.loaded=false;setLoaded(false);setError('')
    void clinicalRequest<unknown>({actorId,context:'clinical'},path,undefined,'GET',abort.signal).then(v=>{
      if(abort.signal.aborted)return
      if(!validEncounterTranscript(v,recordId,appointmentId))throw new Error('La transcription enregistrée ne correspond pas à cette rencontre.')
      state.current={loaded:true,version:v.version,savedText:v.text,savedReviewed:v.reviewed};latest.current={text:v.text,reviewed:v.reviewed}
      restoreRef.current(v.text,v.reviewed);setLoaded(true)
    }).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Transcription inaccessible.')})
    return()=>abort.abort()
  },[enabled,actorId,path,recordId,appointmentId,refresh])
  const flush=useCallback(async()=>{
    if(!enabled)return
    if(!state.current.loaded && !latest.current.text.trim())return
    if(!actorId || !state.current.loaded)throw new Error('La transcription enregistrée doit être chargée avant de continuer.')
    for(;;){
      if(pending.current){await pending.current;continue}
      const current=latest.current,s=state.current
      if(!current.text.trim()){if(s.savedText)throw new Error('La transcription ne peut pas être vide. Rétablissez le texte avant de continuer.');return}
      if(current.text===s.savedText && current.reviewed===s.savedReviewed)return
      if(live.current){setSaving(true);setError('')}
      const operation=clinicalRequest<unknown>({actorId,context:'clinical'},path,{expectedVersion:s.version,text:current.text,reviewed:current.reviewed},'POST').then(v=>{
        if(!validEncounterTranscript(v,recordId,appointmentId) || v.text!==current.text || v.reviewed!==current.reviewed)throw new Error('L’enregistrement de la transcription n’a pas pu être confirmé.')
        state.current={loaded:true,version:v.version,savedText:v.text,savedReviewed:v.reviewed}
      })
      pending.current=operation
      try{await operation}catch(e){if(live.current)setError(e instanceof Error?e.message:'Transcription non enregistrée.');throw e}finally{pending.current=null;if(live.current)setSaving(false)}
    }
  },[enabled,actorId,path,recordId,appointmentId])
  useEffect(()=>{
    if(!enabled || !loaded || !text.trim() || error || text===state.current.savedText && reviewed===state.current.savedReviewed)return
    const timer=setTimeout(()=>{void flush().catch(()=>undefined)},1500);return()=>clearTimeout(timer)
  },[enabled,loaded,text,reviewed,error,flush])
  useEffect(()=>navigation.register(async()=>{try{await flush();return true}catch{return false}}),[navigation,flush])
  useEffect(()=>{
    const warn=(event:BeforeUnloadEvent)=>{if(enabled && (pending.current || latest.current.text!==state.current.savedText || latest.current.reviewed!==state.current.savedReviewed)){event.preventDefault();event.returnValue=''}}
    window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)
  },[enabled])
  const reload=()=>{if(latest.current.text!==state.current.savedText && !globalThis.confirm('Recharger remplacera vos modifications locales par la transcription enregistrée au dossier. Continuer ?'))return;setRefresh(value=>value+1)}
  return {loaded,saving,error:error || (loaded && state.current.savedText && !text.trim() ? 'La transcription ne peut pas être vide. Rétablissez le texte avant de continuer.' : ''),flush,reload,saved:loaded && !saving && !error && text===state.current.savedText && reviewed===state.current.savedReviewed}
}
