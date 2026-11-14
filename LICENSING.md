# Licensing

Foliage is released under the **MIT License**. The full text is in [`LICENSE`](LICENSE), and every
`package.json` in the workspace declares `MIT`.

Everything in this repository is covered: the leaf, the photosynthesis review flow, the canopy,
the enterprise policy code, the apps and the website. There is no proprietary tier in the source
tree and no separate commercial licence.

## What MIT means for you

You can use, copy, modify, merge, publish, distribute, sublicense and sell the software, including
in closed products, as long as the copyright and licence notice stay with it. There is no warranty.

Third-party packages keep their own licences. The runtime archive lists them in `THIRD-PARTY-NOTICES`.
This page is a summary, not legal advice. `LICENSE` is the authority.

## Contributions

Contributions come in under the same licence, with a [Developer Certificate of Origin](DCO.txt)
sign-off (`git commit -s`). There is no CLA. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Layers inside the repository

[`public-boundary.json`](public-boundary.json) sorts packages into layers named `open`, `cloud` and
`enterprise`, and `pnpm check:boundary` fails if a lower layer imports a higher one. The names are
historical. They do not mean different licences; they keep the leaf self-hostable on its own, so
one person can run their own portfolio without the hosted canopy or the enterprise code.

## Names

"Foliage" and "Canopy" are the project's names. The licence covers the code, not any trademark.
