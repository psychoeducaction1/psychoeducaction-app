import 'server-only'
import type { ServiceOfficeAddresses } from '@/lib/serviceAppointment'

export function getServiceOfficeAddresses(): ServiceOfficeAddresses {
  return {
    montreal: process.env.SERVICE_APPOINTMENT_MONTREAL_ADDRESS?.trim() || '1600, boulevard Henri-Bourassa Ouest, Montréal (Québec) H3M 3E3, bureau 233 (2e étage)',
    longueuil: process.env.SERVICE_APPOINTMENT_LONGUEUIL_ADDRESS?.trim() || '401, chemin du Coteau-Rouge, Longueuil, J4J 1X5',
  }
}
