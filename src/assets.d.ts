// wrangler's `[[rules]] type = "Data"` turns these imports into raw bytes.
declare module '*.woff2' {
  const data: ArrayBuffer;
  export default data;
}
