// esbuild's `text` loader turns `import x from "./foo.css"` into the CSS source
// string. Declare it so TypeScript accepts the import.
declare module "*.css" {
  const css: string;
  export default css;
}
