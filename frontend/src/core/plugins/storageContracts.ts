/** Persisted plugin state carried inside the project file (Goal 5). The host
 *  never interprets the values — each top-level key is a plugin id whose value
 *  is that plugin's opaque `project`-scope key/value map. */
export type ProjectExtensionState = Readonly<Record<string, unknown>>
export type ProjectExtensions = Readonly<Record<string, ProjectExtensionState>>
