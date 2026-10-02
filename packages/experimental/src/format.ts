import { checkEmail, checkUrl, type FormatCheck } from "./schema";
import { makeVar, type VarDefination } from "./var";

/** The var a format's check lives in. Any format name works: seeding
 * `format.slug` adds a check for `format: "slug"` fields. */
export const formatVarName = (format: string): string => `format.${format}`;

/**
 * The email check in force: an ordinary var defaulting to
 * {@link checkEmail}. Set it like any var - `.with`, assignment - and
 * every fn in that call tree checks against it, storage writes and event
 * payloads included. Values are still trimmed and lowercased first.
 */
export const emailFormat: VarDefination<"format.email", FormatCheck> = makeVar(
	formatVarName("email"),
	{ default: checkEmail },
);

/** The URL check in force - see {@link emailFormat}. */
export const urlFormat: VarDefination<"format.url", FormatCheck> = makeVar(
	formatVarName("url"),
	{ default: checkUrl },
);
