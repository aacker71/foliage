"use client";

import { useRef, useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import "./member.css";

function downloadAccount(title: string, account: string) {
  const body = [
    `# ${title.trim()}`,
    "",
    "Private, self-reported work account. Company policy and evidence have not been checked.",
    "",
    account.trim(),
    "",
  ].join("\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "work-account"}.md`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function MemberJourney() {
  const titleField = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [account, setAccount] = useState("");
  const [startedDownload, setStartedDownload] = useState(false);
  const [error, setError] = useState("");

  function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !account.trim()) {
      setError("Add a contribution and your account before downloading.");
      return;
    }
    setError("");
    downloadAccount(title, account);
    setStartedDownload(true);
  }

  return (
    <section className="member-journey" aria-labelledby="member-title">
      <div className="member-intro">
        <h1 id="member-title">Keep your part of the work.</h1>
        <p>Record what you contributed while the decisions and discoveries are still clear.</p>
        <Button className="member-start-action" type="button" onClick={() => titleField.current?.focus()}>Write a private account</Button>
        <div className="member-boundary">
          <strong>Your account, in your words.</strong>
          <span>Company evidence needs a separate release decision.</span>
        </div>
      </div>

      <form className="member-form" onSubmit={saveNote}>
        <h2>Write one work account</h2>
        <div className="member-field">
          <Label htmlFor="member-title-input">Contribution</Label>
          <Input
            id="member-title-input"
            ref={titleField}
            value={title}
            onChange={event => { setTitle(event.target.value); setStartedDownload(false); setError(""); }}
            maxLength={160}
            required
            autoComplete="off"
          />
        </div>
        <div className="member-field">
          <Label htmlFor="member-account-input">What did you do?</Label>
          <textarea
            id="member-account-input"
            value={account}
            onChange={event => { setAccount(event.target.value); setStartedDownload(false); setError(""); }}
            maxLength={12000}
            rows={6}
            required
          />
        </div>
        <div className="member-form-end">
          <Button type="submit" className="member-primary">Download private note</Button>
          <p>A Markdown file from your words.</p>
        </div>
        {error && <p className="member-error" role="alert">{error}</p>}
        {startedDownload && <p className="member-feedback" role="status">Download started. Keep the file somewhere private.</p>}
      </form>

      <p className="member-policy-note">No company policy connected · Not a release approval or takeout</p>
    </section>
  );
}
