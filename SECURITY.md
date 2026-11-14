# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private
vulnerability reporting on this repository (Security tab, "Report a vulnerability").
Include what you found, how to reproduce it, and what you think the impact is.

## What is in scope

- Anything that lets one person's data reach another person without their approval.
- Redaction failures: private repository content, paths, or identities reaching a published page.
- Authentication, session, or token handling in the hosted app.

## Secrets

This repository holds no credentials. Every `.env*` file is git-ignored, and the
`env.example` files list variable names with blank values. If you find a real key or
token anywhere in the tree or its history, report it the same way.
