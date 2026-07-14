// Test stub for the `server-only` package.
//
// The real `server-only` module throws unless it is resolved under the
// `react-server` export condition (which Next.js sets for server components but
// Vitest does not). Modules like `lib/supabase/service.ts` legitimately do
// `import "server-only"`; aliasing that import to this empty module (see
// `vitest.config.ts`) lets them be imported inside the Node test environment
// without changing their production behavior.
export {};
