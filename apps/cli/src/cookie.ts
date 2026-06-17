// Build a `Cookie` request header from the `Set-Cookie` headers returned by the
// login response. We don't try to single out the session cookie — we just echo
// back every cookie's name=value pair, which is exactly what a browser does and
// what the curl-based flows do. Pure → unit-tested.

export function cookieHeaderFrom(setCookies: string[]): string {
  return setCookies
    .map((sc) => (sc.split(";")[0] ?? "").trim())
    .filter((c) => c.includes("="))
    .join("; ");
}
