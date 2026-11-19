/** What the app keeps about one workspace that installed it. */
export interface Installation {
  workspaceId: string
  /**
   * The only thing needed later to act in the workspace: with the app's client id and secret it
   * gets installation tokens. Clickmax returns the same id when the workspace installs again.
   */
  installationId: string
  /** E-mail of the person who installed, from the ID token. Display only. */
  installedBy: string | undefined
  installedAt: Date
  /** Set when Clickmax stops accepting the installation (removed, or the app went private). */
  removedAt: Date | undefined
}

// In memory to keep the sample small. A real app stores this in its database, keyed by its own
// account or tenant so each customer reaches only its workspaces.
const byWorkspace = new Map<string, Installation>()

/**
 * Records an installation. Every way the app learns about an installation ends here, so the rest
 * of the app never cares how the installation happened.
 *
 * @param installation Workspace and installation ids from Clickmax.
 */
export function saveInstallation(
  installation: Omit<Installation, 'installedAt' | 'removedAt'>,
): Installation {
  const saved = { ...installation, installedAt: new Date(), removedAt: undefined }
  byWorkspace.set(installation.workspaceId, saved)
  return saved
}

/** @param workspaceId Clickmax workspace id. */
export function getInstallation(workspaceId: string): Installation | undefined {
  return byWorkspace.get(workspaceId)
}

/** Every installation, newest first. */
export function listInstallations(): Installation[] {
  return [...byWorkspace.values()].sort((a, b) => b.installedAt.getTime() - a.installedAt.getTime())
}

/**
 * Marks the workspace as disconnected. The record stays so the app can tell the customer to
 * install again instead of failing silently.
 *
 * @param workspaceId Clickmax workspace id.
 */
export function markRemoved(workspaceId: string): void {
  const installation = byWorkspace.get(workspaceId)
  if (installation) installation.removedAt = new Date()
}
