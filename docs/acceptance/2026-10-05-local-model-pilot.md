# Local Photosynthesis model pilot · 5 October 2026

Candidate: `codex/pilot-screen-integration-20261001` at `1b97388119649cf51a3f5cc07b76103a32052800`.

An isolated garden was collected from real Foliage Git history. It held 1,041 pending Leaflets; the selected record was commit `d7812a2cb0c2e8b4993eb58c9aa382ea71a82b2d`, “Give portfolio import a focused file picker.” No owner garden, hosted publication or customer account was used.

In the browser, `/scarlet/setup` discovered installed Ollama models. `/scarlet/workspace` selected the record, enabled source excerpts and showed the exact Git patch under “Source read.” The local model calls used loopback `/api/tags` and `/api/chat`.

| Model and prompt | Observed result |
|---|---|
| `llama3.2:3b`, first Ask | HTTP 200 in 12.9 seconds. The answer omitted the supplied record citation and partly misread the earlier picker. The UI marked it “Needs review” and “No supplied record cited.” |
| `gemma4:12b`, concise warm Ask | HTTP 200 in 9.7 seconds. The answer cited `[L1]` twice, described the styled label and native input in the patch, and did not claim end-to-end validation. The UI showed “Done” and “No issues found · not fact-checked.” |

A separate verbose cold Gemma request was still streaming after 103 seconds and was stopped; it is not a completed response. The setup and workspace fit a measured 375 CSS-pixel viewport without horizontal overflow or console errors. The test listener, browser tabs and disposable garden were closed afterward.

This proves one selected-source local-model path and one useful citation refusal. It does not accept arbitrary models, repeated background runs, the owner's record, publication or the complete first-use journey.
