---
name: mirrorly
description: See a web page as a real phone shows it, and screenshot it, with Mirrorly's MCP tools (mirrorly_open, mirrorly_scroll, mirrorly_screenshot). Use when checking a mobile layout or responsive CSS, verifying a UI change on iPhone or Android sizes (including a local dev server on localhost), comparing devices or light and dark mode, or when the user asks how a page looks on a phone.
---

# Mirrorly: look at a page on a phone

Mirrorly draws a web page in a real phone: the device's screen size, its browser's bars (Safari, Chrome, Firefox), user agent, safe areas, touch and light or dark mode. Its MCP tools give you that phone.

## Tools

- `mirrorly_open` — load a URL. `device` (default `iphone-16-pro`), `browser` (`safari`, `chrome`, `firefox`, `none`), `appearance` (`light`, `dark`), `landscape`. Calling it again reloads the page or changes device.
- `mirrorly_scroll` — exactly one of `position` (`top`, `bottom`), `y`, `by`, or `selector` (CSS).
- `mirrorly_screenshot` — `mode`: `frame` (the phone with its bars, the default), `screen` (just the page in view) or `full` (the whole page). Returns the image and saves the PNG to a file.
- `mirrorly_devices` — device ids and the browsers each offers.
- `mirrorly_status` — whether pages run in the user's Firefox or headless Firefox.

Clients may prefix the names, e.g. `mcp__mirrorly__mirrorly_open`.

## How to use it

1. Open the page: `mirrorly_open` with the URL. A dev server works (`http://localhost:3000`). Default to an iPhone in Safari unless the task says otherwise; add `pixel` (Chrome) when Android matters, and `iphone-se` for the smallest common screen.
2. Look: `mirrorly_screenshot`. Use `full` to review a whole page in one image, `frame` when what Safari's toolbar or the status bar covers matters (sticky headers, bottom bars, safe areas), `screen` for a clean page image to share.
3. Go further down with `mirrorly_scroll` (`selector` to jump to the part you changed), then screenshot again.
4. After you change code, call `mirrorly_open` again to reload, and screenshot the same place to compare.
5. Describe what you see in the image concretely: overflow, text wrapping, tap targets too small or too close, content hidden under the browser bars, horizontal scrolling, broken dark mode.

## Notes

- If the user is signed in to the site in Firefox and has turned on "Let AI agents use Mirrorly", pages open in their Firefox (in a background tab) with their logins. Otherwise headless Firefox is used, signed out. `via: "browser"` requires their Firefox; say so if it isn't connected.
- The page is drawn by Firefox's engine, so engine-specific CSS (rare) can differ from real Safari or Chrome.
- The screenshot file path in each reply can be attached to a pull request or bug report.
