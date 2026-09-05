// packages/ir/src/current.ts
//
// The current IR version. Code that wants "whatever Morphir writes today"
// imports this; code that must stay on one wire format imports the pinned
// version module instead. Moving to v5 is a one-line change here.
export * from "./versions/v4/index.ts";
