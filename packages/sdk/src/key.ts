// Copyright 2026 FINOS
// SPDX-License-Identifier: Apache-2.0
//
// Morphir.SDK.Key: helpers to compose composite keys. A key is a readonly
// tuple, so the SDK's structural `compare` orders it element by element and it
// works as a `Dict` or `Set` key when every element is comparable. Elm nests
// the tuples above three elements, because an Elm tuple holds at most three;
// TypeScript has no such limit, so every key here is one flat tuple. The key
// types are opaque in the Morphir IR and the flat order is the same
// lexicographic order. `Key0` is the number 0, as in Elm, because a key must be
// comparable and a unit value is not.

export type Key0 = number;
export type Key2<K1, K2> = readonly [K1, K2];
export type Key3<K1, K2, K3> = readonly [K1, K2, K3];
export type Key4<K1, K2, K3, K4> = readonly [K1, K2, K3, K4];
export type Key5<K1, K2, K3, K4, K5> = readonly [K1, K2, K3, K4, K5];
export type Key6<K1, K2, K3, K4, K5, K6> = readonly [K1, K2, K3, K4, K5, K6];
export type Key7<K1, K2, K3, K4, K5, K6, K7> = readonly [K1, K2, K3, K4, K5, K6, K7];
export type Key8<K1, K2, K3, K4, K5, K6, K7, K8> = readonly [K1, K2, K3, K4, K5, K6, K7, K8];
export type Key9<K1, K2, K3, K4, K5, K6, K7, K8, K9> = readonly [K1, K2, K3, K4, K5, K6, K7, K8, K9];
export type Key10<K1, K2, K3, K4, K5, K6, K7, K8, K9, K10> = readonly [K1, K2, K3, K4, K5, K6, K7, K8, K9, K10];
export type Key11<K1, K2, K3, K4, K5, K6, K7, K8, K9, K10, K11> = readonly [K1, K2, K3, K4, K5, K6, K7, K8, K9, K10, K11];
export type Key12<K1, K2, K3, K4, K5, K6, K7, K8, K9, K10, K11, K12> = readonly [K1, K2, K3, K4, K5, K6, K7, K8, K9, K10, K11, K12];
export type Key13<K1, K2, K3, K4, K5, K6, K7, K8, K9, K10, K11, K12, K13> = readonly [K1, K2, K3, K4, K5, K6, K7, K8, K9, K10, K11, K12, K13];
export type Key14<K1, K2, K3, K4, K5, K6, K7, K8, K9, K10, K11, K12, K13, K14> = readonly [K1, K2, K3, K4, K5, K6, K7, K8, K9, K10, K11, K12, K13, K14];
export type Key15<K1, K2, K3, K4, K5, K6, K7, K8, K9, K10, K11, K12, K13, K14, K15> = readonly [
	K1,
	K2,
	K3,
	K4,
	K5,
	K6,
	K7,
	K8,
	K9,
	K10,
	K11,
	K12,
	K13,
	K14,
	K15,
];
export type Key16<K1, K2, K3, K4, K5, K6, K7, K8, K9, K10, K11, K12, K13, K14, K15, K16> = readonly [
	K1,
	K2,
	K3,
	K4,
	K5,
	K6,
	K7,
	K8,
	K9,
	K10,
	K11,
	K12,
	K13,
	K14,
	K15,
	K16,
];

export function noKey<A>(_a: A): Key0 {
	return 0;
}

export function key0<A>(_a: A): Key0 {
	return 0;
}

export function key2<A, B1, B2>(getKey1: (a: A) => B1, getKey2: (a: A) => B2, a: A): Key2<B1, B2> {
	return [getKey1(a), getKey2(a)];
}

export function key3<A, B1, B2, B3>(getKey1: (a: A) => B1, getKey2: (a: A) => B2, getKey3: (a: A) => B3, a: A): Key3<B1, B2, B3> {
	return [getKey1(a), getKey2(a), getKey3(a)];
}

export function key4<A, B1, B2, B3, B4>(
	getKey1: (a: A) => B1,
	getKey2: (a: A) => B2,
	getKey3: (a: A) => B3,
	getKey4: (a: A) => B4,
	a: A,
): Key4<B1, B2, B3, B4> {
	return [getKey1(a), getKey2(a), getKey3(a), getKey4(a)];
}

export function key5<A, B1, B2, B3, B4, B5>(
	getKey1: (a: A) => B1,
	getKey2: (a: A) => B2,
	getKey3: (a: A) => B3,
	getKey4: (a: A) => B4,
	getKey5: (a: A) => B5,
	a: A,
): Key5<B1, B2, B3, B4, B5> {
	return [getKey1(a), getKey2(a), getKey3(a), getKey4(a), getKey5(a)];
}

export function key6<A, B1, B2, B3, B4, B5, B6>(
	getKey1: (a: A) => B1,
	getKey2: (a: A) => B2,
	getKey3: (a: A) => B3,
	getKey4: (a: A) => B4,
	getKey5: (a: A) => B5,
	getKey6: (a: A) => B6,
	a: A,
): Key6<B1, B2, B3, B4, B5, B6> {
	return [getKey1(a), getKey2(a), getKey3(a), getKey4(a), getKey5(a), getKey6(a)];
}

export function key7<A, B1, B2, B3, B4, B5, B6, B7>(
	getKey1: (a: A) => B1,
	getKey2: (a: A) => B2,
	getKey3: (a: A) => B3,
	getKey4: (a: A) => B4,
	getKey5: (a: A) => B5,
	getKey6: (a: A) => B6,
	getKey7: (a: A) => B7,
	a: A,
): Key7<B1, B2, B3, B4, B5, B6, B7> {
	return [getKey1(a), getKey2(a), getKey3(a), getKey4(a), getKey5(a), getKey6(a), getKey7(a)];
}

export function key8<A, B1, B2, B3, B4, B5, B6, B7, B8>(
	getKey1: (a: A) => B1,
	getKey2: (a: A) => B2,
	getKey3: (a: A) => B3,
	getKey4: (a: A) => B4,
	getKey5: (a: A) => B5,
	getKey6: (a: A) => B6,
	getKey7: (a: A) => B7,
	getKey8: (a: A) => B8,
	a: A,
): Key8<B1, B2, B3, B4, B5, B6, B7, B8> {
	return [getKey1(a), getKey2(a), getKey3(a), getKey4(a), getKey5(a), getKey6(a), getKey7(a), getKey8(a)];
}

export function key9<A, B1, B2, B3, B4, B5, B6, B7, B8, B9>(
	getKey1: (a: A) => B1,
	getKey2: (a: A) => B2,
	getKey3: (a: A) => B3,
	getKey4: (a: A) => B4,
	getKey5: (a: A) => B5,
	getKey6: (a: A) => B6,
	getKey7: (a: A) => B7,
	getKey8: (a: A) => B8,
	getKey9: (a: A) => B9,
	a: A,
): Key9<B1, B2, B3, B4, B5, B6, B7, B8, B9> {
	return [getKey1(a), getKey2(a), getKey3(a), getKey4(a), getKey5(a), getKey6(a), getKey7(a), getKey8(a), getKey9(a)];
}

export function key10<A, B1, B2, B3, B4, B5, B6, B7, B8, B9, B10>(
	getKey1: (a: A) => B1,
	getKey2: (a: A) => B2,
	getKey3: (a: A) => B3,
	getKey4: (a: A) => B4,
	getKey5: (a: A) => B5,
	getKey6: (a: A) => B6,
	getKey7: (a: A) => B7,
	getKey8: (a: A) => B8,
	getKey9: (a: A) => B9,
	getKey10: (a: A) => B10,
	a: A,
): Key10<B1, B2, B3, B4, B5, B6, B7, B8, B9, B10> {
	return [getKey1(a), getKey2(a), getKey3(a), getKey4(a), getKey5(a), getKey6(a), getKey7(a), getKey8(a), getKey9(a), getKey10(a)];
}

export function key11<A, B1, B2, B3, B4, B5, B6, B7, B8, B9, B10, B11>(
	getKey1: (a: A) => B1,
	getKey2: (a: A) => B2,
	getKey3: (a: A) => B3,
	getKey4: (a: A) => B4,
	getKey5: (a: A) => B5,
	getKey6: (a: A) => B6,
	getKey7: (a: A) => B7,
	getKey8: (a: A) => B8,
	getKey9: (a: A) => B9,
	getKey10: (a: A) => B10,
	getKey11: (a: A) => B11,
	a: A,
): Key11<B1, B2, B3, B4, B5, B6, B7, B8, B9, B10, B11> {
	return [getKey1(a), getKey2(a), getKey3(a), getKey4(a), getKey5(a), getKey6(a), getKey7(a), getKey8(a), getKey9(a), getKey10(a), getKey11(a)];
}

export function key12<A, B1, B2, B3, B4, B5, B6, B7, B8, B9, B10, B11, B12>(
	getKey1: (a: A) => B1,
	getKey2: (a: A) => B2,
	getKey3: (a: A) => B3,
	getKey4: (a: A) => B4,
	getKey5: (a: A) => B5,
	getKey6: (a: A) => B6,
	getKey7: (a: A) => B7,
	getKey8: (a: A) => B8,
	getKey9: (a: A) => B9,
	getKey10: (a: A) => B10,
	getKey11: (a: A) => B11,
	getKey12: (a: A) => B12,
	a: A,
): Key12<B1, B2, B3, B4, B5, B6, B7, B8, B9, B10, B11, B12> {
	return [getKey1(a), getKey2(a), getKey3(a), getKey4(a), getKey5(a), getKey6(a), getKey7(a), getKey8(a), getKey9(a), getKey10(a), getKey11(a), getKey12(a)];
}

export function key13<A, B1, B2, B3, B4, B5, B6, B7, B8, B9, B10, B11, B12, B13>(
	getKey1: (a: A) => B1,
	getKey2: (a: A) => B2,
	getKey3: (a: A) => B3,
	getKey4: (a: A) => B4,
	getKey5: (a: A) => B5,
	getKey6: (a: A) => B6,
	getKey7: (a: A) => B7,
	getKey8: (a: A) => B8,
	getKey9: (a: A) => B9,
	getKey10: (a: A) => B10,
	getKey11: (a: A) => B11,
	getKey12: (a: A) => B12,
	getKey13: (a: A) => B13,
	a: A,
): Key13<B1, B2, B3, B4, B5, B6, B7, B8, B9, B10, B11, B12, B13> {
	return [
		getKey1(a),
		getKey2(a),
		getKey3(a),
		getKey4(a),
		getKey5(a),
		getKey6(a),
		getKey7(a),
		getKey8(a),
		getKey9(a),
		getKey10(a),
		getKey11(a),
		getKey12(a),
		getKey13(a),
	];
}

export function key14<A, B1, B2, B3, B4, B5, B6, B7, B8, B9, B10, B11, B12, B13, B14>(
	getKey1: (a: A) => B1,
	getKey2: (a: A) => B2,
	getKey3: (a: A) => B3,
	getKey4: (a: A) => B4,
	getKey5: (a: A) => B5,
	getKey6: (a: A) => B6,
	getKey7: (a: A) => B7,
	getKey8: (a: A) => B8,
	getKey9: (a: A) => B9,
	getKey10: (a: A) => B10,
	getKey11: (a: A) => B11,
	getKey12: (a: A) => B12,
	getKey13: (a: A) => B13,
	getKey14: (a: A) => B14,
	a: A,
): Key14<B1, B2, B3, B4, B5, B6, B7, B8, B9, B10, B11, B12, B13, B14> {
	return [
		getKey1(a),
		getKey2(a),
		getKey3(a),
		getKey4(a),
		getKey5(a),
		getKey6(a),
		getKey7(a),
		getKey8(a),
		getKey9(a),
		getKey10(a),
		getKey11(a),
		getKey12(a),
		getKey13(a),
		getKey14(a),
	];
}

export function key15<A, B1, B2, B3, B4, B5, B6, B7, B8, B9, B10, B11, B12, B13, B14, B15>(
	getKey1: (a: A) => B1,
	getKey2: (a: A) => B2,
	getKey3: (a: A) => B3,
	getKey4: (a: A) => B4,
	getKey5: (a: A) => B5,
	getKey6: (a: A) => B6,
	getKey7: (a: A) => B7,
	getKey8: (a: A) => B8,
	getKey9: (a: A) => B9,
	getKey10: (a: A) => B10,
	getKey11: (a: A) => B11,
	getKey12: (a: A) => B12,
	getKey13: (a: A) => B13,
	getKey14: (a: A) => B14,
	getKey15: (a: A) => B15,
	a: A,
): Key15<B1, B2, B3, B4, B5, B6, B7, B8, B9, B10, B11, B12, B13, B14, B15> {
	return [
		getKey1(a),
		getKey2(a),
		getKey3(a),
		getKey4(a),
		getKey5(a),
		getKey6(a),
		getKey7(a),
		getKey8(a),
		getKey9(a),
		getKey10(a),
		getKey11(a),
		getKey12(a),
		getKey13(a),
		getKey14(a),
		getKey15(a),
	];
}

export function key16<A, B1, B2, B3, B4, B5, B6, B7, B8, B9, B10, B11, B12, B13, B14, B15, B16>(
	getKey1: (a: A) => B1,
	getKey2: (a: A) => B2,
	getKey3: (a: A) => B3,
	getKey4: (a: A) => B4,
	getKey5: (a: A) => B5,
	getKey6: (a: A) => B6,
	getKey7: (a: A) => B7,
	getKey8: (a: A) => B8,
	getKey9: (a: A) => B9,
	getKey10: (a: A) => B10,
	getKey11: (a: A) => B11,
	getKey12: (a: A) => B12,
	getKey13: (a: A) => B13,
	getKey14: (a: A) => B14,
	getKey15: (a: A) => B15,
	getKey16: (a: A) => B16,
	a: A,
): Key16<B1, B2, B3, B4, B5, B6, B7, B8, B9, B10, B11, B12, B13, B14, B15, B16> {
	return [
		getKey1(a),
		getKey2(a),
		getKey3(a),
		getKey4(a),
		getKey5(a),
		getKey6(a),
		getKey7(a),
		getKey8(a),
		getKey9(a),
		getKey10(a),
		getKey11(a),
		getKey12(a),
		getKey13(a),
		getKey14(a),
		getKey15(a),
		getKey16(a),
	];
}
