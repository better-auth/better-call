import { describe, expect, it } from "vitest";
import {
	memoryAdapter,
	type StorageAdapter,
	TransactionClosedError,
	UniqueConstraintError,
	v,
} from "./index";
import { db, schema } from "./plugins/db";

const item = schema("tx_item", {
	id: db.id(v.string()),
	tag: db.unique(v.string()),
});

const make = (adapter: StorageAdapter = memoryAdapter()) =>
	v.storage(adapter, { item });

describe("$transaction", () => {
	it("commits on success", async () => {
		const store = make();
		const out = await store.$transaction(async (tx) => {
			await tx.item.create({ tag: "a" });
			await tx.item.create({ tag: "b" });
			return "done";
		});
		expect(out).toBe("done");
		expect(await store.item.count()).toBe(2);
	});

	it("rolls back creates, updates and deletes on throw", async () => {
		const store = make();
		await store.item.create({ tag: "keep" });
		await store.item.create({ tag: "edit" });
		await expect(
			store.$transaction(async (tx) => {
				await tx.item.create({ tag: "doomed" });
				await tx.item.update({ tag: "edit" }, { tag: "edited" });
				await tx.item.delete({ tag: "keep" });
				await tx.item.consumeOne({ tag: "edited" });
				throw new Error("abort");
			}),
		).rejects.toThrow("abort");
		expect((await store.item.findMany()).map((row) => row.tag).sort()).toEqual([
			"edit",
			"keep",
		]);
	});

	it("isolates uncommitted writes and preserves concurrent ones", async () => {
		const store = make();
		await store.item.create({ tag: "base" });
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let entered!: () => void;
		const inside = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const running = store.$transaction(async (tx) => {
			await tx.item.create({ tag: "tx" });
			await tx.item.update({ tag: "base" }, { tag: "base2" });
			entered();
			await gate;
			throw new Error("rollback");
		});
		await inside;
		// Written through the live adapter while the block is paused: the
		// block's work is invisible out here...
		expect(await store.item.findOne({ tag: "tx" })).toBeNull();
		await memoryWrite(store, "concurrent");
		release();
		await expect(running).rejects.toThrow("rollback");
		// ...and the rollback keeps the concurrent write.
		expect((await store.item.findMany()).map((row) => row.tag).sort()).toEqual([
			"base",
			"concurrent",
		]);

		// A commit replays only the block's own changes.
		let go!: () => void;
		const wait = new Promise<void>((resolve) => {
			go = resolve;
		});
		const committing = store.$transaction(async (tx) => {
			await tx.item.update({ tag: "base" }, { tag: "base3" });
			await wait;
		});
		await store.item.update({ tag: "concurrent" }, { tag: "concurrent2" });
		go();
		await committing;
		expect((await store.item.findMany()).map((row) => row.tag).sort()).toEqual([
			"base3",
			"concurrent2",
		]);
	});

	it("unique checks inside a transaction see the transaction's rows", async () => {
		const store = make();
		await expect(
			store.$transaction(async (tx) => {
				await tx.item.create({ tag: "x" });
				await tx.item.create({ tag: "x" });
			}),
		).rejects.toMatchObject({ name: "UniqueConstraintError" });
		expect(await store.item.count()).toBe(0);
	});

	it("a commit that would clash with a concurrent write rolls back", async () => {
		const store = make();
		await store.item.create({ tag: "free" });
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let entered!: () => void;
		const inside = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const running = store.$transaction(async (tx) => {
			await tx.item.create({ tag: "taken" });
			await tx.item.update({ tag: "free" }, { tag: "renamed" });
			await tx.item.create({ tag: "other" });
			entered();
			await gate;
		});
		await inside;
		// Both unique values are free on the live table while the block
		// is paused, so these land.
		await store.item.create({ tag: "taken" });
		await store.item.create({ tag: "renamed" });
		release();
		await expect(running).rejects.toBeInstanceOf(UniqueConstraintError);
		// Nothing of the block applied - no duplicates, no partial commit.
		expect((await store.item.findMany()).map((row) => row.tag).sort()).toEqual([
			"free",
			"renamed",
			"taken",
		]);

		// The clash can also come from the block's UPDATE alone.
		let go!: () => void;
		const wait = new Promise<void>((resolve) => {
			go = resolve;
		});
		let paused!: () => void;
		const atGate = new Promise<void>((resolve) => {
			paused = resolve;
		});
		const updating = store.$transaction(async (tx) => {
			await tx.item.update({ tag: "free" }, { tag: "late" });
			paused();
			await wait;
		});
		await atGate;
		await store.item.create({ tag: "late" });
		go();
		await expect(updating).rejects.toMatchObject({ fields: ["tag"] });
		expect(await store.item.findOne({ tag: "free" })).not.toBeNull();
		expect(await store.item.count({ tag: "late" })).toBe(1);
	});

	it("the commit check uses the same equality as ordinary writes", async () => {
		const loose = schema("tx_loose", {
			id: db.id(v.string()),
			key: db.unique(v.any()),
		});
		// What ordinary writes accept: bigints, and values that are
		// distinct under `===` even when they serialize alike.
		const accepted = () => [
			1n,
			{ a: 1 },
			{ a: 1 },
			Number.NaN,
			Number.NaN,
			Number.POSITIVE_INFINITY,
		];
		const plain = v.storage(memoryAdapter(), { loose });
		for (const key of accepted()) await plain.loose.create({ key });
		expect(await plain.loose.count()).toBe(6);
		const store = v.storage(memoryAdapter(), { loose });
		await store.$transaction(async (tx) => {
			for (const key of accepted()) await tx.loose.create({ key });
		});
		expect(await store.loose.count()).toBe(6);

		// What ordinary writes reject, the commit rejects: an equal bigint,
		// or the very same object, written outside while the block ran.
		const shared = { b: 1 };
		for (const [inBlock, outside] of [
			[2n, 2n],
			[shared, shared],
		] as const) {
			let release!: () => void;
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			let entered!: () => void;
			const inside = new Promise<void>((resolve) => {
				entered = resolve;
			});
			const running = store.$transaction(async (tx) => {
				await tx.loose.create({ key: inBlock });
				entered();
				await gate;
			});
			await inside;
			await store.loose.create({ key: outside });
			release();
			await expect(running).rejects.toBeInstanceOf(UniqueConstraintError);
		}
		expect(await store.loose.count()).toBe(8);
	});

	it("a finished transaction's view refuses further use", async () => {
		const store = make();
		let kept!: typeof store;
		await store.$transaction(async (tx) => {
			kept = tx;
			expect(tx.$inTransaction()).toBe(true);
			await tx.item.create({ tag: "in" });
		});
		expect(kept.$inTransaction()).toBe(false);
		await expect(kept.item.create({ tag: "after" })).rejects.toBeInstanceOf(
			TransactionClosedError,
		);
		await expect(kept.item.findMany()).rejects.toBeInstanceOf(
			TransactionClosedError,
		);
		await expect(kept.$afterCommit(() => {})).rejects.toBeInstanceOf(
			TransactionClosedError,
		);
		await expect(kept.$transaction(async () => {})).rejects.toBeInstanceOf(
			TransactionClosedError,
		);
		// Nothing was lost to a dead clone: only the committed row exists.
		expect((await store.item.findMany()).map((row) => row.tag)).toEqual(["in"]);

		// Same after a rollback.
		let rolled!: typeof store;
		await expect(
			store.$transaction(async (tx) => {
				rolled = tx;
				throw new Error("undo");
			}),
		).rejects.toThrow("undo");
		await expect(rolled.item.count()).rejects.toBeInstanceOf(
			TransactionClosedError,
		);
	});

	it("a task that outlives its block writes to the live adapter", async () => {
		const store = make();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let late!: Promise<unknown>;
		await store.$transaction(async (tx) => {
			await tx.item.create({ tag: "in" });
			// Fire-and-forget: carries the block's ambient context, but runs
			// its write after the commit.
			late = (async () => {
				await gate;
				expect(store.$inTransaction()).toBe(false);
				return store.item.create({ tag: "late" });
			})();
		});
		release();
		await late;
		expect((await store.item.findMany()).map((row) => row.tag).sort()).toEqual([
			"in",
			"late",
		]);
	});

	it("ops on the OUTER storage inside the block join the transaction", async () => {
		const store = make();
		await expect(
			store.$transaction(async () => {
				// Code that only holds `store` (a hook, a helper) still writes
				// through the transaction - Better Auth's getCurrentAdapter.
				await store.item.create({ tag: "ambient" });
				expect(store.$inTransaction()).toBe(true);
				expect(await store.item.count()).toBe(1);
				throw new Error("undo");
			}),
		).rejects.toThrow("undo");
		expect(await store.item.count()).toBe(0);
		expect(store.$inTransaction()).toBe(false);

		// Hooks run inside too, and their own ops ride the transaction.
		const audit = schema("tx_audit", {
			id: db.id(v.string()),
			note: v.string(),
		});
		const wide = store.$extend({ audit });
		wide.$on("item.create", async (_c, next) => {
			const out = await next();
			await wide.audit.create({ note: "created" });
			return out;
		});
		await expect(
			wide.$transaction(async (tx) => {
				await tx.item.create({ tag: "hooked" });
				throw new Error("undo");
			}),
		).rejects.toThrow("undo");
		expect(await wide.audit.count()).toBe(0);
	});

	it("nested transactions join the outermost one", async () => {
		const calls: string[] = [];
		const base = memoryAdapter();
		const adapter: StorageAdapter = {
			...base,
			transaction: (run) => {
				calls.push("begin");
				return base.transaction?.(run) as never;
			},
		};
		const store = make(adapter);
		await expect(
			store.$transaction(async (tx) => {
				await tx.item.create({ tag: "outer" });
				await tx.$transaction(async (inner) => {
					await inner.item.create({ tag: "inner" });
				});
				// Nested through the outer handle as well.
				await store.$transaction(async (again) => {
					await again.item.create({ tag: "again" });
				});
				expect(await tx.item.count()).toBe(3);
				throw new Error("outer fails");
			}),
		).rejects.toThrow("outer fails");
		expect(calls).toEqual(["begin"]);
		// Inner blocks don't commit on their own.
		expect(await store.item.count()).toBe(0);

		// An inner throw caught by the outer block does not undo inner
		// writes - no savepoints, as in Better Auth.
		await store.$transaction(async (tx) => {
			await tx
				.$transaction(async (inner) => {
					await inner.item.create({ tag: "survives" });
					throw new Error("inner");
				})
				.catch(() => {});
		});
		expect(await store.item.findOne({ tag: "survives" })).not.toBeNull();
	});

	it("$afterCommit waits for the outermost commit and is dropped on rollback", async () => {
		const store = make();
		const log: string[] = [];
		await store.$transaction(async (tx) => {
			await tx.$afterCommit(() => {
				log.push("first");
			});
			await tx.$transaction(async (inner) => {
				await inner.$afterCommit(async () => {
					log.push("nested");
				});
			});
			// Queued through the outer handle (ambient).
			await store.$afterCommit(() => {
				log.push("ambient");
			});
			await tx.item.create({ tag: "t" });
			log.push("body done");
		});
		expect(log).toEqual(["body done", "first", "nested", "ambient"]);

		log.length = 0;
		await expect(
			store.$transaction(async (tx) => {
				await tx.$afterCommit(() => {
					log.push("never");
				});
				throw new Error("rollback");
			}),
		).rejects.toThrow("rollback");
		expect(log).toEqual([]);

		// Outside a transaction it runs right away.
		await store.$afterCommit(() => {
			log.push("now");
		});
		expect(log).toEqual(["now"]);
	});

	it("after-commit work runs outside the transaction and reports failures", async () => {
		const store = make();
		let committedCount = -1;
		await store.$transaction(async (tx) => {
			await tx.item.create({ tag: "c" });
			await tx.$afterCommit(async () => {
				// Committed data is visible; new ops hit the live adapter.
				committedCount = await store.item.count();
				expect(store.$inTransaction()).toBe(false);
			});
		});
		expect(committedCount).toBe(1);

		// Without a handler the first failure rejects - after the commit.
		await expect(
			store.$transaction(async (tx) => {
				await tx.item.create({ tag: "d" });
				await tx.$afterCommit(() => {
					throw new Error("hook failed");
				});
			}),
		).rejects.toThrow("hook failed");
		expect(await store.item.findOne({ tag: "d" })).not.toBeNull();

		// With a handler every hook still runs.
		const errors: unknown[] = [];
		const ran: string[] = [];
		await store.$transaction(
			async (tx) => {
				await tx.$afterCommit(() => {
					throw new Error("one");
				});
				await tx.$afterCommit(() => {
					ran.push("two");
				});
			},
			{ onAfterCommitError: (error) => void errors.push(error) },
		);
		expect((errors[0] as Error).message).toBe("one");
		expect(ran).toEqual(["two"]);

		// Per-hook onError swallows its own failure.
		const handled: unknown[] = [];
		await store.$transaction(async (tx) => {
			await tx.$afterCommit(
				() => {
					throw new Error("mine");
				},
				{ onError: (error) => void handled.push(error) },
			);
		});
		expect(handled).toHaveLength(1);
	});

	it("an adapter without transaction runs as-is but still defers after-commit", async () => {
		const { transaction, ...bare } = memoryAdapter();
		const store = make(bare);
		const log: string[] = [];
		const out = await store.$transaction(async (tx) => {
			await tx.item.create({ tag: "plain" });
			await tx.$afterCommit(() => {
				log.push("after");
			});
			log.push("body");
			return 1;
		});
		expect(out).toBe(1);
		expect(log).toEqual(["body", "after"]);
		expect(await store.item.count()).toBe(1);

		// No rollback without a transaction - but queued work is dropped.
		log.length = 0;
		await expect(
			store.$transaction(async (tx) => {
				await tx.item.create({ tag: "stays" });
				await tx.$afterCommit(() => {
					log.push("never");
				});
				throw new Error("x");
			}),
		).rejects.toThrow("x");
		expect(await store.item.findOne({ tag: "stays" })).not.toBeNull();
		expect(log).toEqual([]);
	});

	it("separate storages keep separate transactions", async () => {
		const a = make();
		const b = make();
		await expect(
			a.$transaction(async () => {
				await b.item.create({ tag: "b-live" });
				expect(b.$inTransaction()).toBe(false);
				throw new Error("a fails");
			}),
		).rejects.toThrow("a fails");
		expect(await b.item.count()).toBe(1);
	});
});

/** A write straight through the storage, outside any transaction. */
const memoryWrite = (store: ReturnType<typeof make>, tag: string) =>
	store.item.create({ tag });
