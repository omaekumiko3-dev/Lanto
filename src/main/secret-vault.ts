import { safeStorage } from 'electron'
import type { SecretVault } from '../controller/trust-store.ts'

function requireEncryption(): void {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  ) {
    throw new Error('System secure storage is unavailable. Configure the system keychain before pairing')
  }
}

export const systemVault: SecretVault = {
  encrypt(value) {
    requireEncryption()
    return safeStorage.encryptString(value).toString('base64')
  },
  decrypt(value) {
    requireEncryption()
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  }
}
