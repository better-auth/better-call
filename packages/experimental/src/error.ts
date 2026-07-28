export class ValidationError extends Error {
	constructor(
		public path: string,
		message: string,
	) {
		super(`${path}: ${message}`);
		this.name = "ValidationError";
	}
}
