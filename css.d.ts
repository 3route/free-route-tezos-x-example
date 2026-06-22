// TS 6 requires a declaration for side-effect imports of non-code assets
// (e.g. `import './globals.css'`); Next handles the actual CSS at build time.
declare module '*.css';
