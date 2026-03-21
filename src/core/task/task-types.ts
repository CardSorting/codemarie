/**
 * Shared types for task management.
 * Extracted to a separate file to break circular dependencies between
 * Task, ToolExecutor, and ToolHandlers.
 */
import { CodemarieToolResponseContent } from "@/shared/messages"

export type ToolResponse = CodemarieToolResponseContent
