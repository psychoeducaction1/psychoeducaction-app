// Décimaux exacts à partir des valeurs importées, sans dépendance supplémentaire.
// Montants CAD : arrondi au cent, demi à l'opposé de zéro, par activité.
function fraction(value: number): [bigint, bigint] {
  if (!Number.isFinite(value)) throw new Error('Valeur financière non finie.')
  const [mantissa, exponentText = '0'] = String(value).toLowerCase().split('e')
  const decimals = mantissa.split('.')[1]?.length ?? 0
  const exponent = Number(exponentText) - decimals
  const integer = BigInt(mantissa.replace('.', ''))
  return exponent >= 0 ? [integer * BigInt(10) ** BigInt(exponent), BigInt(1)] : [integer, BigInt(10) ** BigInt(-exponent)]
}

function rounded(numerator: bigint, denominator: bigint, places: number): number {
  if (!denominator) throw new Error('Division financière par zéro.')
  const sign = (numerator < BigInt(0)) !== (denominator < BigInt(0)) ? -BigInt(1) : BigInt(1)
  const n = (numerator < BigInt(0) ? -numerator : numerator) * BigInt(10) ** BigInt(places)
  const d = denominator < BigInt(0) ? -denominator : denominator
  const integer = (n / d + (n % d * BigInt(2) >= d ? BigInt(1) : BigInt(0))) * sign
  if (integer > BigInt(Number.MAX_SAFE_INTEGER) || integer < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error('Montant hors limites.')
  }
  return Number(integer) / 10 ** places
}

export function decimalProduct(a: number, b: number, divisor = 1, places = 2): number {
  const [an, ad] = fraction(a), [bn, bd] = fraction(b), [dn, dd] = fraction(divisor)
  return rounded(an * bn * dd, ad * bd * dn, places)
}

export function decimalSum(values: number[], places = 2): number {
  let n = BigInt(0), d = BigInt(1)
  for (const value of values) {
    const [vn, vd] = fraction(value)
    if (vd > d) { n *= vd / d; d = vd; n += vn }
    else n += vn * (d / vd)
  }
  return rounded(n, d, places)
}

export function formatPayrollQuantity(value: number, unit = ''): string {
  if (!Number.isFinite(value) || value < 0) throw new Error('Quantité invalide.')
  // Les durées sources ont une précision à la minute. Aucun arrondi à l'entier.
  const formatted = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 6 }).format(value)
  return `${value > 0 && formatted === '0' ? '< 0,000001' : formatted}${unit ? ` ${unit}` : ''}`
}
