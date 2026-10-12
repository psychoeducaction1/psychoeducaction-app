'use client'

import { Badge } from '@/components/ui/index'
import { appointmentStatusLabels, prospectDateTime, splitProspectAppointments, type IntakeAppointment } from '@/lib/prospectsWorkspace'

function AppointmentSummary({ appointment }: { appointment: IntakeAppointment }) {
  return <div className="mt-4 rounded-xl border border-[#eadfd2] bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-semibold text-[#332820]">{prospectDateTime.format(new Date(appointment.start_at))}</p>
      <Badge tone={appointment.status === 'scheduled' ? 'success' : 'muted'}>{appointmentStatusLabels[appointment.status]}</Badge>
    </div>
    {appointment.events.length > 0 && <details className="mt-4">
      <summary className="cursor-pointer text-sm font-semibold text-[#5d4a3d]">Historique du rendez-vous ({appointment.events.length})</summary>
      <div className="mt-3 space-y-3">{[...appointment.events].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).map((event) => <div key={event.id} className="border-l-2 border-[#d8b992] pl-3 text-xs text-[#6c5a4d]">
        <p className="font-semibold">{event.event_type === 'scheduled' ? 'Rendez-vous créé' : event.event_type === 'rescheduled' ? 'Rendez-vous déplacé' : event.event_type === 'cancelled' ? 'Rendez-vous annulé' : event.event_type === 'completed' ? 'Appel traité' : event.event_type}</p>
        <p>{prospectDateTime.format(new Date(event.created_at))}{event.actor_name ? ` · ${event.actor_name}` : ''}</p>
        {event.previous_start_at && <p>Ancien créneau : {prospectDateTime.format(new Date(event.previous_start_at))}</p>}
        {event.new_start_at && <p>Nouveau créneau : {prospectDateTime.format(new Date(event.new_start_at))}</p>}
        {event.note && <p className="mt-1 whitespace-pre-wrap">{event.note}</p>}
      </div>)}</div>
    </details>}
  </div>
}

export function ProspectAppointments({ appointments, appointmentId }: {
  appointments: IntakeAppointment[]
  appointmentId?: string
}) {
  const { primary, others } = splitProspectAppointments(appointments, appointmentId)
  if (!primary) return null
  return <section className="mt-5">
    <h3 className="font-semibold text-[#332820]">Rendez-vous</h3>
    <AppointmentSummary key={`${primary.id}-${primary.start_at}`} appointment={primary} />
    {others.length > 0 && <details className="mt-3">
      <summary className="cursor-pointer text-sm text-[#7a6859]">Autres rendez-vous ({others.length})</summary>
      {others.map((appointment) => <AppointmentSummary key={`${appointment.id}-${appointment.start_at}`} appointment={appointment} />)}
    </details>}
  </section>
}
