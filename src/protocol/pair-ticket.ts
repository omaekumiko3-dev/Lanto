import { X509Certificate } from 'node:crypto'
import { pairTicketSchema } from './host.ts'
import type { PairTicket } from './host.ts'

const prefix = 'LANTO1.'

export function encodeTicket(ticket: PairTicket): string {
  return prefix + Buffer.from(JSON.stringify(pairTicketSchema.parse(ticket))).toString('base64url')
}

export function decodeTicket(input: string, now = Date.now()): PairTicket {
  const value = input.trim()
  if (!value.startsWith(prefix) || value.length > 16000)
    throw new Error('Invalid pairing ticket format')
  try {
    const ticket = pairTicketSchema.parse(
      JSON.parse(Buffer.from(value.slice(prefix.length), 'base64url').toString('utf8'))
    )
    const certificate = new X509Certificate(ticket.certificate)
    if (now >= Date.parse(ticket.expiresAt))
      throw new Error('Pairing ticket expired; generate a new one on the Host')
    if (Date.parse(certificate.validTo) <= now || Date.parse(certificate.validFrom) > now)
      throw new Error('Host certificate is outside its validity period')
    return ticket
  } catch (error) {
    if (error instanceof Error && /expired|validity period/.test(error.message)) throw error
    throw new Error('Invalid pairing ticket format')
  }
}
