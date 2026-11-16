# Contributing

Start with [DEVELOPMENT.md](DEVELOPMENT.md) for setup, watch mode and focused tests, and
[AGENTS.md](AGENTS.md) for the rules that are easy to get wrong.

- Run `pnpm check` before every commit. It must be green.
- Keep pull requests small and readable.
- Sign off every commit (`git commit -s`). That certifies the [DCO](DCO.txt). Your work is
  licensed under [MIT](LICENSE), like the rest of the project. There is no CLA.
- Never commit `.env` files, keys, personal leaf or tree documents, or absolute paths from your machine.
- No fake data: empty states stay honestly empty.
- No score anywhere an employer sees. Tiers `verified`, `pending` and `excluded` are unordered,
  and `excluded` always carries a reason.

Be kind: this project follows its [code of conduct](CODE_OF_CONDUCT.md).

Report security problems privately, as described in [SECURITY.md](SECURITY.md).
