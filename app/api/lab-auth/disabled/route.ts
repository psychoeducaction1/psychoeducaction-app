export async function GET() { return Response.json({error:'Cette route historique est désactivée dans le laboratoire isolé.'},{status:404,headers:{'Cache-Control':'no-store'}}) }
export const POST=GET
export const PATCH=GET
export const DELETE=GET
export const PUT=GET
