import { describe, expect, it } from "vitest";
import { bagCovers, covers, GrantError, grant } from "./grant";
import { v } from "./index";

describe("covers", () => {
	it("matches exact names", () => {
		expect(covers("admin.createUser", "admin.createUser")).toBe(true);
		expect(covers("admin.createUser", "admin.deleteUser")).toBe(false);
	});

	it("matches * globally", () => {
		expect(covers("*", "admin.createUser")).toBe(true);
		expect(covers("*", "anything")).toBe(true);
	});

	it("matches prefix.* wildcards", () => {
		expect(covers("admin.*", "admin.createUser")).toBe(true);
		expect(covers("admin.*", "admin")).toBe(true);
		expect(covers("admin.*", "admin.users.create")).toBe(true);
		expect(covers("admin.*", "other.createUser")).toBe(false);
	});

	it("bagCovers any matching pattern", () => {
		expect(bagCovers(["other", "admin.*"], "admin.createUser")).toBe(true);
		expect(bagCovers(["other"], "admin.createUser")).toBe(false);
	});
});

describe("grant / gate", () => {
	it("denies when grant returns null", () => {
		const app = v.fn({ use: [grant()] });
		const g = app.grant({ name: "admin.createUser" }, () => null);
		const fn = app.fn("create", { gate: [g] }, () => "ok");
		expect(() => fn()).toThrow(GrantError);
	});

	it("denies when grant returns []", () => {
		const app = v.fn({ use: [grant()] });
		const g = app.grant({ name: "admin.createUser" }, () => []);
		const fn = app.fn("create", { gate: [g] }, () => "ok");
		expect(() => fn()).toThrow(/grant "admin.createUser" denied/);
	});

	it("denies when return omits own name", () => {
		const app = v.fn({ use: [grant()] });
		const g = app.grant({ name: "admin.createUser" }, () => ["other"]);
		const fn = app.fn("create", { gate: [g] }, () => "ok");
		expect(() => fn()).toThrow(GrantError);
	});

	it("passes when return includes own name", async () => {
		const app = v.fn({ use: [grant()] });
		const g = app.grant({ name: "admin.createUser" }, () => [
			"admin.createUser",
		]);
		const fn = app.fn("create", { gate: [g] }, () => "ok");
		expect(await fn()).toBe("ok");
	});

	it("passes when return includes *", async () => {
		const app = v.fn({ use: [grant()] });
		const g = app.grant({ name: "admin.createUser" }, () => ["*"]);
		const fn = app.fn("create", { gate: [g] }, () => "ok");
		expect(await fn()).toBe("ok");
	});

	it("admin.* covers admin.createUser", async () => {
		const app = v.fn({ use: [grant()] });
		const g = app.grant({ name: "admin.createUser" }, () => ["admin.*"]);
		const fn = app.fn("create", { gate: [g] }, () => "ok");
		expect(await fn()).toBe("ok");
	});

	it("cross-grant: earlier return satisfies later gate without its cb succeeding", async () => {
		const app = v.fn({ use: [grant()] });
		let laterRan = false;
		const first = app.grant({ name: "admin.read" }, () => [
			"admin.read",
			"admin.write",
		]);
		const later = app.grant({ name: "admin.write" }, () => {
			laterRan = true;
			return null;
		});
		const fn = app.fn("do", { gate: [first, later] }, () => "ok");
		expect(await fn()).toBe("ok");
		expect(laterRan).toBe(false);
	});

	it("required: false soft-fails without blocking", async () => {
		const app = v.fn({ use: [grant()] });
		const soft = app.grant({ name: "optional.perm" }, () => null);
		const fn = app.fn("do", { gate: [soft({ required: false })] }, () => "ok");
		expect(await fn()).toBe("ok");
	});

	it("required: false success still propagates permissions", async () => {
		const app = v.fn({ use: [grant()] });
		const soft = app.grant({ name: "admin.read" }, () => [
			"admin.read",
			"admin.write",
		]);
		let hardRan = false;
		const hard = app.grant({ name: "admin.write" }, () => {
			hardRan = true;
			return null;
		});
		const fn = app.fn(
			"do",
			{ gate: [soft({ required: false }), hard] },
			() => "ok",
		);
		expect(await fn()).toBe("ok");
		expect(hardRan).toBe(false);
	});

	it("accumulates gates across scoped builders", async () => {
		const app = v.fn({ use: [grant()] });
		const a = app.grant({ name: "a.perm" }, () => ["a.perm"]);
		const b = app.grant({ name: "b.perm" }, () => ["b.perm"]);
		const scope = app.fn("scope.", { gate: [a] });
		const fn = scope.fn("leaf", { gate: [b] }, () => "ok");
		expect(await fn()).toBe("ok");
	});

	it("scoped accumulation denies if a parent gate fails", () => {
		const app = v.fn({ use: [grant()] });
		const a = app.grant({ name: "a.perm" }, () => null);
		const b = app.grant({ name: "b.perm" }, () => ["b.perm"]);
		const scope = app.fn("scope.", { gate: [a] });
		const fn = scope.fn("leaf", { gate: [b] }, () => "ok");
		expect(() => fn()).toThrow(/grant "a.perm" denied/);
	});

	it("default seeds the bag so matching gates skip", async () => {
		const app = v.fn({
			use: [grant({ default: () => ["admin.*"] })],
		});
		let ran = false;
		const g = app.grant({ name: "admin.createUser" }, () => {
			ran = true;
			return null;
		});
		const fn = app.fn("create", { gate: [g] }, () => "ok");
		expect(await fn()).toBe("ok");
		expect(ran).toBe(false);
	});
});
