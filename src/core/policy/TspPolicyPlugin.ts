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
	): { success: boolean; errors: string[]; warnings: string[] } {
		const errors: string[] = []
		const warnings: string[] = []
		const currentLayer = getLayer(filePath)

		// Create a source file from the content
		const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true)

		// 1. Rule: 'any' types are discouraged but allowed (warning only)
		if (currentLayer === "domain" || currentLayer === "infrastructure") {
			this.findAnyTypes(sourceFile, currentLayer, warnings)
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
			warnings,
		}
	}

	/**
	 * Public API to detect cross-layer violations using AST.
	 */
	public findCrossLayerViolations(sourceFile: ts.SourceFile, filePath: string): string[] {
		const violations: string[] = []
		const currentLayer = getLayer(filePath)
		this.validateLayering(sourceFile, filePath, currentLayer, violations)
		return violations
	}

	/**
	 * Recursively finds 'any' keyword usage.
	 */
	private findAnyTypes(node: ts.Node, layer: string, warnings: string[]) {
		if (node.kind === ts.SyntaxKind.AnyKeyword) {
			const { line } = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart())
			warnings.push(`'any' type in ${layer.toUpperCase()} layer (line ${line + 1}).`)
		}
		ts.forEachChild(node, (child) => this.findAnyTypes(child, layer, warnings))
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

					// Resolve relative imports and aliases
					let targetPath = moduleName
					if (moduleName.startsWith(".")) {
						targetPath = path.resolve(path.dirname(filePath), moduleName)
					} else {
						targetPath = this.resolveAlias(moduleName)
					}

					const targetLayer = getLayer(targetPath)

					// Rule: Domain Constraints — strictest isolation
					if (currentLayer === "domain") {
						if (targetLayer === "infrastructure" || targetLayer === "ui") {
							errors.push(
								`Domain cannot import '${moduleName}' (${targetLayer} layer) — extract an interface instead.`,
							)
						}

						if (["fs", "path", "os", "crypto", "http", "https", "child_process", "url", "net"].includes(moduleName)) {
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
								`Plumbing cannot depend on ${targetLayer} layer: '${moduleName}' — utilities must be fully independent.`,
							)
						}

						// Additionally block high-level infrastructure modules in plumbing
						if (["@services", "@integrations", "@api", "@core"].some((alias) => moduleName.startsWith(alias))) {
							errors.push(`Plumbing layer violation: '${moduleName}' is a high-level dependency.`)
						}
					}

					// Rule: Direct Circular Dependency Detection
					if (moduleName.startsWith(".") && resolveContent) {
						// We append .ts because getLayer expects it for proper mapping in some cases
						const resolvedTarget = targetPath.endsWith(".ts") ? targetPath : `${targetPath}.ts`
						const targetContent = resolveContent(resolvedTarget)

						if (targetContent) {
							const targetSource = ts.createSourceFile(resolvedTarget, targetContent, ts.ScriptTarget.Latest, true)
							ts.forEachChild(targetSource, (tNode) => {
								if (ts.isImportDeclaration(tNode)) {
									const tSpec = tNode.moduleSpecifier
									if (ts.isStringLiteral(tSpec) && tSpec.text.startsWith(".")) {
										const tBackPath = path.resolve(path.dirname(resolvedTarget), tSpec.text)
										const tBackResolved = tBackPath.endsWith(".ts") ? tBackPath : `${tBackPath}.ts`
										const currentResolved = filePath.endsWith(".ts") ? filePath : `${filePath}.ts`

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
	 * Helper for deep layering validation (extracted for public findCrossLayerViolations).
	 */
	private validateLayering(sourceFile: ts.SourceFile, filePath: string, currentLayer: Layer, violations: string[]) {
		ts.forEachChild(sourceFile, (node) => {
			if (ts.isImportDeclaration(node)) {
				const moduleSpecifier = node.moduleSpecifier
				if (ts.isStringLiteral(moduleSpecifier)) {
					const moduleName = moduleSpecifier.text
					let targetPath = moduleName
					if (moduleName.startsWith(".")) {
						targetPath = path.resolve(path.dirname(filePath), moduleName)
					} else {
						targetPath = this.resolveAlias(moduleName)
					}
					const targetLayer = getLayer(targetPath)

					if (currentLayer === "domain") {
						if (targetLayer === "infrastructure" || targetLayer === "ui") {
							violations.push(`Domain layer cannot import from ${targetLayer}: '${moduleName}'.`)
						}
						if (["fs", "path", "os", "crypto", "http", "https", "child_process", "url", "net"].includes(moduleName)) {
							violations.push(`Domain layer must not use platform module '${moduleName}'.`)
						}
					}
					if (currentLayer === "plumbing" && ["domain", "core", "infrastructure", "ui"].includes(targetLayer)) {
						violations.push(`Plumbing cannot depend on ${targetLayer} layer: '${moduleName}'.`)
					}
				}
			}
		})
	}

	/**
	 * Resolves project-specific path aliases to absolute paths.
	 */
	private resolveAlias(moduleName: string): string {
		// Standard project aliases from tsconfig.json
		const aliases: Record<string, string> = {
			"@/": "src/",
			"@api/": "src/core/api/",
			"@core/": "src/core/",
			"@generated/": "src/generated/",
			"@hosts/": "src/hosts/",
			"@integrations/": "src/integrations/",
			"@packages/": "src/packages/",
			"@services/": "src/services/",
			"@shared/": "src/shared/",
			"@utils/": "src/utils/",
		}

		for (const [alias, replacement] of Object.entries(aliases)) {
			if (moduleName.startsWith(alias)) {
				// We return a path that getLayer can understand (starts with src/)
				return path.join(replacement, moduleName.substring(alias.length))
			}
		}

		// Handle direct @ prefix if not in aliases
		if (moduleName.startsWith("@") && !moduleName.includes("/")) {
			return `src/${moduleName.substring(1)}`
		}

		return moduleName
	}

	/**
	 * Creates a TypeScript Transformer factory for Joy-Zoning.
	 * Can be used in a real 'tsc' plugin or build pipeline.
	 */
	public createTransformer(): ts.TransformerFactory<ts.SourceFile> {
		return (_context: ts.TransformationContext) => {
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
