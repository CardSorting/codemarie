import admin from "firebase-admin"
export interface AgentGitConfig {
	projectId: string
	databaseId?: string
	credential?: admin.ServiceAccount | string
}
export declare class Connection {
	private db
	constructor(config?: AgentGitConfig)
	getFirestore(): admin.firestore.Firestore
}
//# sourceMappingURL=connection.d.ts.map
