# Publish policy rule reading — 2026-10-05

The local Leaf `/policy` page now leads with each rule's match and effect in document order. Its rule totals occupy one compact line; each **Why** disclosure contains the exact policy reason and full rule ID. The policy source and terminal commands remain available below the rules. There is no policy edit form or mutation route in this change.

The browser loaded `http://127.0.0.1:4597/policy` from this worktree with no `policy.json`. The server reported the shipped default policy: five rules, four deny and one allow. The page labeled that source as “Default rules · no policy document yet.” A local Leaf and harvest document were absent, so this receipt covers the shipped policy view, not an owner's configured policy.

- [Phone, 375 × 1041 full page](screenshots/2026-10-05-policy-finish-375.png)
- [Desktop, 1280 × 900](screenshots/2026-10-05-policy-finish-1280.png)

The screenshots came from gstack browse Chromium after setting actual 375 × 812 and 1280 × 900 viewports. `innerWidth` matched each target width, the 640px media query was true only at 375px, and `documentElement.scrollWidth` did not exceed either viewport. Image pixel widths measured 375 and 1280. Aside independently confirmed the rule order and no console errors, but its emulated full-page image tiled on this machine, so the attached captures use Chromium.

The first **Why** disclosure opened in the browser and showed the full default reason and `deny-excluded` ID. No separate Rule ID disclosure remained. The live page produced no console errors. Measured text contrast on the night surface was 15.35:1 for match/effect, 7.25:1 for Why, and 7.73:1 for the count line.

Focused studio, studio seam, and CSS tests passed (55/55); `@foliage/leaf-app` typecheck passed; Impeccable detect returned `[]`. Configured policy files, other policy failure states, and publication behavior remain outside this presentation receipt.
