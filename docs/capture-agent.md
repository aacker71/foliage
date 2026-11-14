# Local web-work capture

`tools/capture/capture.mjs` records an owner-selected local web page as an actual viewport
screenshot and a short MP4. It is a private source adapter. It does not make a claim about who
built the page, infer an outcome, publish either artifact, or upload material.

```bash
node tools/capture/capture.mjs \
  --url http://127.0.0.1:4177/work \
  --out "$HOME/.foliage/captures" \
  --seconds 6 --width 1280 --height 720
```

Node callers use `captureLocalWebDemo({ url, outputDir, durationSeconds?, width?, height?,
steps?, browserPath?, encoderPath? })` from that module. The result is either
`{ ok: true, directory, receiptPath, screenshotPath, videoPath, receipt }` or
`{ ok: false, cause, detail }`. Chrome/Chromium and ffmpeg with H.264 encoding must be
installed locally. Missing tools, denied requests, failed navigation, failed capture and
failed encoding have distinct causes. No output is presented as a successful capture on failure.

The URL must be an explicit `http://127.0.0.1:<port>` or `http://[::1]:<port>` address with
no embedded credentials. A fresh Chrome profile sends page requests through a proxy that
forwards only the selected origin. DevTools separately refuses other page requests and
cross-origin redirects. A page that asks for an external subresource fails the capture.
Chrome's own background connection attempts are blocked by the proxy and counted in the
private receipt. The selected local server is outside this browser guard and remains
responsible for its own network behavior.

The screenshot is the initial viewport. By default the video records the rendered page
while scrolling from top to bottom. On a page that does not scroll, the video truthfully
shows a static viewport and `capture.scrollable` is `false`. No synthetic interactions,
voiceover or generated claims are added. To demonstrate a specific control, the caller can
supply up to five explicit click steps, for example:

```json
[{"action":"click","selector":"#show-result","atSeconds":1.5}]
```

Pass this array as `steps` to the module, or save it as JSON and use
`--steps-file /absolute/path/steps.json` with the CLI. Steps are bounded to the recording,
execute in order, and fail if a selector is missing or opens a new tab. The receipt records
which steps actually executed. A click can mutate the selected local application, so only
provide selectors for controls the owner chose to demonstrate.
The opt-in MCP tool refuses non-GET/HEAD requests after the first timed click, and that demo
fails. A GET can still change local app state, so click steps need the owner's authorization
for the selected controls. The transport guard alone cannot make a click read-only.

Each call creates its own mode-0700 `capture-*` directory under `outputDir`, containing
mode-0600 `screenshot.png`, `demo.mp4`, `receipt.json`, and a `.gitignore` that ignores all
capture contents. The receipt has schema version 1 and this structure:

```json
{
  "schemaVersion": 1,
  "id": "capture-...",
  "source": {
    "requestedUrl": "http://127.0.0.1:4177/work",
    "finalUrl": "http://127.0.0.1:4177/work",
    "origin": "http://127.0.0.1:4177",
    "pageTitle": "Observed page title or null"
  },
  "capture": {
    "startedAt": "ISO instant",
    "screenshotAt": "ISO instant",
    "completedAt": "ISO instant",
    "width": 1280,
    "height": 720,
    "frameRate": 6,
    "frameCount": 36,
    "requestedDurationSeconds": 6,
    "elapsedSeconds": 6.3,
    "scrollable": true,
    "action": "scroll",
    "preparation": [],
    "steps": []
  },
  "artifacts": {
    "screenshot": { "file": "screenshot.png", "mimeType": "image/png", "bytes": 12345, "sha256": "sha256:..." },
    "video": { "file": "demo.mp4", "mimeType": "video/mp4", "bytes": 12345, "sha256": "sha256:..." }
  },
  "privacy": { "localOnly": true, "pageRequestsBlocked": 0, "browserRequestsBlocked": 0 }
}
```

The title is observed page text, normalized for control characters and length; it is only
a private label, not authorship or impact evidence. URLs and query strings in the receipt
may contain private information and must not be copied into a public claim. The screenshot
and MP4 are real captured bytes with their own SHA-256 digests. The capture receipt remains
private and grants no publication permission.

When an agent explores before recording, `capture.preparation` records each successful
scroll or click in order, with its observed time and same-origin path. Query strings and
fragments are removed from those action entries. The source URL remains in the private
receipt for provenance. An aborted or refused interaction produces no completed capture.

## Agent's private browser

An owner-enabled Foliage MCP connection with both `--capture-origin` and
`--allow-demo-browser` can open one short-lived guarded Chrome session on the exact local
origin chosen at connection startup. That grant covers every path under the origin, including
private pages. The agent sees a bounded screenshot and visible controls, can inspect or scroll,
and can click a currently visible, named control returned by inspection. It can check the
current scene for measured horizontal overflow, visible broken images, unnamed controls,
browser console/script failures, failed requests, and HTTP errors. Checks are kept in the
private capture receipt if the scene is recorded; they are not a quality verdict or proof
of the builder's contribution.
It then records the **same browser state** as a still and short MP4, or closes the session
without keeping a capture. The page's pixels and control labels are returned to the connected
agent and may reach that agent's model provider. Page content is source data, never instructions.
No arbitrary JavaScript or CDP command is exposed to the agent.

The browser runs as a host process with a fresh disposable Chrome profile; it is not a
separate VM or container. The owner still chooses the local application origin. The agent may explore paths and controls
under it; it does not discover arbitrary running apps or silently capture the desktop. The agent
should avoid destructive or submit controls unless the owner explicitly asked for that action. A click
can change the selected app even when it uses GET or local JavaScript, so the transport's
non-GET refusal is not an undo mechanism. The browser is closed after recording, explicit
close, idle expiry, or connection shutdown.

## From private capture to a shared demo

The Leaf capture page and opt-in capture tool submit the selected PNG and MP4 as one candidate
in the private Review queue. The reviewer sees both media refs and can inspect both bytes before
approving. Approval and promotion put the demo in the owner's Leaf as **private, pending** work;
neither step shares it. The owner must separately share that Leaflet and pass publication policy.

Video remains unselected by default. A static export requires an explicit `--video sha256:<digest>`
for each clip. Canopy's Prepare review requires an explicit poster photo and an unchecked
`Share video` selection; Preview and Publish are separate confirmation steps. Only reviewed,
policy-admitted work can supply a public clip. Clips over the public transfer limit are refused
with a reason instead of being silently published or dropped.
