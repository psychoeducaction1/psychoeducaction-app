// Extracted from the original assignment history, shared with the unified profile.
import type { ReactNode } from 'react'
import { Badge, buttonClass } from '@/components/ui/index'
import { AssignmentRequestComment } from '@/components/AssignmentRequestComment'
export type RequestHistoryCardData = {
 request: { id: string; requested_count: number | null; request_comment: string | null }
 status: string; durationLabel: string; createdDate: Date | string | null; completionDate: Date | string | null
 serviceTakenCount: number; serviceNotTakenCount: number; remainingCount: number; notContactedCount: number; pendingCount: number
}
function formatDate(value: Date | string | null) {
 if (!value) return '—'
 const date = new Date(value)
 return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('fr-CA', {dateStyle:'medium', timeZone:'America/Toronto'}).format(date)
}
export function RequestHistoryCard({card, isExpanded, onToggle, children, legacyPresentation = false}: {legacyPresentation?: boolean; card: RequestHistoryCardData; isExpanded: boolean; onToggle: () => void; children: ReactNode}) {
 const requestedCount = card.request.requested_count ?? 0, isCompleted = card.status === 'Completee'
 return (
                    <article

                      className="relative rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-4 shadow-[0_1px_2px_rgba(72,49,30,0.06)] sm:p-5"
                    >
                      <span className="absolute left-0 top-6 h-10 w-1 rounded-r-full bg-[#c98b52]" />
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={isCompleted ? 'success' : 'warning'}>
                              {isCompleted ? 'Complétée' : card.status === 'Archivée' ? 'Archivée' : 'Active'}
                            </Badge>
                            <span className="text-sm font-medium text-[#8a6f5d]">
                              {card.durationLabel}
                            </span>
                          </div>
                          <h2 className="mt-3 text-base font-semibold text-[#332820]">
                            {`Demande du ${formatDate(card.createdDate)}`}
                          </h2>
                          <p className="mt-1 text-sm text-[#7a6859]">
                            {`Complétion estimée : ${formatDate(card.completionDate)}`}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={onToggle}
                          className={buttonClass('secondary')}
                        >
                          {isExpanded
                            ? 'Masquer les clients'
                            : 'Voir les clients assignés'}
                        </button>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-3">
                          <p className="text-xs font-medium uppercase text-[#8a6f5d]">
                            {'Demande'}
                          </p>
                          <p className="mt-1 text-xl font-semibold text-[#332820]">
                            {requestedCount}
                          </p>
                        </div>
                        <div className="rounded-xl border border-[#d8e2c7] bg-[#f6faef] p-3">
                          <p className="text-xs font-medium uppercase text-[#6f7a58]">
                            Services pris
                          </p>
                          <p className="mt-1 text-xl font-semibold text-[#3f4f2d]">
                            {card.serviceTakenCount}
                          </p>
                        </div>
                        <div className="rounded-xl border border-[#e9cfc5] bg-[#fff6f2] p-3">
                          <p className="text-xs font-medium uppercase text-[#9a6a59]">
                            Services non pris
                          </p>
                          <p className="mt-1 text-xl font-semibold text-[#6f3f32]">
                            {card.serviceNotTakenCount}
                          </p>
                        </div>
                        <div className="rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-3">
                          <p className="text-xs font-medium uppercase text-[#8a6f5d]">
                            Restant
                          </p>
                          <p className="mt-1 text-xl font-semibold text-[#332820]">
                            {card.remainingCount}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 lg:grid-cols-[0.25fr_0.25fr_0.5fr]">
                        <div className="rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-3">
                          <p className="text-xs font-medium uppercase text-[#8a6f5d]">
                            Pas encore contacté
                          </p>
                          <p className="mt-1 text-sm font-semibold text-[#332820]">
                            {card.notContactedCount}
                          </p>
                        </div>
                        <div className="rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-3">
                          <p className="text-xs font-medium uppercase text-[#8a6f5d]">
                            En attente d&apos;une réponse
                          </p>
                          <p className="mt-1 text-sm font-semibold text-[#332820]">
                            {card.pendingCount}
                          </p>
                        </div>
                        <div className="rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-3">
                          <p className="text-xs font-medium uppercase text-[#8a6f5d]">
                            Commentaire
                          </p>
                          {legacyPresentation ? <p className="mt-1 whitespace-pre-wrap text-sm text-[#332820]">{card.request.request_comment?.trim() || '-'}</p> : <AssignmentRequestComment comment={card.request.request_comment ?? ''} />}
                        </div>
                      </div>

{children}
</article>
)
}
