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
