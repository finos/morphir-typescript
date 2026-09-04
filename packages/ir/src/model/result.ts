//
// A minimal Result type. Readers return Result rather than throwing, so a
// binding can report a diagnostic with a cursor instead of a stack trace.
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
	return { ok: true, value };
}
export function err<E>(error: E): Result<never, E> {
	return { ok: false, error };
}
export function isOk<T, E>(r: Result<T, E>): r is { readonly ok: true; readonly value: T } {
	return r.ok;
}
export function map<T, U, E>(r: Result<T, E>, f: (t: T) => U): Result<U, E> {
	return r.ok ? ok(f(r.value)) : r;
}
export function all<T, E>(rs: readonly Result<T, E>[]): Result<readonly T[], E> {
	const out: T[] = [];
	for (const r of rs) {
		if (!r.ok) return r;
		out.push(r.value);
	}
	return ok(out);
}
