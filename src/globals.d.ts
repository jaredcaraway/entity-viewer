// Minimal typing for the WebExtension API globals: `browser` in Firefox, `chrome` in Chrome.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const browser: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;
/** The browser this build is for, set by vite.config.ts. */
declare const __BROWSER__: 'firefox' | 'chrome';
declare module '*.css';
declare module 'cytoscape-fcose';
