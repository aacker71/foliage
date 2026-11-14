# Changelog

Release notes for Foliage.

## [Unreleased]

## [0.3.1.0] - 2026-10-22

### Fixed

- A record of more than about 440 pages can now have a brain. `foliage brain build` failed on every such record with "gbrain list_pages did not answer in JSON": gbrain's answer listing every page reached Foliage cut off at 96 KiB. Foliage now asks for 100 pages at a time.
- When git has neither your email nor your name set, `foliage grow` says so once and names both `--identity` and `--subject`. It used to refuse twice in a row, and the first refusal left an empty garden folder behind. START-HERE says when to add both.
- The commands `sources.mjs` suggests, for an empty list and for `watch` or `unwatch` with no folder, run as printed from any folder.
- The re-run line `foliage verify` prints keeps what you typed and always names the repository it checked by its full path, so it checks the same one from any folder.
- Collect checks for git first. With git missing, or only the macOS Command Line Tools stub, each source records one plain sentence saying git is needed, not git's raw error.
- The installer refuses a folder the release does not list, such as an empty one, as it already refused a file the release does not list.
- Opening the unpacked folders in Finder no longer stops an install when Finder adds a custom-icon file or a `.localized` file.
- `foliage status` says what builds a brain for a garden that has none ("off. This garden has no brain yet. Run …"), in the same words as `foliage brain refresh`.
- Running an installed copy's own `install.mjs` to make a new install no longer calls that copy an extracted release folder. When the folder holds a brain, the installer says what to do in each case: if you moved or extracted `vendor/` into it, move it out and pass its new path with `--with-brain`; if it is an installed Foliage, install from the runtime folder of the download with `--with-brain` and its `vendor/` folder. Doing what it says installs, the brain included.
- Pointing `--with-brain` at the runtime folder or at an install says it is not a Foliage brain, instead of "The brain archive manifest is invalid".
- Growing a second repository into a garden no longer replaces the first one's drafts that are still waiting for your decision. `foliage grow` refuses, names those drafts and changes nothing, as it already did for drafts you had decided. Deciding them does not free the garden for another repository, and the refusal now says so instead of sending you to finish the queue. Give the other repository its own garden with `--garden`.
- When `foliage grow` cannot check the folder a garden's queue came from, for example after you moved or renamed the repository, it now says what to do: move the repository back to that folder, or give it its own garden with `--garden`. It used to refuse with no next step. A queue with no decisions yet is checked by its commits instead, so a moved repository that holds them still grows into its garden, as in 0.3.0.
- When intake keeps a leaflet whose commit is not in the repository it read, such as one from another repository grown into the same garden, it no longer suggests a `git -C <that repository> show` command that cannot work. It says the commit is not there, and that `--drop-underived` would remove that leaflet too. It checks without fetching anything, even in a partial clone. If git cannot answer, it names no command and does not say the commit is missing.
- The installer says grow needs git only when it finds no git, or only the macOS stub with no developer tools behind it, and says which. It used to say so after every install. It finds out from files and still starts no other program. An Xcode in /Applications under another name, such as Xcode-beta.app, counts as developer tools.
- The garden folder (`~/.foliage`, or the one `--garden` names) is made readable by you alone, as its `brain` and `workflow` folders already were. A folder that is already there keeps the permissions it has.
- In keyword mode, the default, `foliage search` and `foliage_search` now say that Foliage's own keyword search answered and that `foliage brain search` searches the local brain. They used to say "until local embeddings are on", which read as if a built brain was not searchable.

## [0.3.0.0] - 2026-10-13

### Added

- A local brain for searching your record. It runs on this computer and never uses the network. `foliage brain build` makes it for a garden, `foliage brain status` says whether it is current, `foliage brain search` reads it, and `foliage brain remove` deletes it without touching your record. It refreshes itself when your record changes.
- The brain is included in the one download, `foliage-0.3.0-darwin-arm64-<commit>.tgz`, in a `vendor` folder beside `runtime`. `install.mjs` checks every file of it and installs it with Foliage, and stops if it fails a check. It runs on your Mac only. `--no-brain` installs Foliage without it, and `--add-brain` adds it to an install made without it. Without it, Foliage works as before and says the brain is not installed. macOS on Apple silicon only for now.
- Local embeddings for the brain, off by default. `foliage brain embed --local ollama:<model>` turns them on with a model that is already on this computer, and `--off` turns them off. While they are on and the brain is current, `foliage search` and the `foliage_search` tool use them to order the first results.
- Demos of your app. Capture a still and a short clip of an app running on this computer, review it like any draft, and once approved it leads that piece of work. A demo recorded during a project check is tied to the exact commit that was checked, so it shows the code it says it shows.
- An assistant can run a project check you pinned against an exact commit, and look over a page for broken images, unnamed buttons and errors before it records a demo.
- The release archive lists every bundled package and its licence in THIRD-PARTY-NOTICES.

### Changed

- A redesigned app. Work, Review, Sources, Portfolio and Scarlet lead with your work and its evidence, each page points to the next thing to do, and the main pages fit a phone screen.
- One home page. The logo takes you back to it, and the menu reads Home, Work, Review, Portfolio and Sources, with Scarlet under More.
- Review asks for your decision before the evidence and says where approved work goes.
- Drafts read better: a cut-off title ends with "…", a repeated prefix appears once, and drafts show the date the work was done.
- AI help says what state it is really in, such as "Model set · not checked yet" instead of "Ready", and a plain message when the local model is not running.
- An excluded search result shows why it was excluded, never its text.
- Employer screens show no per-person tallies.

### Fixed

- An approved draft's commit counts once. It was counted twice, and an exported page printed the internal label "photosynthesis:git-cluster".
- A draft of commits with no prefix is titled in their own words, not "unprefixed:".
- `foliage up` stops its server when it is signalled, and `./install.sh` runs to the end.
- A grow with no new commits leaves your record unchanged.
- A crashed lock, a read-only garden or a second grow prints one line that says what to do, not a stack trace.
- `foliage share` refuses an excluded record and prints its reason.
- `foliage integrations import` and `foliage search` refuse to run without `--garden`.
- Photos land in the garden, and `foliage photos` runs them.
- An import with a future date is refused.
- An agent can send several tool calls at once and gets each answer.
- Every local page refuses a request addressed to a host other than this computer.
- A story you write is no longer counted as its own evidence, and a public byline shows a readable date.
- `/publish` prints sharing commands that work as written and shows the address of a shared record.
- A new garden says which record is missing instead of printing a file error, and quiet hours no longer block Collect now.
- The import form says the filename or page address is required, Collect says why Collect now is unavailable, and Sources no longer logs a missing-icon error.

### Fixed after archive testing

- START-HERE says the archive unpacks into a `runtime` folder and to install from inside it. Followed word for word, it stopped at "Cannot find module install.mjs". It also has a grow step and says grow needs git.
- Every next step Foliage prints runs as printed: `node`, the full path to `foliage.mjs` and the garden. The installer adds no `foliage` command to PATH, and now says so.
- The installer says what is wrong in a sentence: the folder already exists, its parent is missing, or a release file or the brain folder is missing. `--help` prints the usage.
- `review --resume` after an approval gives one account of the approved drafts. It said one was refused as a duplicate, then that none was approved.
- Help names a doc only when this copy has it, and its command table lines up.
- An approved draft's commit counts once in `foliage search` and the `foliage_search` tool too.
- With no brain installed, `foliage search` says so instead of "keyword mode".
- `foliage brain embed` and `foliage brain remove` with no brain installed print the installer's `--add-brain` command.
- Every brain command checks every file of the installed brain. A changed file stops build, refresh and embed with that file named, and search falls back to Foliage's own search and says why.
- The brain archive no longer ships gbrain's own development files (`.env.testing.example`, `.github/` and git's dotfiles).
- The download is packed without the builder's name, macOS file attributes, Finder's files or git's files, with folders anyone can open and no file other users can change.
- Opening the unpacked runtime or brain folder in Finder no longer stops an install, and opening an installed brain's folder no longer makes the brain refuse to run. The installer and the brain's own file check skip every `.DS_Store` file and every `._` file Finder leaves, at any depth, and the installer copies none of them. Any other extra file is still refused.
- `foliage grow` on a computer without a working git says git is missing and, on a Mac, to run `xcode-select --install`. It said the repository had no `user.email`.
- Given a relative install folder, the installer says the folder must be an absolute path, not only the usage.
- `node foliage.mjs help` prints the help its table lists, and `help <command>` prints that command's help. The assistant server's `--help` names its setup doc only when this copy has it.
- In an installed copy, every fix and next step `foliage brain` prints is the whole command: `node`, the full path to `foliage.mjs` or `install.mjs`, and the garden.
- A draft you approved into your Leaf is found once, as its leaflet, in `foliage search`, the `foliage_search` tool and `foliage brain search`.
- `foliage brain status` takes about a second once a brain is built, down from about eight. It reads every setting back again only when something other than Foliage has opened the brain's database, or when asked with `--deep`.
- The brain archive drops `.github` folders and git's dotfiles at every depth, inside bundled packages too, not only at gbrain's top level.
- A comment in the shipped stylesheet no longer names a person or a developer's local server.
- `foliage watch`, `foliage verify` and connecting a repository on the Sources page say git is needed when git is missing or does not run, as `foliage grow` does, with `xcode-select --install` on a Mac. They said the folder was not a git repository.
- In an installed copy, the BRAIN line of `foliage status` prints its fix as the whole command too.
- The Grow command the installer prints can be pasted as it is. The note that grow needs git is on its own line.
- `install.mjs --help` and the assistant server's `--help` name their script by its full path, so the usage they print runs from any folder.
- START-HERE says to check the download against the SHA-256 published next to it.
- Comments in shipped files no longer name the repository something was measured on, a person or a client, or quote counts and dates from one person's own record.

## [0.2.0.0] - 2026-10-07

### Added

- Read and print a published résumé, save it as PDF, or download Word, Markdown and JSON versions with links back to the portfolio and its evidence.
- Open ATS account setup through Merge and see connection status in the recruiting workspace. Posting profiles to recruiter databases is not available in this release.

### Changed

- Let agents discover the structured résumé from the public portfolio, and label private résumé downloads as drafts.

### Fixed

- Refuse Word downloads when publication authority changes during generation.
- Include Word dependencies correctly in the standalone hosted runtime, including packages whose names overlap Node built-ins.

## [0.1.0.0] - 2026-09-04

### Added

- Prepare a Canopy Cloud publication from a local Compound Leaf in a private management page, with the exact public subject, accepted leaflets, withheld entries, and review limits visible before confirmation.
- Review and replace an existing publication, or withdraw an artifact even when its local source or policy can no longer be read.
- Start the private manager and public reader together with `foliage canopy`, using separate origins and explicit port checks.

### Changed

- Bind publication decisions to the reviewed source bytes, effective policy, and current public artifact. New artifacts record policy provenance while existing version 1 artifacts remain readable.
- Apply absolute deny rules again at publication and show changes in public wording, provenance, ordering, source records, and policy before replacement.
- Align Claude Code with the installed gstack workflow and the shared agent contract. ChatGPT, Claude, and the configured Fireworks/Kimi route prepare local inputs through the same publication boundary.

### Fixed

- Serialize publication mutations and refuse stale decisions, including changed invalid artifacts and locks left by exited processes.
- Keep sensitive provenance out of review inspection hints, and distinguish successful mutations from subsequent cleanup warnings.
- Preserve the two-accent limit at list scale and after withdrawal, and render composition metrics with tabular numerals.
