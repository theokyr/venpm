# Vencord Plugins Layout, DOM, and Unsafe-Behavior Review - 2026-05-16

Scope: focused static review of `/home/theo/src/vencord-plugins`, with emphasis on layout safety, direct DOM injection, brittle Discord DOM/webpack coupling, lifecycle cleanup, and unsafe behaviors that can break Discord or user systems. This is not a full product review of `venpm` itself; see `docs/code-review-2026-05-16.md` for the broader repo review.

Verification:

- `/home/theo/src/vencord-plugins`: `npm test` passed, 19 files / 301 tests.
- `/home/theo/src/vencord-plugins/proxy`: `npm run build` passed.

## Findings

### P1 - `ChannelTabs` does not restore Discord-owned inline layout styles

`plugins/channelTabs/index.tsx:1796` mutates every non-tab child of Discord's `[class*="page_"]`, setting `child.style.flex = "1"` and `child.style.minHeight = "0"` while only saving the original inline `height`. `injectUI` also sets `page.style.flexDirection = "column"` at `plugins/channelTabs/index.tsx:1835`. On teardown, `removeUI` clears `flex`, `minHeight`, and `flexDirection` instead of restoring their previous inline values (`plugins/channelTabs/index.tsx:1859`).

This is a layout-safety bug because it can corrupt Discord or another plugin's pre-existing inline styles after disable/reload, especially if another plugin already owns flex sizing in the page subtree. It can also produce non-reproducible breakage depending on plugin load order.

Recommendation: store and restore a full style snapshot for every property the plugin mutates (`page.style.flexDirection`, child `flex`, child `minHeight`, and child `height`). Use `WeakMap<HTMLElement, Partial<CSSStyleDeclaration>>` or a small typed snapshot object rather than clearing properties blindly.

### P1 - `ChannelTabs` can relocate the header after the plugin has stopped

`ChannelTabs.start()` schedules enriched-header relocation with an uncaptured `setTimeout` at `plugins/channelTabs/index.tsx:2061`. `stop()` tears down the current observer and relocation state at `plugins/channelTabs/index.tsx:2107`, but it cannot cancel the pending timeout. If the plugin is stopped within that one-second window, the callback can still run, move Discord's channel header into the title bar, and register a new observer after shutdown.

There is a related delayed-work leak in `setupHeaderObserver`: the local `debounceTimer` at `plugins/channelTabs/index.tsx:1749` is not cleared by `teardownHeaderObserver` at `plugins/channelTabs/index.tsx:1768`.

Recommendation: keep module-level handles for the startup delay and observer debounce, clear both on `stop()`, and guard delayed callbacks with an `isStarted` flag.

### P1 - `VenpmGui` can execute the wrong npm package through unscoped CLI detection/install

`plugins/venpmGui/native.ts:37` first executes `venpm --version`, then falls back to `npx venpm --version` at `plugins/venpmGui/native.ts:44`. `installVenpm` runs `npm install -g venpm` at `plugins/venpmGui/native.ts:138`.

That is unsafe behavior for a plugin native helper. The intended public package is scoped, but these paths invoke/install the unscoped `venpm` name. If that package exists, changes owner, or is resolved from a different registry, the GUI can run unrelated code. Even if it currently fails, the fallback behavior is still the wrong trust boundary.

Recommendation: use the scoped package and binary consistently (`@kamaras/venpm`), avoid `npx` auto-install behavior for detection, and display a manual install command that matches the real package.

### P2 - `HotkeyNav` leaves inline positioning changes behind

`HotkeyNav` creates keycap overlays by mutating host Discord nodes to `position: relative` (`plugins/hotkeyNav/index.tsx:359`, `plugins/hotkeyNav/index.tsx:403`, `plugins/hotkeyNav/index.tsx:589`). `stopGuildObserver` and `stopChannelObserver` only remove injected hints/classes (`plugins/hotkeyNav/index.tsx:640`) and do not restore the previous inline `position`.

That makes plugin disable/reload leaky: Discord-owned rows and wrappers can keep altered positioning after the plugin is gone. This is especially risky for guild/DM list items where Discord uses clipping and transforms.

Recommendation: track every element whose inline position is changed and restore its original `style.position` during cleanup.

### P2 - `HotkeyNav` has broad observers and global CSS that can affect unrelated UI

`startChannelObserver` watches the first `[class*="content"]` subtree (`plugins/hotkeyNav/index.tsx:625`) and schedules full channel-hint rebuilds for mutations under that broad area. It also schedules an initial `setTimeout(updateChannelHints, 500)` at `plugins/hotkeyNav/index.tsx:622` that is not cancellable on stop.

The CSS rule `.vc-member-list-decorators-wrapper { position: static !important; }` at `plugins/hotkeyNav/style.css:56` is global, not scoped to a plugin-rendered subtree. It can alter all member-list decorator wrappers for other plugins or Discord internals.

Recommendation: observe a narrower channel-list root where possible, store/cancel the initial timeout, and remove or scope the global decorator-wrapper override.

### P2 - Fixed overlays can become inaccessible on small windows or busy prompt stacks

Several plugin UIs use fixed or modal surfaces without enough viewport constraints:

- `DiscordMcp` appends prompt cards to `document.body` (`plugins/discordMcp/index.tsx:282`) in a fixed stack with `z-index: 99999`, `max-width: 360px`, and no `max-height`/scroll containment (`plugins/discordMcp/style.css:1`). A burst of prompts can grow off-screen, making lower Allow/Deny buttons unreachable. The CSS includes a timeout progress bar (`plugins/discordMcp/style.css:120`) that `renderPromptUI` does not render.
- `SettingsHub` forces `.vc-settingsHub-modal` to `min-width: 480px` (`plugins/settingsHub/style.css:557`), while its mobile media query only changes inner sidebar/content sizing (`plugins/settingsHub/style.css:579`). On narrow Discord windows this can overflow the viewport.
- `VenpmGui` uses a 480px wizard (`plugins/venpmGui/style.css:280`) with no `max-width: calc(100vw - ...)`, so it can overflow narrow windows.
- `ChannelTabs` overflow menus are `position: fixed` with `z-index: 99999` (`plugins/channelTabs/style.css:565`) but no visible max-height or viewport clamping.
- `MinimalCallBar` tooltips anchor to `anchorRect.left` without horizontal clamping (`plugins/minimalCallBar/components/CallTooltip.tsx:43`).

Recommendation: add viewport clamps (`max-width: calc(100vw - 32px)`, `max-height`, `overflow: auto`) and position clamping for fixed menus/tooltips. For prompt stacks, cap visible height and keep action buttons reachable.

### P2 - `MinimalCallBar` renders nested buttons in its overflow menu

The overflow menu item is a `<button>` at `plugins/minimalCallBar/components/CompactBar.tsx:275`, and it renders `ControlButton` inside it at `plugins/minimalCallBar/components/CompactBar.tsx:280`. `ControlButton` itself returns a `<button>` at `plugins/minimalCallBar/components/ControlButton.tsx:38`.

Nested interactive controls are invalid DOM and can produce inconsistent click/focus behavior. It also risks duplicate execution paths because both the parent button and the inner control have click handlers.

Recommendation: render the icon as a non-button element inside overflow items, or make `ControlButton` support `as="span"` / icon-only rendering for menu contexts.

### P2 - `EmbedFix` can leave rewritten embed fetches permanently stuck as pending

`EmbedAccessory` sets `embedDataCache.set(rewritten, "pending")` before fetching (`plugins/embedFix/components/EmbedAccessory.tsx:229`). If the component unmounts before the fetch resolves, the `then` handler returns early when `cancelled` is true (`plugins/embedFix/components/EmbedAccessory.tsx:232`) and never clears the pending cache entry. Future renders hit `cached === "pending"` and skip refetching (`plugins/embedFix/components/EmbedAccessory.tsx:227`).

The same component also suppresses Discord native embeds with a DOM effect that has no dependency array (`plugins/embedFix/components/EmbedAccessory.tsx:166`), so it reruns on every render and repeatedly toggles native embed `style.display` for all `article[class*="embed"]` under the message accessory container.

Recommendation: clear pending cache entries on cancelled resolution or move pending state to an abortable request registry. Add stable dependencies to the native-embed suppression effect and avoid restoring/mutating unrelated embed articles.

### P3 - `MessageHeaderAvatar` accepts unbounded layout-affecting settings

`MessageHeaderAvatar` writes numeric settings directly into CSS variables (`plugins/messageHeaderAvatar/index.tsx:64`, `plugins/messageHeaderAvatar/index.tsx:70`, `plugins/messageHeaderAvatar/index.tsx:76`) and uses the configured avatar size directly as image width/height and avatar URL size (`plugins/messageHeaderAvatar/index.tsx:91`). `lineColor` is accepted as a raw CSS value (`plugins/messageHeaderAvatar/index.tsx:82`).

This is not a direct DOM injection issue, but it is a layout-safety issue: negative, huge, or malformed values can make message rows unreadable, trigger oversized image requests, or push pseudo-elements outside the message list.

Recommendation: clamp numeric settings to sensible ranges and validate color to known-safe formats or CSS variables.

### P3 - `HotkeyNav` uses `innerHTML` where DOM construction would be safer

`HotkeyNav` injects keycap content through `innerHTML` (`plugins/hotkeyNav/index.tsx:370`, `plugins/hotkeyNav/index.tsx:376`, `plugins/hotkeyNav/index.tsx:408`, `plugins/hotkeyNav/index.tsx:604`). The current `formatModifierHTML` only emits fixed class names and a one-character fallback from user settings (`plugins/hotkeyNav/index.tsx:216`), so this does not look like a practical script injection path today.

It is still unnecessarily fragile. Odd keybind strings containing characters like `<` or `&` can be parsed as markup instead of text, and future changes to the formatter could accidentally widen the injection surface.

Recommendation: build spans with `document.createElement` / `textContent` or a small React component instead of returning HTML strings.

### P3 - `ChannelTabs` applies global native-window drag overrides

When enriched header is enabled, `plugins/channelTabs/style.css:530` applies `-webkit-app-region: no-drag` to every `[role="button"]`, `button`, anchor, input, search element, and window button under `body.vc-channelTabs-enrichedHeader`, not just inside the relocated title bar.

This is broader than the drag overlay it is meant to support and can change native-window drag behavior for unrelated controls across Discord.

Recommendation: scope no-drag rules to the visible title bar container and plugin-injected header controls.

### P3 - `BsNoMore` relies on brittle Discord hash and minified webpack shapes

The banner spacer selector explicitly targets a version-dependent hash fragment (`plugins/bsNoMore/style.css:47`). The DM nav and quest suppression patches use tightly coupled minified regexes (`plugins/bsNoMore/index.tsx:163`, `plugins/bsNoMore/index.tsx:171`).

This is expected in Vencord patches to some degree, but these paths have high breakage probability after Discord updates. The failure modes are visible UI breakage: banners hidden while spacers remain, the wrong nav children replaced, or quest suppression silently stopping.

Recommendation: add patch predicates where feasible, keep the CSS fallback harmless if the hash misses, and add runtime logging when expected patched components are absent.

## Notes

Most reviewed DOM text paths use `textContent` or React text rendering rather than direct user HTML, which is good. The main risk cluster is lifecycle and layout ownership: plugins mutate Discord-owned DOM and inline styles, then do not always restore the exact prior state or cancel delayed callbacks. Prioritizing those fixes should make plugin reloads, Discord updates, and inter-plugin combinations substantially safer.
