/**
 * Request/sec benchmarks for better-call.
 *
 *   pnpm bench
 *   pnpm bench -- --mode handler --only get-hello,post-json
 *   pnpm bench -- --duration 5 --connections 100
 */
import type { BenchMode, LoadOptions, LoadResult } from "./load.ts";
import { runHandlerLoad, runHttpLoad } from "./load.ts";
import { getScenarios } from "./scenarios.ts";

type Args = LoadOptions & {
	mode: BenchMode;
	only: string[] | undefined;
	list: boolean;
	help: boolean;
};

function printHelp() {
	console.log(`Usage: pnpm bench -- [options]

Measures request/sec for important better-call configurations.

Options:
  --mode http|handler   http: Node server + toNodeHandler (default)
                        handler: in-process router.handler()
  --duration <seconds>  Measurement window (default: 3)
  --warmup <seconds>    Warmup window (default: 1)
  --connections <n>     Concurrent connections/workers (default: 50)
  --only <names>        Comma-separated scenario names
  --list                List scenarios and exit
  --help                Show this help
`);
}

function readFlag(argv: string[], name: string): string | undefined {
	const index = argv.indexOf(name);
	if (index === -1) {
		return undefined;
	}
	return argv[index + 1];
}

function parseNumber(
	value: string | undefined,
	fallback: number,
	flag: string,
) {
	if (value === undefined) {
		return fallback;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error(`${flag} must be a non-negative number`);
	}
	return parsed;
}

function parseArgs(argv: string[]): Args {
	if (argv.includes("--help") || argv.includes("-h")) {
		return {
			mode: "http",
			duration: 3,
			warmup: 1,
			connections: 50,
			only: undefined,
			list: false,
			help: true,
		};
	}
	const modeValue = readFlag(argv, "--mode") ?? "http";
	if (modeValue !== "http" && modeValue !== "handler") {
		throw new Error('--mode must be "http" or "handler"');
	}
	const onlyValue = readFlag(argv, "--only");
	return {
		mode: modeValue,
		duration: parseNumber(readFlag(argv, "--duration"), 3, "--duration"),
		warmup: parseNumber(readFlag(argv, "--warmup"), 1, "--warmup"),
		connections: parseNumber(
			readFlag(argv, "--connections"),
			50,
			"--connections",
		),
		only: onlyValue
			? onlyValue
					.split(",")
					.map((name) => name.trim())
					.filter(Boolean)
			: undefined,
		list: argv.includes("--list"),
		help: false,
	};
}

function formatNumber(value: number, digits = 0) {
	return value.toLocaleString("en-US", {
		maximumFractionDigits: digits,
		minimumFractionDigits: digits,
	});
}

function printTable(
	rows: Array<{ scenario: string; description: string; result: LoadResult }>,
) {
	const nameWidth = Math.max(12, ...rows.map((row) => row.scenario.length));
	const baseline = rows.find((row) => row.scenario === "raw-node")?.result
		.requestsPerSec;
	const vsRawHeader = baseline ? `  ${"vs raw".padStart(7)}` : "";
	const header = `${"scenario".padEnd(nameWidth)}  ${"req/sec".padStart(10)}${vsRawHeader}  ${"p50".padStart(8)}  ${"p99".padStart(8)}  ${"errors".padStart(7)}  ${"n".padStart(8)}`;
	console.log(header);
	console.log("-".repeat(header.length));
	for (const row of rows) {
		const vsRaw =
			baseline && baseline > 0
				? `  ${`${formatNumber((row.result.requestsPerSec / baseline) * 100)}%`.padStart(7)}`
				: "";
		console.log(
			`${row.scenario.padEnd(nameWidth)}  ${formatNumber(row.result.requestsPerSec).padStart(10)}${vsRaw}  ${`${formatNumber(row.result.latencyP50, 2)}ms`.padStart(8)}  ${`${formatNumber(row.result.latencyP99, 2)}ms`.padStart(8)}  ${formatNumber(row.result.errors).padStart(7)}  ${formatNumber(row.result.samples).padStart(8)}`,
		);
	}
	console.log("");
	for (const row of rows) {
		console.log(`  ${row.scenario}: ${row.description}`);
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printHelp();
		return;
	}

	const scenarios = getScenarios();
	if (args.list) {
		for (const scenario of scenarios) {
			console.log(`${scenario.name.padEnd(22)} ${scenario.description}`);
		}
		return;
	}

	const selected = (
		args.only
			? scenarios.filter((scenario) => args.only?.includes(scenario.name))
			: scenarios
	).filter((scenario) => args.mode === "http" || scenario.handler);
	if (selected.length === 0) {
		const known = scenarios.map((scenario) => scenario.name).join(", ");
		throw new Error(`No scenarios matched. Known names: ${known}`);
	}

	console.log("better-call request/sec");
	console.log(
		`mode=${args.mode} node=${process.version} ${process.platform}/${process.arch}`,
	);
	console.log(
		`connections=${args.connections} duration=${args.duration}s warmup=${args.warmup}s`,
	);
	console.log("");

	const rows: Array<{
		scenario: string;
		description: string;
		result: LoadResult;
	}> = [];
	for (const scenario of selected) {
		process.stdout.write(`running ${scenario.name}...\r`);
		const result =
			args.mode === "http"
				? await runHttpLoad(scenario, args)
				: await runHandlerLoad(scenario, args);
		rows.push({
			scenario: scenario.name,
			description: scenario.description,
			result,
		});
		process.stdout.write(" ".repeat(40) + "\r");
	}
	printTable(rows);
}

await main();
