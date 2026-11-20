// Where the stronger QR reader's WebAssembly file comes from: our OWN build (Vite copies it into
// dist/assets with a hashed name) — never a CDN. Kept in its own small module so the tests can hand
// the reader the file's bytes instead (there is no web server in a test).
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

export function zxingOverrides(): { locateFile: (path: string, prefix: string) => string } {
  return { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) };
}
