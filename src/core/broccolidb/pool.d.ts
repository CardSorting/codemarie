import * as admin from "firebase-admin"
import { Repository } from "./repository"
/**
 * FirestorePool manages shared instances of Firestore and Repositories.
 * This prevents resource leak and ensuring consistent connection state for an agent.
 */
export declare class FirestorePool {
	private static connections
	private static repos
	/**
	 * Get or create a Firestore instance for a project.
	 */
	static getDb(
		config:
			| admin.ServiceAccount
			| {
					projectId: string
			  },
	): admin.firestore.Firestore
	/**
	 * Get or create a Repository instance to ensure agents share the same state object.
	 */
	static getRepo(db: admin.firestore.Firestore, userId: string, projectId: string, repoId: string): Repository
	static clear(): void
}
//# sourceMappingURL=pool.d.ts.map
