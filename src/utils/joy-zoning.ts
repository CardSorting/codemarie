import * as path from "path"
import { ImportDeclaration, Project } from "ts-morph"

export type Layer = "domain" | "core" | "infrastructure" | "plumbing" | "ui"

/**
 * Resolves project-specific path aliases to absolute paths.
 */
export function resolveAlias(moduleName: string): string {
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
			return path.join(process.cwd(), replacement, moduleName.substring(alias.length))
		}
	}

	if (moduleName.startsWith("@") && !moduleName.includes("/")) {
		return path.join(process.cwd(), "src", moduleName.substring(1))
	}

	return moduleName
}

/**
 * Determines the layer of a given file path based on Joy-Zoning conventions.
 */
export function getLayer(filePath: string): Layer {
	const normalized = filePath.replace(/\\/g, "/")

	// Check for standard Joy-Zoning paths first
	if (normalized.includes("/src/domain/")) return "domain"
	if (normalized.includes("/src/infrastructure/")) return "infrastructure"
	if (normalized.includes("/src/plumbing/")) return "plumbing"
	if (normalized.includes("/src/ui/")) return "ui"
	if (normalized.includes("/src/core/")) return "core"

	// Fallback for alternate structures
	if (normalized.includes("/src/services/") || normalized.includes("/src/integrations/")) return "infrastructure"
	if (normalized.includes("/src/utils/")) return "plumbing"
	if (normalized.includes("/webview-ui/")) return "ui"

	return "infrastructure" // Default
}

/**
 * Validates architectural smells in the given content.
 * Layer-aware: strict checks apply only to domain/infrastructure.
 */
export function validateSmells(filePath: string, content: string): string[] {
	const errors: string[] = []
	const layer = getLayer(filePath)
	const fileName = path.basename(filePath)

	// Rule: Single Class per file in Domain
	if (layer === "domain") {
		const classCount = (content.match(/export\s+class\s+|class\s+/g) || []).length
		if (classCount > 1) {
			errors.push(`${fileName}: Domain layer expects one class per file — found ${classCount}.`)
		}
	}

	// Rule: Discouraged 'any' type in Domain/Infrastructure
	if (layer === "domain" || layer === "infrastructure") {
		if (content.includes(": any") || content.includes("<any>")) {
			errors.push(`${fileName}: Architectural smell — 'any' type detected in ${layer.toUpperCase()} layer.`)
		}
	}

	// Rule: Large File Smell (> 1000 lines)
	const lineCount = content.split("\n").length
	if (lineCount > 1000) {
		errors.push(`${fileName}: Large file smell (${lineCount} lines) — consider decomposing.`)
	}

	// Rule: Potential Hardcoded Secrets (Robust Regex)
	const SECRET_REGEX = /(?:sk-|api(?:[_-]?key)?|secret|password|token|auth(?:[_-]?key)?)[\s:="']+[a-zA-Z0-9\-_]{20,}/gi
	if (SECRET_REGEX.test(content)) {
		errors.push(`${fileName}: Security smell — potential hardcoded secret detected.`)
	}

	return errors
}

/**
 * Validates layering constraints using AST analysis.
 */
export function validateLayering(filePath: string, content: string): string[] {
	const errors: string[] = []
	const layer = getLayer(filePath)

	const project = new Project()
	const sourceFile = project.createSourceFile(filePath, content, { overwrite: true })

	// Validate imports
	sourceFile.getImportDeclarations().forEach((imp: ImportDeclaration) => {
		const moduleSpecifier = imp.getModuleSpecifierValue()
		let targetPath = moduleSpecifier

		if (moduleSpecifier.startsWith(".")) {
			targetPath = path.resolve(path.dirname(filePath), moduleSpecifier)
		} else if (moduleSpecifier.startsWith("@")) {
			targetPath = resolveAlias(moduleSpecifier)
		} else {
			// Node built-ins check for Domain
			if (
				layer === "domain" &&
				["fs", "path", "os", "crypto", "http", "https", "child_process", "url", "net"].includes(moduleSpecifier)
			) {
				errors.push(
					`Architectural Violation: Domain layer in ${path.basename(filePath)} cannot use platform module '${moduleSpecifier}'.`,
				)
			}
			return // Skip other non-aliased external packages for now
		}

		const importedLayer = getLayer(targetPath)

		if (layer === "domain") {
			if (importedLayer === "infrastructure" || importedLayer === "ui") {
				errors.push(`${path.basename(filePath)} (domain) cannot import from ${importedLayer}: '${moduleSpecifier}'.`)
			}
		}
		if (layer === "core") {
			if (importedLayer === "ui") {
				errors.push(`${path.basename(filePath)} (core) cannot import from UI: '${moduleSpecifier}'.`)
			}
		}
		if (layer === "infrastructure") {
			if (importedLayer === "ui") {
				errors.push(`${path.basename(filePath)} (infrastructure) cannot import from UI: '${moduleSpecifier}'.`)
			}
		}
		if (layer === "ui") {
			if (importedLayer === "infrastructure") {
				errors.push(`${path.basename(filePath)} (ui) cannot directly import infrastructure: '${moduleSpecifier}'.`)
			}
		}
		if (layer === "plumbing") {
			if (["domain", "core", "infrastructure", "ui"].includes(importedLayer)) {
				errors.push(
					`${path.basename(filePath)} (plumbing) cannot depend on ${importedLayer} layer: '${moduleSpecifier}'.`,
				)
			}
		}
	})

	// Circular Dependency Detection
	sourceFile.getImportDeclarations().forEach((imp: ImportDeclaration) => {
		const moduleSpecifier = imp.getModuleSpecifierValue()
		if (moduleSpecifier.startsWith(".")) {
			const resolvedPath = path.resolve(
				path.dirname(filePath),
				moduleSpecifier + (moduleSpecifier.endsWith(".ts") ? "" : ".ts"),
			)
			try {
				const importedFile = project.addSourceFileAtPathIfExists(resolvedPath)
				if (importedFile) {
					const isCircular = importedFile.getImportDeclarations().some((i) => {
						const spec = i.getModuleSpecifierValue()
						if (!spec.startsWith(".")) return false
						const backResolved = path.resolve(path.dirname(resolvedPath), spec + (spec.endsWith(".ts") ? "" : ".ts"))
						return backResolved === filePath
					})
					if (isCircular) {
						errors.push(
							`Architectural Violation: Circular dependency detected: ${path.basename(filePath)} ↔ ${path.basename(resolvedPath)}.`,
						)
					}
				}
			} catch {
				/* ignore */
			}
		}
	})

	return errors
}

/**
 * Full Joy-Zoning validation for a file.
 */
export function validateJoyZoning(filePath: string, content: string): { success: boolean; errors: string[] } {
	const smellErrors = validateSmells(filePath, content)
	const layeringErrors = validateLayering(filePath, content)
	const allErrors = [...smellErrors, ...layeringErrors]

	return {
		success: allErrors.length === 0,
		errors: allErrors,
	}
}

/**
 * Analyzes code content and suggests which architectural layer best fits.
 * Returns the suggested layer and the reasoning behind the suggestion.
 */
export function suggestLayerForContent(content: string): { layer: Layer; reason: string } | null {
	// Check for UI patterns
	if (/import\s+.*from\s+["']react/i.test(content) || /jsx|tsx|component|render/i.test(content)) {
		return { layer: "ui", reason: "Contains React/JSX patterns — belongs in the UI layer." }
	}

	// Check for I/O / adapter patterns
	if (/import\s+.*from\s+["'](?:fs|http|https|net|child_process|pg|mysql|redis|axios)/i.test(content)) {
		return { layer: "infrastructure", reason: "Contains I/O or external service imports — belongs in Infrastructure." }
	}

	// Check for pure utility patterns (no class, stateless exports)
	if (
		!/class\s+/.test(content) &&
		/export\s+(?:function|const)\s+/.test(content) &&
		!/import\s+.*from\s+["']@(?:core|infrastructure|services)/.test(content)
	) {
		return { layer: "plumbing", reason: "Stateless utility functions with no layer dependencies — fits Plumbing." }
	}

	return null // can't confidently suggest
}

/**
 * Extracts a target file path from various common tool parameter names.
 */
export function getTargetPath(params: any): string | null {
	if (!params) return null
	const rawPath = params.path || params.file_path || params.target_file || params.absolutePath
	if (typeof rawPath !== "string") return null
	return rawPath
}
