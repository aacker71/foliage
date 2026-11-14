"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { commitsToLeaflets, type ObservedCommit } from "@foliage/leaf/intake";
import { GIT_LOG_EXPORT_COMMAND, parseGitLogExport } from "@foliage/leaf/git-log-export";
import { Button } from "@foliage/ui/button";
import { Field } from "@foliage/ui/field";
import { Input } from "@foliage/ui/input";
import { Label } from "@foliage/ui/label";
import { Textarea } from "@foliage/ui/textarea";

const MAX_SOURCE_BYTES = 400 * 1024;
const MAX_HISTORY_BYTES = 2 * 1024 * 1024;
const TEXT_FILE = /\.(?:txt|md|markdown)$/i;
const GIT_HISTORY_FILE = /\.tsv$/i;

type LocalSource = {
  name: string;
  size: number;
  text: string;
  observedAt: string;
} & ({ kind: "text" } | { kind: "git"; commits: readonly ObservedCommit[] });

function noteDownload(source: LocalSource, account: string) {
  const sourceName = source.name.replace(/[\r\n]/g, " ");
  const body = [
    "# Work note",
    "",
    `Source: ${sourceName}`,
    "Status: Private draft; source and authorship have not been verified.",
    "",
    "## What mattered",
    "",
    account.trim(),
    "",
    "## Source text",
    "",
    source.text,
    "",
  ].join("\n");
  const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${source.name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-") || "work"}-note.md`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PersonalJourney() {
  const [source, setSource] = useState<LocalSource>();
  const [account, setAccount] = useState("");
  const [gitEmails, setGitEmails] = useState("");
  const [error, setError] = useState("");
  const readSequence = useRef(0);
  const intake = useMemo(() => {
    if (source?.kind !== "git" || !gitEmails.trim()) return undefined;
    const identities = gitEmails.split(/[\s,;]+/).filter(Boolean);
    return commitsToLeaflets({ commits: source.commits, identities, observedAt: source.observedAt });
  }, [source, gitEmails]);

  async function openFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    const sequence = ++readSequence.current;
    setError("");
    if (!chosen) return;
    const isHistory = GIT_HISTORY_FILE.test(chosen.name);
    if (!isHistory && !TEXT_FILE.test(chosen.name)) {
      setError("Choose a text, Markdown or .tsv Git history file.");
      return;
    }
    if (chosen.size > (isHistory ? MAX_HISTORY_BYTES : MAX_SOURCE_BYTES)) {
      setError(isHistory ? "Choose a Git export under 2 MB." : "Choose a text or Markdown file under 400 KB.");
      return;
    }
    try {
      const bytes = await chosen.arrayBuffer();
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (sequence !== readSequence.current) return;
      if (!text.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
        setError("This file has no readable text. Choose another file.");
        return;
      }
      const observedAt = new Date().toISOString();
      if (isHistory) {
        const parsed = parseGitLogExport(text);
        if (!parsed.ok) {
          setError(`Could not read Git export. ${parsed.issues[0]?.at}: ${parsed.issues[0]?.message}`);
          return;
        }
        setSource({ kind: "git", name: chosen.name, size: chosen.size, text, observedAt, commits: parsed.commits });
      } else {
        setSource({ kind: "text", name: chosen.name, size: chosen.size, text, observedAt });
      }
      setAccount("");
      setGitEmails("");
    } catch {
      if (sequence === readSequence.current) setError("This file could not be read as UTF-8 text. Choose another file.");
    }
  }

  return (
    <>
      <section className="personal-start" aria-labelledby="personal-title">
        <div className="personal-intro">
          <h1 id="personal-title">Your work deserves a record.</h1>
          <p className="personal-purpose">Keep what you built, why you made it, and the evidence behind it while it is still close at hand.</p>
        </div>
        {source ? (
          <div className="personal-source personal-preview" aria-label="Your selected source">
            <div className="personal-source-head"><span>{source.kind === "git" ? "Git history opened" : "Source opened"}</span><strong>{source.name}</strong></div>
            {source.kind === "git" ? <div className="personal-evidence">
              <h2>Source records</h2>
              {!intake ? <p>Add your Git email addresses to inspect attribution.</p> : intake.ok ? <>
                <p><span className="prototype-metric">{intake.leaflets.length.toLocaleString()}</span> commits in this export · {intake.leaflets.filter(item => item.tier === "excluded").length.toLocaleString()} not attributed</p>
                {intake.uncheckedSignatures.length > 0 && <p>Signatures in this export cannot be checked here. Use the local app to inspect them.</p>}
                <ol>{intake.leaflets.slice(0, 6).map(item => <li key={item.id}><strong>{item.title}</strong><span><span className="prototype-metric" title={item.provenance?.ref}>{item.provenance?.ref.slice(0, 7)}</span> · {item.tier}</span>{item.tier === "excluded" && <small>{item.reason}</small>}</li>)}</ol>
                {intake.leaflets.length > 6 && <p>Showing 6 of <span className="prototype-metric">{intake.leaflets.length.toLocaleString()}</span> source records.</p>}
              </> : <div role="alert" className="personal-error"><strong>Could not inspect attribution</strong>{intake.issues.slice(0, 3).map(issue => <p key={issue.at}>{issue.at}: {issue.message}</p>)}</div>}
            </div> : <pre>{source.text.trim().slice(0, 1600)}{source.text.trim().length > 1600 ? "…" : ""}</pre>}
            <p><span className="prototype-metric">{source.size.toLocaleString()} bytes</span> · {source.kind === "git" ? "Git export supplied by you; not independently verified in this browser" : "Read only in this browser"}</p>
          </div>
        ) : (
          <figure className="personal-record-image personal-preview">
            <figcaption>Selected work from Foliage&apos;s Git history <span>Unpublished</span></figcaption>
            <a className="personal-record-link personal-record-link-desktop" href="/product/record-source.jpg" target="_blank" rel="noopener noreferrer" aria-label="Open full desktop record image">
              <Image src="/product/record-source.jpg" width={1280} height={900} sizes="(max-width: 900px) 100vw, 52vw" alt="Private Foliage Work screen with three selected Git source records and one draft ready to review" priority />
            </a>
            <a className="personal-record-link personal-record-link-mobile" href="/product/record-mobile.jpg" target="_blank" rel="noopener noreferrer" aria-label="Open full mobile record image">
              <Image src="/product/record-mobile.jpg" width={375} height={812} sizes="(max-width: 640px) 100vw" alt="Private Foliage Work screen showing a selected Git source record and one draft ready to review" priority />
            </a>
          </figure>
        )}
        <div className="personal-controls">
          <div className="personal-intake">
            <div className="personal-actions">
              <Button asChild variant={source ? "outline" : "default"} className="personal-upload">
                <label>
                  <input type="file" accept=".txt,.md,.markdown,.tsv,text/plain,text/markdown,text/tab-separated-values" onChange={openFile} aria-describedby="personal-file-note" />
                  <span>{source ? "Choose another file" : "Open a work file"}</span>
                </label>
              </Button>
              <Button asChild variant="ghost" className="personal-app-link"><Link href="/start">Get the local app</Link></Button>
            </div>
            <p id="personal-file-note" className="personal-boundary">Text or Markdown up to 400 KB; Git history up to 2 MB. Read in your browser, never uploaded.</p>
            <details className="personal-export-help"><summary>Export Git history</summary><code>{GIT_LOG_EXPORT_COMMAND}</code></details>
          </div>
          {error && <p className="personal-error" role="alert">{error}</p>}
          {source && <section className="personal-note" aria-labelledby="personal-note-title">
            <h2 id="personal-note-title">What mattered?</h2>
            <Field><Label htmlFor="personal-account">What did you do or learn?</Label><Textarea id="personal-account" value={account} onChange={event => setAccount(event.target.value)} placeholder="What changed, and why did it matter?" rows={4} /></Field>
            {source.kind === "git" && <Field><Label htmlFor="personal-git-emails">Your Git email addresses</Label><Input id="personal-git-emails" type="text" autoCapitalize="none" autoComplete="off" spellCheck={false} value={gitEmails} onChange={event => setGitEmails(event.target.value)} placeholder="you@example.com, work@example.com" /></Field>}
            <div className="personal-note-actions">
              <Button type="button" onClick={() => noteDownload(source, account)} disabled={!account.trim()}>Download private note</Button>
              <span>Saved to your device, not to a Foliage account.</span>
            </div>
          </section>}
        </div>
      </section>

    </>
  );
}
