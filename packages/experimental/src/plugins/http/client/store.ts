export type Listener = () => void;

export type StoreSnapshot<T> = {
	data: T | null;
	error: Error | null;
	isPending: boolean;
	isRefetching: boolean;
};

export type Store<T> = {
	get: () => StoreSnapshot<T>;
	set: (partial: Partial<StoreSnapshot<T>>) => void;
	subscribe: (listener: Listener) => () => void;
	setData: (data: T | null) => void;
	setError: (error: Error | null) => void;
};

export function createStore<T>(initial?: Partial<StoreSnapshot<T>>): Store<T> {
	let snapshot: StoreSnapshot<T> = {
		data: initial?.data ?? null,
		error: initial?.error ?? null,
		isPending: initial?.isPending ?? true,
		isRefetching: initial?.isRefetching ?? false,
	};
	const listeners = new Set<Listener>();

	const emit = () => {
		for (const listener of listeners) listener();
	};

	return {
		get: () => snapshot,
		set: (partial) => {
			snapshot = { ...snapshot, ...partial };
			emit();
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		setData: (data) => {
			snapshot = {
				data,
				error: null,
				isPending: false,
				isRefetching: false,
			};
			emit();
		},
		setError: (error) => {
			snapshot = {
				...snapshot,
				error,
				isPending: false,
				isRefetching: false,
			};
			emit();
		},
	};
}
