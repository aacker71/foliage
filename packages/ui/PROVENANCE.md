# Component provenance

Button, Input, Textarea, Label and Alert are adapted from shadcn/ui's `new-york` registry,
retrieved on 2026-09-05 with the installed shadcn 3.5.0 CLI (`add button input textarea label
alert`). Upstream: https://github.com/shadcn-ui/ui, MIT, copyright (c) 2023 shadcn.

The upstream permission notice is retained below. Adaptations: JSX becomes React
`createElement` for direct Node TypeScript execution; Tailwind classes become existing
Foliage token-backed `.btn`/`.field` classes; Button retains CVA variants and Radix Slot
composition. Unused variants/sizes and decorative shadows are removed. Label uses its
native HTML element for static rendering, without client double-click handling. Alert
retains its slot and role, with the caller able to use `status` for nonurgent notices.

These components are server-rendered via React `renderToStaticMarkup`, not hydrated.
The `ui` facade accepts text and typed props; it deliberately has no raw-HTML shortcut.
Native disclosures, checkbox and scrolling are not shadcn migrations. Magic UI is not
used by the static facade. The application styles and fonts come from `@foliage/tokens`.

## September 23 foundation rebuild

The shared Button now uses Foliage semantic classes and Radix Slot rather than the
registry utility styling. Native documents and React applications share that component.
ToggleGroup is a Foliage wrapper over Radix Primitives with package-owned styling.
Select is likewise a Foliage-owned wrapper over Radix behavior, added for the live
Workflow Rhythm form. It uses token roles and does not import registry styling.
The source notices below remain for retained adaptations.

## Interactive component entry points

The component subpaths (`button`, `input`, `label`, `tabs`, `blur-fade`) and
`controls.css` came from the customer-journeys implementation. They preserve the
website shadcn radix-nova adaptations and Magic UI BlurFade. See
`docs/UI-FOUNDATION.md` and their inline upstream references. The root `ui` facade
continues to render static document controls; these subpaths power the website and are
available for application integrations. Both use the same React release and Foliage tokens.

## Integration source

The interactive controls, leaf-shaped styles and `portfolio`/`portfolio.css` modules are
preserved from `codex/customer-journeys` at `89686bdc7300133f334a3dbba7b0b699c93b611b`.
Its Button uses `createElement` in `button.ts` so the portfolio helper also runs directly
in Node without a JSX build. The static facade, tests and this shadcn notice come from
`codex/streamlined-journey` at `efe5a0a987da84fc3035d1eb8aa2be493aea03aa`. Both exports
remain available; neither branch's application renderers are implicitly imported here.

## Upstream permission notices

BlurFade comes from [Magic UI](https://github.com/magicuidesign/magicui). Its
[MIT notice](https://github.com/magicuidesign/magicui/blob/main/LICENSE.md) was checked
on 2026-09-07 and is retained alongside the shadcn notice. The shared permission terms
below apply to their respective adapted components.

Copyright (c) 2023 shadcn

Copyright (c) Magic UI

Permission is hereby granted, free of charge, to any person obtaining a copy of this
software and associated documentation files (the "Software"), to deal in the Software
without restriction, including without limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
