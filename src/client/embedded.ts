const apps: [RegExp, string][] = [
  [/Instagram/, "Instagram"],
  [/MicroMessenger/, "WeChat"],
  [/Messenger/i, "Messenger"],
  [/FBAN|FBAV|FB_IAB/, "Facebook"],
  [/\bLine\//, "Line"],
  [/Snapchat/, "Snapchat"],
  [/TikTok|musical_ly|BytedanceWebview/, "TikTok"],
  [/LinkedInApp/, "LinkedIn"],
  [/Twitter/, "Twitter"],
];

export function embeddedBrowser(userAgent: string): string | null {
  for (const [pattern, name] of apps) if (pattern.test(userAgent)) return name;
  if (userAgent.includes("; wv)")) return "an in-app browser";
  if (/iPhone|iPad|Macintosh/.test(userAgent) && userAgent.includes("AppleWebKit") && !userAgent.includes("Safari/")) {
    return "an in-app browser";
  }
  return null;
}
