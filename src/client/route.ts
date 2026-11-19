export type Route =
  | { name: "home" }
  | { name: "copy"; code: string }
  | { name: "pair" }
  | { name: "labels" }
  | { name: "not-found" };

export function matchRoute(pathname: string): Route {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (path === "/") return { name: "home" };
  if (path === "/pair") return { name: "pair" };
  if (path === "/labels") return { name: "labels" };
  if (path.startsWith("/b/")) {
    const code = path.slice(3);
    if (code !== "" && !code.includes("/")) return { name: "copy", code };
  }
  return { name: "not-found" };
}
