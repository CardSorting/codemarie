import * as fs from "fs"
import * as path from "path"
import { CallExpression, ImportDeclaration, Project, SyntaxKind } from "ts-morph"
import { getLayer, Layer } from "@/utils/joy-zoning"

export interface SpiderNode {
	id: string
	path: string
	layer: Layer
	imports: string[]
	depth: number
	orphaned: boolean
}

export interface SpiderSnapshot {
	timestamp: string
	entropyScore: number
	nodes: SpiderNode[]
	components: {
		depthScore: number
		namingScore: number
		orphanScore: number
		couplingScore: number
	}
}

export interface SpiderEntropyReport {
	score: number
	components: {
		depthScore: number
		namingScore: number
		orphanScore: number
		couplingScore: number
	}
}

export interface SpiderViolation {
	id: string
	severity: "ERROR" | "WARN" | "INFO"
	message: string
	path: string
}

/**
 * SpiderEngine: Implements structural graph analysis, entropy scoring,
 * and evolution tracking (snapshots).
 */
export class SpiderEngine {
	public nodes: Map<string, SpiderNode> = new Map()
	private project: Project
	private snapshotDir: string

	constructor(public cwd: string) {
		this.snapshotDir = path.join(cwd, ".spider", "snapshots")
		this.project = new Project({
			useInMemoryFileSystem: true,
			compilerOptions: {
				allowJs: true,
				checkJs: false,
			},
		})
	}

	/**
	 * Incrementally updates or adds a single file to the structural graph.
	 */
	public updateNode(filePath: string, content: string) {
		const absolutePath = path.resolve(this.cwd, filePath)
		const relativePath = path.relative(this.cwd, absolutePath)
		const normalizedPath = relativePath.replace(/\\/g, "/")
		const layer = getLayer(absolutePath)

		const sourceFile = this.project.createSourceFile(absolutePath, content, { overwrite: true })
		const imports: Set<string> = new Set()

		sourceFile.forEachDescendant((node) => {
			if (node.isKind(SyntaxKind.ImportDeclaration)) {
				const importDeclaration = node as ImportDeclaration
				const moduleSpecifier = importDeclaration.getModuleSpecifier().getLiteralValue()
				imports.add(moduleSpecifier)
			} else if (node.isKind(SyntaxKind.CallExpression)) {
				const callExpression = node as CallExpression
				if (callExpression.getExpression().getText() === "import" && callExpression.getArguments().length > 0) {
					const arg = callExpression.getArguments()[0]
					if (arg?.isKind(SyntaxKind.StringLiteral)) {
						imports.add(arg.getLiteralValue())
					}
				}
			}
		})

		this.nodes.set(normalizedPath, {
			id: normalizedPath,
			path: normalizedPath,
			layer,
			imports: Array.from(imports),
			depth: normalizedPath.split("/").length - 1,
			orphaned: false,
		})

		this.computeReachability()
	}

	/**
	 * Removes a node from the structural graph.
	 */
	public removeNode(filePath: string) {
		const absolutePath = path.resolve(this.cwd, filePath)
		const relativePath = path.relative(this.cwd, absolutePath)
		const normalizedPath = relativePath.replace(/\\/g, "/")

		this.nodes.delete(normalizedPath)
		const sf = this.project.getSourceFile(absolutePath)
		if (sf) this.project.removeSourceFile(sf)
		this.computeReachability()
	}

	/**
	 * Clears all nodes from the structural graph and the underlying project.
	 */
	public clearNodes() {
		this.nodes.clear()
		for (const sourceFile of this.project.getSourceFiles()) {
			this.project.removeSourceFile(sourceFile)
		}
	}

	/**
	 * Builds a structural graph of the provided files.
	 */
	public buildGraph(files: { filePath: string; content: string }[]): void {
		this.nodes.clear()
		for (const sourceFile of this.project.getSourceFiles()) {
			this.project.removeSourceFile(sourceFile)
		}

		for (const file of files) {
			const absolutePath = path.resolve(this.cwd, file.filePath)
			const relativePath = path.relative(this.cwd, absolutePath)
			const normalizedPath = relativePath.replace(/\\/g, "/")
			const layer = getLayer(absolutePath)

			const sourceFile = this.project.createSourceFile(absolutePath, file.content, { overwrite: true })
			const imports: Set<string> = new Set()

			sourceFile.forEachDescendant((node) => {
				if (node.isKind(SyntaxKind.ImportDeclaration)) {
					const importDeclaration = node as ImportDeclaration
					const moduleSpecifier = importDeclaration.getModuleSpecifier().getLiteralValue()
					imports.add(moduleSpecifier)
				} else if (node.isKind(SyntaxKind.CallExpression)) {
					const callExpression = node as CallExpression
					if (callExpression.getExpression().getText() === "import" && callExpression.getArguments().length > 0) {
						const arg = callExpression.getArguments()[0]
						if (arg?.isKind(SyntaxKind.StringLiteral)) {
							imports.add(arg.getLiteralValue())
						}
					}
				}
			})

			this.nodes.set(normalizedPath, {
				id: normalizedPath,
				path: normalizedPath,
				layer,
				imports: Array.from(imports),
				depth: normalizedPath.split("/").length - 1,
				orphaned: false,
			})
		}

		this.computeReachability()
	}

	/**
	 * Computes reachability from "root" layers.
	 */
	private computeReachability() {
		const roots = Array.from(this.nodes.values()).filter(
			(n) => n.layer === "ui" || n.layer === "core" || n.path.includes("main.") || n.path.includes("index."),
		)

		const reachable = new Set<string>()
		const queue = roots.map((r) => r.id)
		for (const id of queue) reachable.add(id)

		let head = 0
		while (head < queue.length) {
			const currentId = queue[head++]
			if (!currentId) continue
			const node = this.nodes.get(currentId)
			if (node) {
				for (const imp of node.imports) {
					const resolved = this.resolveImportToNodeId(node.path, imp)
					if (resolved && this.nodes.has(resolved) && !reachable.has(resolved)) {
						reachable.add(resolved)
						queue.push(resolved)
					}
				}
			}
		}

		for (const node of this.nodes.values()) {
			node.orphaned = !reachable.has(node.id)
		}
	}

	/**
	 * Computes entropy score.
	 */
	public computeEntropy(): SpiderEntropyReport {
		const totalNodes = this.nodes.size
		if (totalNodes === 0) {
			return { score: 0, components: { depthScore: 0, namingScore: 0, orphanScore: 0, couplingScore: 0 } }
		}

		const avgDepth = Array.from(this.nodes.values()).reduce((acc, n) => acc + n.depth, 0) / totalNodes
		const depthScore = Math.min(avgDepth / 4, 1.0)

		const namingViolations = Array.from(this.nodes.values()).filter((n) => {
			const base = path.basename(n.path).split(".")[0] || ""
			return !/^[a-z0-9-]+$/.test(base)
		}).length
		const namingScore = namingViolations / totalNodes

		const orphans = Array.from(this.nodes.values()).filter((n) => n.orphaned).length
		const orphanScore = orphans / totalNodes

		let crossLayerEdges = 0
		let totalEdges = 0
		for (const node of this.nodes.values()) {
			for (const imp of node.imports) {
				totalEdges++
				const targetLayer = this.resolveLayer(node.id, imp)
				if (targetLayer && targetLayer !== node.layer && targetLayer !== "plumbing") {
					crossLayerEdges++
				}
			}
		}
		const couplingScore = totalEdges > 0 ? crossLayerEdges / totalEdges : 0

		const score = depthScore * 0.3 + namingScore * 0.2 + orphanScore * 0.2 + couplingScore * 0.3

		return { score, components: { depthScore, namingScore, orphanScore, couplingScore } }
	}

	/**
	 * Resolves violations.
	 */
	public getViolations(): SpiderViolation[] {
		const violations: SpiderViolation[] = []
		for (const node of this.nodes.values()) {
			if (node.depth > 4) {
				violations.push({
					id: "SPI-001",
					severity: "ERROR",
					message: `Path depth (${node.depth}) exceeds limit (4).`,
					path: node.id,
				})
			}
			const base = path.basename(node.path).split(".")[0] || ""
			if (!/^[a-z0-9-]+$/.test(base)) {
				violations.push({
					id: "SPI-002",
					severity: "WARN",
					message: `File name '${path.basename(node.path)}' violates kebab-case.`,
					path: node.id,
				})
			}
			if (node.orphaned) {
				violations.push({
					id: "SPI-003",
					severity: "WARN",
					message: "Node is orphaned (unreachable from roots).",
					path: node.id,
				})
			}
		}
		return violations
	}

	public toMermaid(): string {
		let mermaid = "graph TD\n"
		for (const node of this.nodes.values()) {
			for (const imp of node.imports) {
				const resolved = this.resolveImportToNodeId(node.id, imp)
				if (resolved && this.nodes.has(resolved)) {
					mermaid += `  ${path.basename(node.id).replace(/\./g, "_")} --> ${path.basename(resolved).replace(/\./g, "_")}\n`
				}
			}
		}
		return mermaid
	}

	async takeSnapshot(): Promise<string> {
		const report = this.computeEntropy()
		const snapshot: SpiderSnapshot = {
			timestamp: new Date().toISOString(),
			entropyScore: report.score,
			nodes: Array.from(this.nodes.values()),
			components: report.components,
		}
		if (!fs.existsSync(this.snapshotDir)) fs.mkdirSync(this.snapshotDir, { recursive: true })
		const filePath = path.join(this.snapshotDir, `${Date.now()}.json`)
		await fs.promises.writeFile(filePath, JSON.stringify(snapshot, null, 2))
		return filePath
	}

	compareWith(snapshot: SpiderSnapshot): number {
		return this.computeEntropy().score - snapshot.entropyScore
	}

	async getLatestSnapshot(): Promise<SpiderSnapshot | null> {
		if (!fs.existsSync(this.snapshotDir)) return null
		const files = await fs.promises.readdir(this.snapshotDir)
		if (files.length === 0) return null
		const latest = files.sort().reverse()[0]
		if (!latest) return null
		const content = await fs.promises.readFile(path.join(this.snapshotDir, latest), "utf-8")
		return JSON.parse(content)
	}

	public resolveImportToNodeId(sourcePath: string, specifier: string): string | null {
		if (specifier.startsWith(".")) {
			const abs = path.resolve(this.cwd, path.dirname(sourcePath), specifier)
			const rel = path.relative(this.cwd, abs).replace(/\\/g, "/")
			if (this.nodes.has(rel)) return rel
			if (this.nodes.has(`${rel}.ts`)) return `${rel}.ts`
			if (this.nodes.has(`${rel}.tsx`)) return `${rel}.tsx`

			// Handle directory index files
			const indexTs = path.join(rel, "index.ts").replace(/\\/g, "/")
			if (this.nodes.has(indexTs)) return indexTs
			const indexTsx = path.join(rel, "index.tsx").replace(/\\/g, "/")
			if (this.nodes.has(indexTsx)) return indexTsx
		}
		if (specifier.startsWith("@/")) {
			const rel = specifier.replace("@/", "src/").replace(/\\/g, "/")
			if (this.nodes.has(rel)) return rel
			if (this.nodes.has(`${rel}.ts`)) return `${rel}.ts`
			if (this.nodes.has(`${rel}.tsx`)) return `${rel}.tsx`

			// Handle directory index files for aliases
			const indexTs = path.join(rel, "index.ts").replace(/\\/g, "/")
			if (this.nodes.has(indexTs)) return indexTs
			const indexTsx = path.join(rel, "index.tsx").replace(/\\/g, "/")
			if (this.nodes.has(indexTsx)) return indexTsx
		}
		return null
	}

	public resolveLayer(sourcePath: string, specifier: string): Layer | null {
		const id = this.resolveImportToNodeId(sourcePath, specifier)
		return id ? this.nodes.get(id)?.layer || null : null
	}
}
