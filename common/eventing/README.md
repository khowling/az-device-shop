


https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-5.html


https://devblogs.microsoft.com/typescript/announcing-typescript-4-5-beta/
The 'type' setting in package.json controls whether .js files are interpreted as ES modules (import) or CommonJS modules (require) 
To overlay the way TypeScript works in this system, .ts and .tsx files now work the same way. When TypeScript finds a .ts, .tsx, .js, or .jsx file, it will walk up looking for a package.json to see whether that file is an ES module, and use that to determine:

When a .ts file is compiled as an ES module, ECMAScript import/export syntax is left alone in the .js output.

Node.js supports two extensions to help with this: .mjs and .cjs. .mjs files are always ES modules, and .cjs files are always CommonJS modules, and there’s no way to override these.

