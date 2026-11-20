import type { MandateService } from './types'

const order = ['intervention', 'psychoeducation', 'psychotherapy', 'psychological_assessment', 'ivac', 'pae']

export function orderedClinicalServices<T extends Pick<MandateService, 'code' | 'label' | 'active' | 'kind'>>(services: T[]): T[] {
  return services.filter(service => service.active && service.kind === 'clinical')
    .sort((a, b) => {
      const aIndex = order.indexOf(a.code), bIndex = order.indexOf(b.code)
      return (aIndex < 0 ? order.length : aIndex) - (bIndex < 0 ? order.length : bIndex)
        || a.label.localeCompare(b.label, 'fr-CA')
    })
}
