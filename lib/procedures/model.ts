export const procedureStatuses = { current: 'En vigueur', review: 'À relire', draft: 'À compléter' } as const
export type ProcedureStatus = keyof typeof procedureStatuses
export type ProcedureSection = { id: string; title: string; position: number; version: number }
export type ProcedureArticle = { id: string; sectionId: string; title: string; body: string; keywords: string[]; status: ProcedureStatus; version: number; updatedAt: string; sourceTitle: string | null }
export type ProcedureLibrary = { canEdit: boolean; sections: ProcedureSection[]; articles: ProcedureArticle[] }
export type ProcedureArticleInput = Pick<ProcedureArticle, 'id' | 'sectionId' | 'title' | 'body' | 'keywords' | 'status'> & { expectedVersion: number }
export const procedureUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').replace(/[’']/g, ' ')

export function filterProcedures(articles: readonly ProcedureArticle[], sections: readonly ProcedureSection[], query: string, sectionId: string) {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean)
  const names = new Map(sections.map(section => [section.id, section.title]))
  return articles.filter(article => (!sectionId || article.sectionId === sectionId) && words.every(word => normalize([article.title, article.body, ...article.keywords, names.get(article.sectionId) ?? ''].join(' ')).includes(word)))
    .sort((a, b) => a.title.localeCompare(b.title, 'fr'))
}

export function validProcedureArticle(value: Record<string, unknown>): value is Record<string, unknown> & ProcedureArticleInput {
  return Object.keys(value).every(key => ['id', 'sectionId', 'title', 'body', 'keywords', 'status', 'expectedVersion'].includes(key))
    && typeof value.id === 'string' && procedureUuid.test(value.id)
    && typeof value.sectionId === 'string' && procedureUuid.test(value.sectionId)
    && typeof value.title === 'string' && value.title.trim().length > 0 && value.title.length <= 160
    && typeof value.body === 'string' && value.body.length <= 40000
    && (value.status !== 'current' || value.body.trim().length > 0)
    && typeof value.status === 'string' && Object.hasOwn(procedureStatuses, value.status)
    && Array.isArray(value.keywords) && value.keywords.length <= 30 && value.keywords.every(word => typeof word === 'string' && word.trim().length > 0 && word.length <= 60)
    && Number.isSafeInteger(value.expectedVersion) && Number(value.expectedVersion) >= 0
}
