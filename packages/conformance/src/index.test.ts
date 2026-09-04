import { expect, test } from "bun:test";
import { packageName } from "./index.ts";

test("package exposes its name", () => {
	expect(packageName).toBe("@finos/morphir-ir-conformance");
});
