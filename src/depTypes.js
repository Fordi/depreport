// Dependency "types" as exposed on the CLI / API, mapped to the package.json
// section each one reads from. The array order is canonical: when a package is
// declared in more than one selected section, the earliest one here wins (so a
// package in both dependencies and devDependencies reports as "main").
export const TYPE_SECTIONS = [
  { type: "main", section: "dependencies" },
  { type: "dev", section: "devDependencies" },
  { type: "peer", section: "peerDependencies" },
  { type: "optional", section: "optionalDependencies" },
];

export const DEP_TYPES = TYPE_SECTIONS.map((entry) => entry.type);

// What `depreport()` (and the CLI) include when no types are specified.
export const DEFAULT_TYPES = ["main", "dev"];

// Resolve a list of type names to their { type, section } entries, in canonical
// order, ignoring anything that is not a recognized type.
export function sectionsForTypes(types) {
  const wanted = new Set(types);
  return TYPE_SECTIONS.filter((entry) => wanted.has(entry.type));
}
