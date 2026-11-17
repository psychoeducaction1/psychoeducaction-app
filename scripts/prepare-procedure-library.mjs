// Offline conversion only: no network, authentication, database or environment files.
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

if (process.argv.length !== 2) throw new Error('This script accepts no arguments and never connects to a database.')
const root = new URL('../supabase/procedure-library/', import.meta.url)
const content = JSON.parse(await readFile(new URL('onenote-content.json', root), 'utf8'))
const id = key => { const h = createHash('sha256').update('pea/procedures/v1/' + key).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}` }
const quote = value => "'" + value.replaceAll("'", "''") + "'"
const sql = ['-- Prepared content import only. Run after 001-library.sql with explicit authorization.', '-- Existing edited articles are never overwritten. No membership is created.', 'begin;']
const keys = new Set()
content.sections.forEach((title, index) => sql.push(`insert into public.procedure_library_sections(id,title,position) values('${id('section/' + title)}',${quote(title)},${index}) on conflict(id) do nothing;`))
for (const article of content.articles) {
  if (keys.has(article.key) || !content.sections.includes(article.section) || article.body.length > 40000 || !['current','review','draft'].includes(article.status) || /IdSession=|access_token=|redeem=|1drv\.ms/i.test(article.body)) throw new Error('Invalid or unsafe source article')
  keys.add(article.key)
  sql.push(`insert into public.procedure_library_articles(id,section_id,title,body,keywords,status,source_title) values('${id('article/' + article.key)}','${id('section/' + article.section)}',${quote(article.title)},${quote(article.body)},ARRAY[${article.keywords.map(quote).join(',')} ]::text[],${quote(article.status)},${quote(article.section + ' / ' + article.title)}) on conflict(id) do nothing;`)
}
sql.push("insert into public.procedure_library_revisions(article_id,version,section_id,title,body,keywords,status,edited_by,edited_at) select id,version,section_id,title,body,keywords,status,updated_by,updated_at from public.procedure_library_articles where source_title is not null on conflict(article_id,version) do nothing;", 'commit;', '')
await writeFile(new URL('002-onenote-content.sql', root), sql.join('\n'))
console.log(`Prepared ${content.articles.length} articles in ${content.sections.length} sections. No database accessed.`)
