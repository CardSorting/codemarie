#!/usr/bin/env node

import * as fs from "fs/promises"
import * as path from "path"
import protobuf from "protobufjs"

const typeNameToFQN = new Map()

function addTypeNameToFqn(name, fqn) {
	if (typeNameToFQN.has(name) && typeNameToFQN.get(name) !== fqn) {
		throw new Error(`Proto type ${name} redefined (${fqn}).`)
	}
	typeNameToFQN.set(name, fqn)
}

// Get the fully qualified name for a proto type, e.g. getFqn('StringRequest') returns 'codemarie.StringRequest'
export function getFqn(name) {
	if (!typeNameToFQN.has(name)) {
		throw Error(`No FQN for ${name}`)
	}
	return typeNameToFQN.get(name)
}

export async function loadServicesFromProtoDescriptor() {
	const protoDir = path.resolve("proto")

	// Find all .proto files recursively in the proto directory
	const getAllProtoFiles = async (dir) => {
		const entries = await fs.readdir(dir, { withFileTypes: true })
		const files = await Promise.all(
			entries.map((entry) => {
				const res = path.resolve(dir, entry.name)
				return entry.isDirectory() ? getAllProtoFiles(res) : res
			}),
		)
		return Array.prototype.concat(...files).filter((f) => f.endsWith(".proto"))
	}

	const allFiles = await getAllProtoFiles(protoDir)
	const relativeFiles = allFiles.map((f) => path.relative(protoDir, f))

	const root = new protobuf.Root()
	root.resolvePath = (origin, target) => {
		return path.join(protoDir, target)
	}

	await root.load(relativeFiles)

	const protobusServices = {}
	const hostServices = {}

	// Helper to process a namespace
	const processNamespace = (namespaceName, targetMap, fqnPrefix, packageName) => {
		const namespace = root.lookup(namespaceName)
		if (namespace && namespace.nested) {
			for (const [name, def] of Object.entries(namespace.nested)) {
				if (def instanceof protobuf.Service) {
					// Adapt protobufjs Service to the format expected by generators
					// The old format had a 'service' property containing the RPCs
					targetMap[name] = {
						service: def.methods,
					}
				} else if (def instanceof protobuf.Type || def instanceof protobuf.Enum) {
					const fqn = `${fqnPrefix}.${name}`
					addTypeNameToFqn(name, fqn)
					if (packageName) {
						addTypeNameToFqn(`${packageName}.${name}`, fqn)
					}
				}
			}
		}
	}

	processNamespace("codemarie", protobusServices, "proto.codemarie", "codemarie")
	processNamespace("host", hostServices, "proto.host", "host")

	return { protobusServices, hostServices }
}
