/**
 * Privy Authentication Manager (Stub)
 *
 * This is a temporary stub that will be replaced when PR #144 (Privy auth) is merged
 */

class PrivyAuthManager {
  getToken(): string | null {
    // TODO: Implement actual auth when PR #144 is merged
    return null
  }

  async getAccessToken(): Promise<string | null> {
    // TODO: Implement actual auth when PR #144 is merged
    return null
  }

  isAuthenticated(): boolean {
    // TODO: Implement actual auth when PR #144 is merged
    return false
  }

  async refreshToken(): Promise<string | null> {
    // TODO: Implement actual auth when PR #144 is merged
    return null
  }
}

export const privyAuthManager = new PrivyAuthManager()
