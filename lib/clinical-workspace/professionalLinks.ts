export function professionalSlug(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,160).replace(/-$/,'')
}
export function isProfessionalSlug(value: unknown): value is string {
  return typeof value==='string' && value.length<=160 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)
}
/** Homonyms retain their UUID link. A readable name never grants permission. */
export function uniqueProfessionalSlug(id: string, people: readonly {id:string;fullName:string}[]): string | null {
  const person=people.find(p=>p.id===id),slug=person ? professionalSlug(person.fullName) : ''
  return isProfessionalSlug(slug)&&people.filter(p=>professionalSlug(p.fullName)===slug).length===1 ? slug : null
}

export type ProfessionalRouteAlias = { id: string; slug: string | null; requestTarget?: string }
/** One already-authorized response may identify its own UUID/name alias only. */
export function professionalRequestTarget(target: string | null, alias: ProfessionalRouteAlias | null): string | null {
  return target && alias && (target === alias.id || target === alias.slug) ? alias.requestTarget ?? alias.id : target
}

export function professionalTargetMatches(target: string | null, id: string, people: readonly {id:string;fullName:string}[]): boolean {
  return !!target && (target === id || target === uniqueProfessionalSlug(id, people))
}

export function professionalCanonicalTarget(target: string | null, id: string, people: readonly {id:string;fullName:string}[]): string | null {
  const slug = uniqueProfessionalSlug(id, people)
  return slug && target !== slug && professionalTargetMatches(target, id, people) ? slug : null
}

/** The administrative UI is authorized separately; unchanged personal rollouts stay unchanged. */
export function retainsProfessionalTabProjection(administrative: boolean, id: string): boolean {
  return administrative || [
    '3c514611-b530-4f48-84e4-32871b32f320', // Hicham
    '826ec8b8-627f-4903-947e-24df0f446349', // Ève
    'd32a577c-7996-4f49-ae31-2486ee5811bd', // Thinhinane
  ].includes(id)
}
