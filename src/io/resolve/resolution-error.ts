import { getSafeErrorDetails } from '../../utils/redact'

export function resolutionErrorDetails(error: unknown): { code: string; message: string } {
  const details = getSafeErrorDetails(error)
  return {
    code: /^[A-Z][A-Z0-9_]{0,63}$/u.test(details.code) ? details.code : 'ERR_RESOLVE',
    message: details.message.replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, ' ').slice(0, 512),
  }
}
