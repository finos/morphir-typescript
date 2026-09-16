// packages/ir/src/index.ts
//
// The package entry point: the current IR version. The generic,
// version-agnostic model is "@finos/morphir-ir/model"; the pinned version
// modules are "@finos/morphir-ir/v4" and its successors.
// Support tables are version-agnostic: they say which releases a tool accepts,
// so they live beside the pinned version modules rather than inside one. The
// aliases keep `compatibility` and friends from colliding with the v4 names.
export * from "./current.ts";
export {
	type Compatibility as SupportTableCompatibility,
	canonicalSupportTable,
	compatibility as supportTableCompatibility,
	type Interval,
	parseSupportTable,
	RELEASE_COMPONENT_MAX,
	type Release,
	renderCargo,
	renderElm,
	renderProse,
	type SupportTable,
	supports,
} from "./versions/support-table.ts";
