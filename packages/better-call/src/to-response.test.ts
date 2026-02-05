import { describe, expect, it } from "vitest";
import { toResponse } from "./to-response";
import { APIError } from "./error";

describe("toResponse", () => {
	describe("basic types", async () => {
		it("should handle string data", async () => {
			const response = toResponse("hello world");
			expect(response.headers.get("Content-Type")).toBe("text/plain");
			await expect(response.text()).resolves.toBe("hello world");
		});

		it("should handle binary data", async () => {
			const buffer = new Uint8Array([1, 2, 3]).buffer;
			const response = toResponse(buffer);
			expect(response.headers.get("Content-Type")).toBe(
				"application/octet-stream",
			);
			await expect(response.arrayBuffer()).resolves.toEqual(buffer);
		});

		it("should handle Blob data", async () => {
			const blob = new Blob(["test"], { type: "text/custom" });
			const response = toResponse(blob);
			expect(response.headers.get("Content-Type")).toBe("text/custom");
		});
		it("should handle URLSearchParams", async () => {
			const params = new URLSearchParams("test=value");
			const response = toResponse(params);
			expect(response.headers.get("Content-Type")).toBe(
				"application/x-www-form-urlencoded",
			);
			await expect(response.text()).resolves.toBe("test=value");
		});
		it("should handle ReadableStream", async () => {
			const stream = new ReadableStream();
			const response = toResponse(stream);
			expect(response.headers.get("Content-Type")).toBe(
				"application/octet-stream",
			);
			expect(response.body).toBe(stream);
		});
	});
	describe("JSON handling", () => {
		it("should handle regular JSON objects", async () => {
			const data = { test: "value", num: 123 };
			const response = toResponse(data);
			expect(response.headers.get("Content-Type")).toBe("application/json");
			await expect(response.text()).resolves.toBe(JSON.stringify(data));
		});

		it("should handle objects with toJSON method", async () => {
			const data = {
				value: 123,
				toJSON() {
					return { serialized: this.value };
				},
			};
			const response = toResponse(data);
			expect(response.headers.get("Content-Type")).toBe("application/json");
			await expect(response.text()).resolves.toBe(
				JSON.stringify({ serialized: 123 }),
			);
		});

		it("should handle bigint values", async () => {
			const data = { id: BigInt(9007199254740991) };
			const response = toResponse(data);
			expect(response.headers.get("Content-Type")).toBe("application/json");
			await expect(response.text()).resolves.toBe('{"id":"9007199254740991"}');
		});

		it("should handle circular references", async () => {
			interface CircularObj {
				self?: CircularObj;
			}
			const circular: CircularObj = {};
			circular.self = circular;

			const response = toResponse(circular);
			expect(response.headers.get("Content-Type")).toBe("application/json");
			await expect(response.text()).resolves.toBe(
				'{"self":"[Circular ref-0]"}',
			);
		});

		it("should handle nested bigints inside circular references", async () => {
			interface CircularObj {
				id: bigint;
				self?: CircularObj;
			}
			const obj = {
				circular: {
					id: BigInt(123),
				} as CircularObj,
			};
			obj.circular.self = obj.circular;

			const response = toResponse(obj);
			await expect(response.text()).resolves.toBe(
				'{"circular":{"id":"123","self":"[Circular ref-1]"}}',
			);
		});

		it("should handle arrays with circular refs and bigints", async () => {
			const arr: (bigint | any[])[] = [BigInt(123)];
			arr.push(arr);

			const response = toResponse(arr);
			await expect(response.text()).resolves.toBe('["123","[Circular ref-0]"]');
		});
	});

	describe("Error handling", () => {
		it("should handle APIError", async () => {
			const error = new APIError("NOT_FOUND", {
				message: "Resource not found",
			});
			const response = toResponse(error);
			expect(response.status).toBe(404);
			expect(response.statusText).toBe("NOT_FOUND");
			await expect(response.text()).resolves.toContain("Resource not found");
		});

		it("should handle APIError with custom headers", () => {
			const error = new APIError("BAD_REQUEST", undefined, {
				"X-Error": "test",
			});
			const response = toResponse(error);
			expect(response.headers.get("X-Error")).toBe("test");
		});
	});

	describe("Special flag handling", () => {
		it("should handle _flag=json with Response", () => {
			const flaggedData = {
				_flag: "json",
				body: { test: "value" },
				routerResponse: new Response("test"),
				headers: { "X-Test": "value" },
				status: 201,
			};
			const response = toResponse(flaggedData);
			expect(response instanceof Response).toBe(true);
			expect(response).toBe(flaggedData.routerResponse);
		});

		it("should handle _flag=json without Response", async () => {
			const flaggedData = {
				_flag: "json",
				body: { test: "value" },
				headers: { "X-Test": "value" },
				status: 201,
			};
			const response = toResponse(flaggedData);
			expect(response instanceof Response).toBe(true);
			expect(response.status).toBe(201);
			expect(response.headers.get("X-Test")).toBe("value");
			await expect(response.text()).resolves.toBe(
				JSON.stringify({ test: "value" }),
			);
		});
	});

	describe("BigInt handling", () => {
		it("should handle simple bigint values", async () => {
			const data = { id: BigInt(9007199254740991) };
			const response = toResponse(data);
			const body = await response.text();
			const parsed = JSON.parse(body);
			expect(parsed).toEqual({ id: "9007199254740991" });
		});

		it("should handle array of bigints", async () => {
			const data = { ids: [BigInt(1), BigInt(2), BigInt(3)] };
			const response = toResponse(data);
			const body = await response.text();
			const parsed = JSON.parse(body);
			expect(parsed).toEqual({ ids: ["1", "2", "3"] });
		});

		it("should handle deeply nested bigints", async () => {
			const data = {
				user: {
					transactions: [
						{ id: BigInt(1), amount: BigInt(1000) },
						{ id: BigInt(2), amount: BigInt(2000) },
					],
				},
			};
			const response = toResponse(data);
			const body = await response.text();
			const parsed = JSON.parse(body);
			expect(parsed).toEqual({
				user: {
					transactions: [
						{ id: "1", amount: "1000" },
						{ id: "2", amount: "2000" },
					],
				},
			});
		});

		it("should handle bigint in Map keys and values", async () => {
			const map = new Map([
				[BigInt(1), "first"],
				[BigInt(2), "second"],
			]);
			const data = { map: Object.fromEntries(map) };
			const response = toResponse(data);
			const body = await response.text();
			const parsed = JSON.parse(body);
			expect(parsed).toEqual({
				map: { "1": "first", "2": "second" },
			});
		});

		it("should handle MAX_SAFE_INTEGER + 1 as bigint", async () => {
			const maxSafeInt = BigInt(Number.MAX_SAFE_INTEGER);
			const data = {
				max: maxSafeInt,
				maxPlusOne: maxSafeInt + BigInt(1),
			};
			const response = toResponse(data);
			const body = await response.text();
			const parsed = JSON.parse(body);
			expect(parsed).toEqual({
				max: "9007199254740991",
				maxPlusOne: "9007199254740992",
			});
		});
	});

	describe("Circular reference handling", () => {
		it("should handle direct self-reference", async () => {
			interface CircularObj {
				self?: CircularObj;
			}
			const obj: CircularObj = {};
			obj.self = obj;
			const response = toResponse(obj);
			const body = await response.text();
			const parsed = JSON.parse(body);
			expect(parsed).toEqual({
				self: "[Circular ref-0]",
			});
		});

		it("should handle multiple circular references to same object", async () => {
			interface CircularObj {
				ref1?: CircularObj;
				ref2?: CircularObj;
			}
			const shared: CircularObj = {};
			const obj = {
				first: shared,
				second: shared,
			};
			shared.ref1 = shared;
			const response = toResponse(obj);
			const body = await response.text();
			const parsed = JSON.parse(body);
			expect(parsed).toEqual({
				first: {
					ref1: "[Circular ref-1]",
				},
				second: "[Circular ref-1]",
			});
		});

		it("should handle deep circular references", async () => {
			interface DeepObj {
				next?: DeepObj;
				value: number;
			}
			const obj1: DeepObj = { value: 1 };
			const obj2: DeepObj = { value: 2 };
			const obj3: DeepObj = { value: 3 };
			obj1.next = obj2;
			obj2.next = obj3;
			obj3.next = obj1; // Creates a cycle

			const response = toResponse(obj1);
			const body = await response.text();
			const parsed = JSON.parse(body);
			expect(parsed).toEqual({
				value: 1,
				next: {
					value: 2,
					next: {
						value: 3,
						next: "[Circular ref-0]",
					},
				},
			});
		});

		it("should handle circular references in arrays", async () => {
			const arr: any[] = [1, 2, 3];
			arr.push(arr); // Self-reference
			const obj = { data: arr };

			const response = toResponse(obj);
			const body = await response.text();
			const parsed = JSON.parse(body);
			expect(parsed).toEqual({
				data: [1, 2, 3, "[Circular ref-1]"],
			});
		});

		it("should handle circular references in nested arrays", async () => {
			const inner: any[] = [1, 2];
			const outer = [3, inner];
			inner.push(outer); // Creates a cycle

			const response = toResponse(outer);
			const body = await response.text();
			const parsed = JSON.parse(body);
			expect(parsed).toEqual([3, [1, 2, "[Circular ref-0]"]]);
		});
	});

	describe("Combined BigInt and circular reference handling", () => {
		it("should handle bigints in circular structures", async () => {
			interface CircularWithBigInt {
				id: bigint;
				ref?: CircularWithBigInt;
				children: CircularWithBigInt[];
			}

			const parent: CircularWithBigInt = {
				id: BigInt(1),
				children: [],
			};
			const child: CircularWithBigInt = {
				id: BigInt(2),
				ref: parent,
				children: [],
			};
			parent.children.push(child);
			parent.ref = parent;

			const response = toResponse(parent);
			const body = await response.text();
			const parsed = JSON.parse(body);
			expect(parsed).toEqual({
				id: "1",
				ref: "[Circular ref-0]",
				children: [
					{
						id: "2",
						ref: "[Circular ref-0]",
						children: [],
					},
				],
			});
		});

		it("should handle complex nested structure with bigints and circular refs", async () => {
			interface ComplexObj {
				id: bigint;
				parent?: ComplexObj;
				siblings?: ComplexObj[];
				meta: {
					created: bigint;
					refs: ComplexObj[];
				};
			}

			const obj1: ComplexObj = {
				id: BigInt(1),
				siblings: [],
				meta: {
					created: BigInt(1234567890),
					refs: [],
				},
			};
			const obj2: ComplexObj = {
				id: BigInt(2),
				parent: obj1,
				siblings: [],
				meta: {
					created: BigInt(1234567891),
					refs: [obj1],
				},
			};
			obj1.siblings?.push(obj2);
			obj1.meta.refs.push(obj1);

			const response = toResponse(obj1);
			const body = await response.text();
			const parsed = JSON.parse(body);
			expect(parsed).toEqual({
				id: "1",
				siblings: [
					{
						id: "2",
						parent: "[Circular ref-0]",
						siblings: [],
						meta: {
							created: "1234567891",
							refs: ["[Circular ref-0]"],
						},
					},
				],
				meta: {
					created: "1234567890",
					refs: ["[Circular ref-0]"],
				},
			});
		});
	});

	describe("Circular reference handling", () => {
		it("should handle ORM-like circular references", async () => {
			// Types representing common ORM entities
			interface User {
				id: string;
				name: string;
				posts?: Post[];
				profile?: Profile;
			}

			interface Post {
				id: string;
				title: string;
				author?: User;
				comments?: Comment[];
			}

			interface Comment {
				content: string;
				author?: User;
				post?: Post;
			}

			interface Profile {
				bio: string;
				user?: User;
			}

			// Create circular references
			const user: User = {
				id: "123",
				name: "John",
				posts: [],
			};

			const post: Post = {
				id: "456",
				title: "Hello",
				author: user,
				comments: [],
			};

			const comment: Comment = {
				content: "Great post!",
				author: user,
				post: post,
			};

			const profile: Profile = {
				bio: "Test bio",
				user: user,
			};

			// Set up circular references
			user.posts = [post];
			user.profile = profile;
			post.comments = [comment];

			const response = toResponse(user);
			const body = await response.text();
			const parsed = JSON.parse(body);

			// Verify circular references are handled
			expect(parsed).toEqual({
				id: "123",
				name: "John",
				posts: [
					{
						id: "456",
						title: "Hello",
						author: "[Circular ref-0]",
						comments: [
							{
								content: "Great post!",
								author: "[Circular ref-0]",
								post: "[Circular ref-2]",
							},
						],
					},
				],
				profile: {
					bio: "Test bio",
					user: "[Circular ref-0]",
				},
			});
		});

		it("should handle multiple paths to same object", async () => {
			interface User {
				id: string;
				name: string;
				friend?: User;
				friendOf?: User;
			}

			const user1: User = { id: "1", name: "Alice" };
			const user2: User = { id: "2", name: "Bob" };

			// Create circular references
			user1.friend = user2;
			user2.friendOf = user1;
			user2.friend = user1;

			const response = toResponse(user1);
			const body = await response.text();
			const parsed = JSON.parse(body);

			expect(parsed).toEqual({
				id: "1",
				name: "Alice",
				friend: {
					id: "2",
					name: "Bob",
					friendOf: "[Circular ref-0]",
					friend: "[Circular ref-0]",
				},
			});
		});
	});
});
