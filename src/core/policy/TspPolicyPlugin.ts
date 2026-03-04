import * as path from "path"
import * as ts from "typescript"
import { getLayer, Layer } from "@/utils/joy-zoning"
import { Logger } from "../../shared/services/Logger"

/**
 * TspPolicyPlugin: A production-grade TypeScript Transformer that enforces
 * Joy-Zoning architectural policies at the AST level.
 */
export class TspPolicyPlugin {
	/**
	 * Analyzes a source file for architectural violations at the AST level.
	 * Returns a list of violations if any are found.
	 */
	public validateSource(
		filePath: string,
		content: string,
		resolveContent?: (path: string) => string | undefined,
	): { success: boolean; errors: string[] } {
		const errors: string[] = []
		const currentLayer = getLayer(filePath)

		// Create a source file from the content
		const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true)

		// 1. Rule: No 'any' types in Domain or Infrastructure (core is exempt)
		if (currentLayer === "domain" || currentLayer === "infrastructure") {
			this.findAnyTypes(sourceFile, currentLayer, errors)
		}

		// 2. Rule: Single Class per file in Domain
		if (currentLayer === "domain") {
			const classCount = this.countClasses(sourceFile)
			if (classCount > 1) {
				errors.push(`Domain layer expects one class per file — found ${classCount}.`)
			}
		}

		// 3. Rule: Layered Import Constraints
		this.validateImports(sourceFile, filePath, currentLayer, errors, resolveContent)

		return {
			success: errors.length === 0,
			errors,
		}
	}

	/**
	 * Recursively finds 'any' keyword usage.
	 */
	private findAnyTypes(node: ts.Node, layer: string, errors: string[]) {
		if (node.kind === ts.SyntaxKind.AnyKeyword) {
			const { line } = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart())
			errors.push(
				`'any' type in ${layer.toUpperCase()} layer (line ${line + 1}) — use a typed interface or generic instead.`,
			)
		}
		ts.forEachChild(node, (child) => this.findAnyTypes(child, layer, errors))
	}

	/**
	 * Counts top-level classes in a source file.
	 */
	private countClasses(sourceFile: ts.SourceFile): number {
		let count = 0
		ts.forEachChild(sourceFile, (node) => {
			if (ts.isClassDeclaration(node)) {
				count++
			}
		})
		return count
	}

	/**
	 * Validates imports against Joy-Zoning rules.
	 */
	private validateImports(
		sourceFile: ts.SourceFile,
		filePath: string,
		currentLayer: Layer,
		errors: string[],
		resolveContent?: (path: string) => string | undefined,
	) {
		ts.forEachChild(sourceFile, (node) => {
			if (ts.isImportDeclaration(node)) {
				const moduleSpecifier = node.moduleSpecifier
				if (ts.isStringLiteral(moduleSpecifier)) {
					const moduleName = moduleSpecifier.text

					// Resolve relative imports
					let targetPath = moduleName
					if (moduleName.startsWith(".")) {
						targetPath = path.resolve(path.dirname(filePath), moduleName)
					}

					const targetLayer = getLayer(targetPath)

					// Rule: Domain Constraints — strictest isolation
					if (currentLayer === "domain") {
						if (
							targetLayer === "infrastructure" ||
							targetLayer === "ui" ||
							moduleName.includes("infrastructure") ||
							moduleName.includes("ui")
						) {
							errors.push(
								`Domain cannot import '${moduleName}' (${targetLayer} layer) — extract an interface instead.`,
							)
						}

						if (["fs", "path", "os", "crypto", "http", "child_process"].includes(moduleName)) {
							errors.push(`Domain cannot use Node.js module '${moduleName}' — wrap in an Infrastructure adapter.`)
						}
					}

					// Rule: Core Constraints — orchestration layer
					if (currentLayer === "core" && targetLayer === "ui") {
						errors.push(`Core layer cannot import UI component '${moduleName}' — use events or callbacks instead.`)
					}

					// Rule: Infrastructure Constraints
					if (currentLayer === "infrastructure" && targetLayer === "ui") {
						errors.push(`Infrastructure cannot import UI component '${moduleName}'.`)
					}

					// Rule: UI Constraints
					if (currentLayer === "ui" && targetLayer === "infrastructure") {
						errors.push(`UI cannot directly import Infrastructure '${moduleName}' — use dependency inversion.`)
					}

					// Rule: Plumbing Constraints (Zero context — fully independent)
					if (currentLayer === "plumbing") {
						if (["domain", "core", "infrastructure", "ui"].includes(targetLayer)) {
							errors.push(
								`Plumbing cannot depend on ${targetLayer} layer: '${moduleName}' — utilities must be independent.`,
							)
						}
					}

					// Rule: Direct Circular Dependency Detection
					if (moduleName.startsWith(".") && resolveContent) {
						// We append .ts because getLayer expects it for proper mapping in some cases
						const resolvedTarget = targetPath.endsWith(".ts") ? targetPath : targetPath + ".ts"
						const targetContent = resolveContent(resolvedTarget)

						if (targetContent) {
							const targetSource = ts.createSourceFile(resolvedTarget, targetContent, ts.ScriptTarget.Latest, true)
							ts.forEachChild(targetSource, (tNode) => {
								if (ts.isImportDeclaration(tNode)) {
									const tSpec = tNode.moduleSpecifier
									if (ts.isStringLiteral(tSpec) && tSpec.text.startsWith(".")) {
										const tBackPath = path.resolve(path.dirname(resolvedTarget), tSpec.text)
										const tBackResolved = tBackPath.endsWith(".ts") ? tBackPath : tBackPath + ".ts"
										const currentResolved = filePath.endsWith(".ts") ? filePath : filePath + ".ts"

										if (tBackResolved === currentResolved) {
											errors.push(
												`Circular dependency: '${path.basename(filePath)}' ↔ '${path.basename(resolvedTarget)}'.`,
											)
										}
									}
								}
							})
						}
					}
				}
			}
		})
	}

	/**
	 * Creates a TypeScript Transformer factory for Joy-Zoning.
	 * Can be used in a real 'tsc' plugin or build pipeline.
	 */
	public createTransformer(): ts.TransformerFactory<ts.SourceFile> {
		return (context: ts.TransformationContext) => {
			return (sourceFile: ts.SourceFile) => {
				const filePath = sourceFile.fileName
				const validation = this.validateSource(filePath, sourceFile.getText())

				if (!validation.success) {
					Logger.warn(`[JOY-ZONING] Violations in ${filePath}:\n${validation.errors.join("\n")}`)
				}

				return sourceFile
			}
		}
	}
}
