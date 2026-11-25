import { expect, test } from "vitest";
import { embeddedBrowser } from "./embedded";

const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)";

test.each([
  ["iPhone Safari", `${iphone} Version/27.0 Mobile/15E148 Safari/604.1`, null],
  ["iPhone Chrome", `${iphone} CriOS/157.0.8103.37 Mobile/15E148 Safari/604.1`, null],
  ["iPhone Firefox", `${iphone} FxiOS/140.0 Mobile/15E148 Safari/605.1.15`, null],
  ["desktop Chrome", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36", null],
  ["Instagram on iOS", `${iphone} Mobile/15E148 Instagram 400.0.0.30.110 (iPhone15,2; iOS 27_0_1; en_US; en; scale=3.00; 1170x2532; 123456789)`, "Instagram"],
  ["Facebook on Android", "Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP4A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/157.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/500.0.0.0.0;]", "Facebook"],
  ["Facebook on iOS", `${iphone} Mobile/15E148 [FBAN/FBIOS;FBAV/500.0;FBBV/1;FBDV/iPhone15,2]`, "Facebook"],
  ["Messenger", `${iphone} Mobile/15E148 [FBAN/MessengerForiOS;FBAV/500.0]`, "Messenger"],
  ["WeChat", "Mozilla/5.0 (Linux; Android 15; wv) AppleWebKit/537.36 Chrome/157.0 Mobile Safari/537.36 MicroMessenger/8.0.50", "WeChat"],
  ["Line", `${iphone} Mobile/15E148 Safari Line/14.0.0`, "Line"],
  ["Snapchat", `${iphone} Mobile/15E148 Snapchat/13.0.0`, "Snapchat"],
  ["TikTok", `${iphone} Mobile/15E148 TikTok/38.0.0`, "TikTok"],
  ["LinkedIn", `${iphone} Mobile/15E148 LinkedInApp/9.0`, "LinkedIn"],
  ["Twitter", `${iphone} Mobile/15E148 Twitter for iPhone/10.0`, "Twitter"],
  ["iPad WKWebView (desktop-class UA)", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)", "an in-app browser"],
  ["Mac Safari", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15", null],
  ["Mac Chrome", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36", null],
  ["Mac Edge", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0", null],
  ["Mac Firefox", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0", null],
  ["TikTok musical_ly", `${iphone} Mobile/15E148 musical_ly_38.0.0 JsSdk/2.0`, "TikTok"],
  ["TikTok BytedanceWebview", "Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP4A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/157.0.0.0 Mobile Safari/537.36 BytedanceWebview/d8a21c6", "TikTok"],
  ["Messenger on Android", "Mozilla/5.0 (Linux; Android 15; wv) AppleWebKit/537.36 Chrome/157.0.0.0 Mobile Safari/537.36 [FB_IAB/MESSENGER;FBAV/500.0]", "Messenger"],
  ["Android WebView", "Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP4A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/157.0.0.0 Mobile Safari/537.36", "an in-app browser"],
  ["iOS WebView without Safari token", `${iphone} Mobile/15E148`, "an in-app browser"],
])("%s", (_name, ua, expected) => {
  expect(embeddedBrowser(ua)).toBe(expected);
});
