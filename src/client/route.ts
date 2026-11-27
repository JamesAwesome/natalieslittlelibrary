export type Route =
  | { name: "home" }
  | { name: "copy"; code: string }
  | { name: "pair" }
  | { name: "labels" }
  | { name: "mine" }
  | { name: "shelf"; id: string }
  | { name: "holding" }
  | { name: "members" }
  | { name: "people" }
  | { name: "more" }
  | { name: "member"; id: string }
  | { name: "copy-by-id"; id: string }
  | { name: "import" }
  | { name: "not-found" };

const WITH_ID: [string, "shelf" | "member" | "copy-by-id"][] = [
  ["/collections/", "shelf"],
  ["/members/", "member"],
  ["/copies/", "copy-by-id"],
];

export function matchRoute(pathname: string): Route {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (path === "/") return { name: "home" };
  if (path === "/pair") return { name: "pair" };
  if (path === "/labels") return { name: "labels" };
  if (path === "/mine") return { name: "mine" };
  if (path === "/holding") return { name: "holding" };
  if (path === "/members") return { name: "members" };
  if (path === "/people") return { name: "people" };
  if (path === "/more") return { name: "more" };
  if (path === "/import") return { name: "import" };
  if (path.startsWith("/b/")) {
    const code = path.slice(3);
    if (code !== "" && !code.includes("/")) return { name: "copy", code };
  }
  for (const [prefix, name] of WITH_ID) {
    if (!path.startsWith(prefix)) continue;
    const id = path.slice(prefix.length);
    if (id !== "" && !id.includes("/")) return { name, id };
  }
  return { name: "not-found" };
}
