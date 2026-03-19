/**
 * TODO: MULTI-ROOT CHECKPOINT MANAGER - NOT YET IN USE
 *
 * This MultiRootCheckpointManager class has been implemented as part of Phase 1
 * of the multi-workspace support initiative, but it is NOT currently being used
 * anywhere in the codebase.
 *
 * Current Status:
 * - The infrastructure is complete and ready
 * - The feature flag for multi-root is disabled by default
 * - The checkpoint factory (src/integrations/checkpoints/factory.ts) will
 *   instantiate this manager when multi-root is enabled
 *
 * Follow-up Implementation Required:
 * 1. Enable the multi-root feature flag in StateManager
 * 2. Update the checkpoint factory to use this manager when appropriate
 * 3. Test thoroughly with multiple workspace roots
 * 4. Add proper restoration logic for all workspace roots (not just primary)
 * 5. Implement full diff checking across all workspace roots
 *
 * See PRD: Multi-Workspace Folder Support for complete requirements
 */

import { MessageStateHandler } from "@core/task/message-state"
import { showChangedFilesDiff } from "@core/task/multifile-diff"
import { WorkspaceRootManager } from "@core/workspace"
import { telemetryService } from "@services/telemetry"
import { CodemarieMessage } from "@shared/ExtensionMessage"
import { CodemarieCheckpointRestore } from "@shared/WebviewMessage"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import CheckpointTracker from "./CheckpointTracker"
import { ICheckpointManager } from "./types"

/**
 * Manages checkpoints across multiple workspace roots.
 * Only created when multiple roots are detected and feature flag is enabled.
 *
 * This implementation follows Option B: Simple All-Workspace Approach
 * - Creates checkpoints instance for each input workspace root
 * - Commits run in parallel in the background (non-blocking)
 * - Maintains backward compatibility with single-root expectations
 */
export class MultiRootCheckpointManager implements ICheckpointManager {
	private trackers: Map<string, CheckpointTracker> = new Map()
	private initialized = false
	private initPromise?: Promise<void>

	constructor(
		private workspaceManager: WorkspaceRootManager,
		private taskId: string,
		private enableCheckpoints: boolean,
		private messageStateHandler: MessageStateHandler,
	) {}

	/**
	 * Initialize checkpoint trackers for all workspace roots
	 * This is called separately to avoid blocking the Task constructor
	 */
	async initialize(): Promise<void> {
		// Prevent multiple initialization attempts
		if (this.initialized) {
			return
		}

		if (this.initPromise) {
			return this.initPromise
		}

		this.initPromise = this.doInitialize()
		await this.initPromise
		this.initPromise = undefined
	}

	private async doInitialize(): Promise<void> {
		if (!this.enableCheckpoints) {
			Logger.log("[MultiRootCheckpointManager] Checkpoints disabled, skipping initialization")
			return
		}

		const startTime = performance.now()
		const roots = this.workspaceManager.getRoots()
		Logger.log(`[MultiRootCheckpointManager] Initializing for ${roots.length} workspace roots`)

		// Initialize all workspace roots in parallel
		const initPromises = roots.map(async (root) => {
			try {
				Logger.log(`[MultiRootCheckpointManager] Creating tracker for ${root.name} at ${root.path}`)
				const tracker = await CheckpointTracker.create(this.taskId, this.enableCheckpoints, root.path)
				if (tracker) {
					this.trackers.set(root.path, tracker)
					Logger.log(`[MultiRootCheckpointManager] Successfully initialized tracker for ${root.name}`)
					return true
				}
				return false
			} catch (error) {
				Logger.error(`[MultiRootCheckpointManager] Failed to initialize checkpoint for ${root.name}:`, error)
				// Continue with other roots even if one fails
				return false
			}
		})

		const results = await Promise.all(initPromises)
		const successCount = results.filter((r) => r).length
		const failureCount = results.length - successCount

		this.initialized = true
		Logger.log(`[MultiRootCheckpointManager] Initialization complete. Active trackers: ${this.trackers.size}`)

		// TELEMETRY: Track multi-root checkpoint initialization
		telemetryService.captureMultiRootCheckpoint(
			this.taskId,
			"initialized",
			roots.length,
			successCount,
			failureCount,
			performance.now() - startTime,
		)
	}

	/**
	 * Save checkpoint across all workspace roots
	 * Commits happen in parallel in the background (non-blocking)
	 */
	async saveCheckpoint(): Promise<void> {
		if (!this.enableCheckpoints || !this.initialized) {
			return
		}

		if (this.trackers.size === 0) {
			Logger.log("[MultiRootCheckpointManager] No trackers available for checkpoint")
			return
		}

		Logger.log(`[MultiRootCheckpointManager] Creating checkpoint across ${this.trackers.size} workspace(s)`)

		// Commit all roots in parallel (fire and forget for performance)
		const commitPromises = Array.from(this.trackers.entries()).map(async ([path, tracker]) => {
			try {
				const hash = await tracker.commit()
				if (hash) {
					const rootName = this.workspaceManager.getRoots().find((r) => r.path === path)?.name || path
					Logger.log(`[MultiRootCheckpointManager] Checkpoint created for ${rootName}: ${hash}`)
				}
				return { path, hash, success: true }
			} catch (error) {
				const rootName = this.workspaceManager.getRoots().find((r) => r.path === path)?.name || path
				Logger.error(`[MultiRootCheckpointManager] Failed to checkpoint ${rootName}:`, error)
				return { path, hash: undefined, success: false }
			}
		})

		// Don't await - let commits happen in background for better performance
		// But do catch any errors to prevent unhandled promise rejections
		const startTime = performance.now()
		Promise.all(commitPromises)
			.then((results) => {
				const successful = results.filter((r) => r.success).length
				const failed = results.length - successful
				Logger.log(`[MultiRootCheckpointManager] Checkpoint complete: ${successful}/${results.length} successful`)

				// TELEMETRY: Track checkpoint commits
				telemetryService.captureMultiRootCheckpoint(
					this.taskId,
					"committed",
					results.length,
					successful,
					failed,
					performance.now() - startTime,
				)
			})
			.catch((error) => {
				Logger.error("[MultiRootCheckpointManager] Unexpected error during checkpoint:", error)
			})
	}

	/**
	 * Restore checkpoint for workspace roots
	 * Restores all workspace trackers to their specific checkpoint hashes associated with the message.
	 */
	async restoreCheckpoint(
		messageTs: number,
		_restoreType: CodemarieCheckpointRestore,
		_offset?: number,
	): Promise<{ success: boolean; restoredCount: number } | { error: string }> {
		if (!this.initialized) {
			await this.initialize()
		}

		const codemarieMessages = this.messageStateHandler.getCodemarieMessages()
		const message = codemarieMessages.find((m) => m.ts === messageTs)

		if (!message || !message.lastCheckpointHash) {
			Logger.error(`[MultiRootCheckpointManager] No checkpoint hash found for message ${messageTs}`)
			return { error: "No checkpoint hash found" }
		}

		const hashStr = message.lastCheckpointHash
		let compositeHash: Record<string, string> = {}
		try {
			const parsed = JSON.parse(hashStr)
			if (parsed && typeof parsed === "object") {
				compositeHash = parsed
			}
		} catch (e) {
			// Fallback: use the same string for all (legacy mode)
			for (const path of this.trackers.keys()) {
				compositeHash[path] = hashStr
			}
		}

		Logger.log(`[MultiRootCheckpointManager] Restoring ${this.trackers.size} trackers using composite hash`)

		// Restore all trackers in parallel
		const restorePromises = Array.from(this.trackers.entries()).map(async ([path, tracker]) => {
			try {
				const workspaceHash = compositeHash[path]
				if (!workspaceHash) {
					Logger.log(`[MultiRootCheckpointManager] No hash for path ${path}, skipping restore for this root`)
					return false
				}
				await tracker.resetHead(workspaceHash)
				return true
			} catch (error) {
				Logger.error(`[MultiRootCheckpointManager] Failed to restore tracker at ${tracker.getWorkingDirectory()}:`, error)
				return false
			}
		})

		const results = await Promise.all(restorePromises)
		const successCount = results.filter((r) => r).length

		if (successCount === 0) {
			return { error: "Failed to restore any trackers" }
		}

		return { success: true, restoredCount: successCount }
	}

	/**
	 * Check if the latest task completion has new changes
	 * Returns true if ANY workspace has changes
	 */
	async doesLatestTaskCompletionHaveNewChanges(): Promise<boolean> {
		if (!this.initialized || this.trackers.size === 0) {
			return false
		}

		const codemarieMessages = this.messageStateHandler.getCodemarieMessages()
		let message: CodemarieMessage | undefined
		for (let i = codemarieMessages.length - 1; i >= 0; i--) {
			if (codemarieMessages[i]?.say === "completion_result") {
				message = codemarieMessages[i]
				break
			}
		}

		const hash = message?.lastCheckpointHash

		if (!hash) {
			return false
		}

		// Check if any root has changes since the last hash
		const results = await Promise.all(
			Array.from(this.trackers.values()).map(async (tracker) => {
				try {
					const count = await tracker.getDiffCount(hash)
					return (count || 0) > 0
				} catch (error) {
					Logger.error(
						`[MultiRootCheckpointManager] Error checking changes for ${tracker.getWorkingDirectory()}:`,
						error,
					)
					return false
				}
			}),
		)

		return results.some((r) => r)
	}

	/**
	 * Commit changes across all workspaces
	 * Returns a composite JSON map of hashes for multi-root compatibility
	 */
	async commit(): Promise<string | undefined> {
		if (!this.initialized || this.trackers.size === 0) {
			return undefined
		}

		// Commit all roots in parallel
		const commitPromises = Array.from(this.trackers.entries()).map(async ([path, tracker]) => {
			const hash = await tracker.commit().catch((error) => {
				Logger.error("[MultiRootCheckpointManager] Commit error:", error)
				return undefined
			})
			return { path, hash }
		})

		const results = await Promise.all(commitPromises)
		const compositeHash: Record<string, string> = {}
		let hasAnyHash = false
		for (const { path, hash } of results) {
			if (hash) {
				compositeHash[path] = hash
				hasAnyHash = true
			}
		}

		if (!hasAnyHash) {
			return undefined
		}
		return JSON.stringify(compositeHash)
	}

	/**
	 * Presents a multi-file diff view for the primary workspace root.
	 * For multi-root v1, this shows diffs for the primary root only.
	 */
	async presentMultifileDiff(messageTs: number, seeNewChangesSinceLastTaskCompletion: boolean): Promise<void> {
		try {
			if (!this.enableCheckpoints || !this.initialized) {
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: "Checkpoint manager is not initialized.",
				})
				return
			}

			const primaryRoot = this.workspaceManager.getPrimaryRoot()
			if (!primaryRoot) {
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: "No primary workspace root configured.",
				})
				return
			}

			const tracker = this.trackers.get(primaryRoot.path)
			if (!tracker) {
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: "No checkpoint tracker available for the primary workspace.",
				})
				return
			}

			await showChangedFilesDiff(this.messageStateHandler, tracker, messageTs, seeNewChangesSinceLastTaskCompletion)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			Logger.error("[MultiRootCheckpointManager] Failed to present multifile diff:", errorMessage)
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: `Failed to present diff: ${errorMessage}`,
			})
		}
	}
}
