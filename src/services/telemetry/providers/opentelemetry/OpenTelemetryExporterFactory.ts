import { OTLPLogExporter as OTLPLogExporterHTTP } from "@opentelemetry/exporter-logs-otlp-http"
import { OTLPLogExporter as OTLPLogExporterProto } from "@opentelemetry/exporter-logs-otlp-proto"
import { OTLPMetricExporter as OTLPMetricExporterHTTP } from "@opentelemetry/exporter-metrics-otlp-http"
import { OTLPMetricExporter as OTLPMetricExporterProto } from "@opentelemetry/exporter-metrics-otlp-proto"
import { ConsoleLogRecordExporter, LogRecordExporter } from "@opentelemetry/sdk-logs"
import { ConsoleMetricExporter, MetricReader, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics"
import { Logger } from "@/shared/services/Logger"
import { wrapLogsExporterWithDiagnostics, wrapMetricsExporterWithDiagnostics } from "./otel-exporter-diagnostics"

/**
 * Check if debug diagnostics are enabled
 */
function isDebugEnabled(): boolean {
	return process.env.TEL_DEBUG_DIAGNOSTICS === "true" || process.env.IS_DEV === "true"
}

/**
 * Create a console log exporter
 */
export function createConsoleLogExporter(): ConsoleLogRecordExporter {
	return new ConsoleLogRecordExporter()
}

export function ensurePathSuffix(url: URL, suffix: string): void {
	const pathname = url.pathname
	const normalizedPathname = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname
	url.pathname = normalizedPathname
	if (!normalizedPathname.endsWith(suffix)) {
		url.pathname = `${normalizedPathname}${suffix}`
	}
}

/**
 * Create an OTLP log exporter based on protocol
 */
export function createOTLPLogExporter(
	protocol: string,
	endpoint: string,
	_insecure: boolean,
	headers?: Record<string, string>,
): LogRecordExporter | null {
	try {
		let exporter: any = null
		const logsUrl = new URL(endpoint)
		ensurePathSuffix(logsUrl, "/v1/logs")

		switch (protocol) {
			case "http/json": {
				exporter = new OTLPLogExporterHTTP({ url: logsUrl.toString(), headers })
				break
			}
			case "http/protobuf": {
				exporter = new OTLPLogExporterProto({ url: logsUrl.toString(), headers })
				break
			}
			default:
				Logger.warn(`[OTEL] Unknown or unsupported OTLP protocol for logs: ${protocol}. Protobus is no longer supported.`)
				return null
		}

		// Wrap with diagnostics if debug is enabled
		if (isDebugEnabled()) {
			wrapLogsExporterWithDiagnostics(exporter, protocol, logsUrl.toString())
		}

		return exporter
	} catch (error) {
		Logger.error("[OTEL] Error creating OTLP log exporter:", error)
		return null
	}
}

/**
 * Create a console metric reader with exporter
 */
export function createConsoleMetricReader(intervalMs: number, timeoutMs: number): MetricReader {
	const exporter = new ConsoleMetricExporter()
	return new PeriodicExportingMetricReader({
		exporter,
		exportIntervalMillis: intervalMs,
		exportTimeoutMillis: timeoutMs,
	})
}

/**
 * Create an OTLP metric reader with exporter based on protocol
 */
export function createOTLPMetricReader(
	protocol: string,
	endpoint: string,
	_insecure: boolean,
	intervalMs: number,
	timeoutMs: number,
	headers?: Record<string, string>,
): MetricReader | null {
	try {
		let exporter: any = null

		const metricsUrl = new URL(endpoint)
		ensurePathSuffix(metricsUrl, "/v1/metrics")

		switch (protocol) {
			case "http/json": {
				exporter = new OTLPMetricExporterHTTP({ url: metricsUrl.toString(), headers })
				break
			}
			case "http/protobuf": {
				exporter = new OTLPMetricExporterProto({ url: metricsUrl.toString(), headers })
				break
			}
			default:
				Logger.warn(
					`[OTEL] Unknown or unsupported OTLP protocol for metrics: ${protocol}. Protobus is no longer supported.`,
				)
				return null
		}

		// Wrap with diagnostics if debug is enabled
		if (isDebugEnabled()) {
			wrapMetricsExporterWithDiagnostics(exporter, protocol, metricsUrl.toString())
		}

		return new PeriodicExportingMetricReader({
			exporter,
			exportIntervalMillis: intervalMs,
			exportTimeoutMillis: timeoutMs,
		})
	} catch (error) {
		Logger.error("[OTEL] Error creating OTLP metric reader:", error)
		return null
	}
}
