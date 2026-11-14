# Portfolio import file picker · 5 October 2026

Source: `codex/pilot-screen-integration-20261001`, local Leaf on an isolated Git-derived record. With JavaScript available, the file picker stays a native file input for pointer, keyboard, and assistive technology, while the visible control uses the shared Foliage outline treatment. The chosen filename sits beside it and the read result is announced below it.

At true 375 × 812 and 1280 × 800 browser widths, `/leaf/import` had no horizontal overflow or console errors. The input was keyboard-focusable with its format and current filename in `aria-describedby`. Selecting this repository's `context/product-thesis.md` showed `product-thesis.md`, reported **Opened locally**, filled the text, title, and source fields, and focused **Preview import**. No preview was submitted and no private record or review candidate was written.

- [Phone, before selection](screenshots/2026-10-05-import-picker-375.png)
- [Desktop, before selection](screenshots/2026-10-05-import-picker-1280.png)
- [Phone, file opened locally](screenshots/2026-10-05-import-file-opened-375.png)

The focused portfolio-import tests and Leaf typecheck passed; Impeccable detection returned no findings. This checks the file choice and population step, not every import validation or end-to-end review state.

A later no-script pass found that the file control was visible even though only the script reads its bytes. The picker now starts hidden and appears only when its handler initializes. At a true 375px viewport with scripts disabled before navigation, the picker was absent from the interactive tree; pasted text, title and source submitted a valid one-section preview through the native form. With scripts enabled, choosing the same local Markdown file populated the fields and focused Preview import. Both modes had no horizontal overflow or console errors. The isolated Leaf's hash stayed unchanged and no harvest document was created. This resolves the misleading no-script control; it does not claim a connected import-to-review journey.
