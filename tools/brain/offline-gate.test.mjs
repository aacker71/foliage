/**
 * The brain offline gate's judgement, without starting gbrain: how deny lines and strace lines are
 * read, what a missing tool or vendor/ says, which controls run, how a process that outlived its
 * step is found, and how attempts are reported. Every log line below is SYNTHETIC, shaped like the
 * measured output it stands for (macOS `log stream --style ndjson` with a tagged deny rule; strace
 * 6.8 with -f), with made-up pids and addresses. The survivor test starts plain node processes
 * that only sleep. The end-to-end run is the gate itself, `node scripts/check-brain-offline.mjs`,
 * which `pnpm check` runs.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { allowedFor, controlsFor, GATE_MARK, greenScope, macAttempts, missingTools, namespaceFailure, outlived, PHASES, programSlots, reportLines, runOfflineGate, straceAttempts, survivorsAmong } from "./offline-gate.mjs";

/** @param {string} message */
const ndjson = (message) => JSON.stringify({ messageType: "Error", eventType: "logEvent", processImagePath: "/kernel", eventMessage: message });

test("macOS: only deny lines tagged with this run count, each named by kind and by the step that caused it", () => {
  const run = "synthetic-run-1";
  const text = [
    'Filtering the log data using "composedMessage CONTAINS "deny(""',
    ndjson(`Sandbox: bun(101) deny(1) network-outbound /private/var/run/mDNSResponder\n${GATE_MARK} ${run} build`),
    ndjson(`Sandbox: bun(102) deny(1) file-write-create /Users/synthetic/.gbrain/x\n${GATE_MARK} ${run} status at the end`),
    ndjson(`Sandbox: bun(103) deny(1) process-exec* /bin/launchctl\n${GATE_MARK} ${run} search\nProcess:         bun [103]`),
    ndjson(`Sandbox: bun(104) deny(1) network-outbound remote:*:53\n${GATE_MARK} another-run build`),
    ndjson("Sandbox: mds_stores(499) deny(1) system-info vfs.disk-space"),
    "not json",
  ].join("\n");
  assert.deepEqual(macAttempts(text, run), [
    { kind: "network", step: "build", text: "bun(101) deny(1) network-outbound /private/var/run/mDNSResponder" },
    { kind: "owner-write", step: "status at the end", text: "bun(102) deny(1) file-write-create /Users/synthetic/.gbrain/x" },
    { kind: "program", step: "search", text: "bun(103) deny(1) process-exec* /bin/launchctl" },
  ]);
  assert.deepEqual(macAttempts(text, "a-run-that-saw-nothing"), []);
});

test("Linux: any send that is not loopback, any lookup, a resolver's socket or a connected local socket, and any other program count", () => {
  const programs = new Set(["/opt/node/bin/node", "/work/vendor/bun/bun", "/bin/sh", "/usr/bin/dash"]);
  const lines = [
    '7 execve("/opt/node/bin/node", ["node", "brain.mjs"], 0x1 /* 9 vars */) = 0',
    '8 execve("/work/vendor/bun/bun", ["bun"], 0x2 /* 8 vars */) = 0',
    '8 execve("/work/garden/brain/bin/git", ["git"], 0x3 /* 8 vars */) = -1 ENOENT (No such file or directory)',
    '9 execve("/usr/bin/git", ["git", "ls-files"], 0x4 /* 8 vars */) = 0',
    '8 connect(5, {sa_family=AF_INET, sin_port=htons(5432), sin_addr=inet_addr("127.0.0.1")}, 16) = -1 ENETUNREACH (Network is unreachable)',
    '8 connect(6, {sa_family=AF_INET, sin_port=htons(53), sin_addr=inet_addr("127.0.0.53")}, 16) = -1 ENETUNREACH (Network is unreachable)',
    '8 connect(7, {sa_family=AF_INET, sin_port=htons(443), sin_addr=inet_addr("203.0.113.9")}, 16) = -1 EINPROGRESS (Operation now in progress)',
    '8 connect(8, {sa_family=AF_INET6, sin6_port=htons(80), sin6_flowinfo=htonl(0), inet_pton(AF_INET6, "2001:db8::1", &sin6_addr), sin6_scope_id=0}, 28) = -1 ENETUNREACH (Network is unreachable)',
    '8 connect(9, {sa_family=AF_INET6, sin6_port=htons(11434), sin6_flowinfo=htonl(0), inet_pton(AF_INET6, "::1", &sin6_addr), sin6_scope_id=0}, 28) = -1 ECONNREFUSED (Connection refused)',
    '7 connect(21, {sa_family=AF_UNIX, sun_path="/var/run/nscd/socket"}, 110) = -1 ENOENT (No such file or directory)',
    '7 connect(22, {sa_family=AF_UNIX, sun_path="/var/run/nscd/socket"}, 110) = 0',
    '8 connect(10, {sa_family=AF_UNIX, sun_path="/run/systemd/resolve/io.systemd.Resolve"}, 42) = -1 ENOENT (No such file or directory)',
    '8 sendto(11, [{nlmsg_len=20, nlmsg_type=RTM_GETADDR, nlmsg_flags=NLM_F_REQUEST|NLM_F_DUMP, nlmsg_seq=1, nlmsg_pid=0}], 20, 0, {sa_family=AF_NETLINK, nl_pid=0, nl_groups=00000000}, 12) = 20',
    '8 connect(14, {sa_family=AF_UNSPEC, sa_data="\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0"}, 16) = 0',
    '8 sendmsg(12, {msg_name={sa_family=AF_INET, sin_port=htons(53), sin_addr=inet_addr("198.51.100.7")}, msg_namelen=16, msg_iov=[{iov_base="x", iov_len=1}], msg_iovlen=1, msg_controllen=0, msg_flags=0}, 0) = 1',
    '10 connect(13, {sa_family=AF_INET, sin_port=htons(80), sin_addr=inet_addr("192.0.2.4")}, 16 <unfinished ...>',
    '11 execve("/bin/sh", ["/bin/sh", "-c", "discover"], 0x5 /* 8 vars */) = 0',
    "10 <... connect resumed>) = -1 ENETUNREACH (Network is unreachable)",
    '8 connect(15, {sa_family=AF_VSOCK, svm_cid=2, svm_port=1024}, 16) = -1 ENODEV (No such device)',
    '8 connect(16, {sa_family=0x2c /* AF_??? */, sa_data="x"}, 16) = -1 EAFNOSUPPORT (Address family not supported by protocol)',
    // Never resumed: the tracer was killed mid-call. Each is judged on its logged half.
    '12 connect(17, {sa_family=AF_INET, sin_port=htons(443), sin_addr=inet_addr("192.0.2.9")}, 16 <unfinished ...>',
    '13 connect(18, {sa_family=AF_UNIX, sun_path="/run/synthetic.sock"}, 110 <unfinished ...>',
    '14 execve("/usr/bin/curl", ["curl"], 0x6 /* 8 vars */ <unfinished ...>',
    '15 connect(19, {sa_family=AF_INET, sin_port=htons(5432), sin_addr=inet_addr("127.0.0.1")}, 16 <unfinished ...>',
  ];
  const attempts = straceAttempts(lines.join("\n"), "build", programs);
  assert.deepEqual(attempts.map(attempt => [attempt.kind, attempt.text.replace(/: .*$/s, "")]), [
    ["program", "pid 9 started /usr/bin/git"],
    ["network", "pid 8 a name lookup to 127.0.0.53:53"],
    ["network", "pid 8 connect to 203.0.113.9:443"],
    ["network", "pid 8 connect to 2001:db8::1:80"],
    ["network", 'pid 7 a connection to the local socket "/var/run/nscd/socket", which could relay outside the namespace'],
    ["network", 'pid 8 a name lookup through the local resolver socket "/run/systemd/resolve/io.systemd.Resolve"'],
    ["network", "pid 8 a name lookup to 198.51.100.7:53"],
    ["network", "pid 10 connect to 192.0.2.4:80"],
    ["network", "pid 8 connect on the socket family AF_VSOCK, which the gate cannot judge"],
    ["network", "pid 8 connect on the socket family 0x2c, which the gate cannot judge"],
    ["network", "pid 12 connect to 192.0.2.9:443 (never finished under the observer)"],
    ["network", 'pid 13 a connection to the local socket "/run/synthetic.sock", which could relay outside the namespace (never finished under the observer)'],
    ["program", "pid 14 started /usr/bin/curl (never finished under the observer)"],
  ]);
  assert.ok(attempts.every(attempt => attempt.step === "build"));
  assert.match(attempts[7]?.text ?? "", /connect\(13, .*192\.0\.2\.4.*= -1 ENETUNREACH/, "a split call is judged whole");
  assert.deepEqual(straceAttempts("", "quiet", programs), []);
});

test("each step may start node and the shell; the staged bun unless it must start no gbrain; git only when its command reads a work repository", () => {
  const programs = { node: "/opt/node/bin/node", bun: "/work/vendor/bun/bun", always: ["/opt/node", "/opt/node/bin/node", "/bin/sh"],
    gbrain: ["/work/vendor/bun/bun"], git: ["/usr/bin/git", "/Applications/Xcode.app/Contents/Developer/usr/bin/git"] };
  assert.deepEqual(allowedFor(programs), ["/opt/node", "/opt/node/bin/node", "/bin/sh", "/work/vendor/bun/bun"]);
  assert.deepEqual(allowedFor(programs, { gbrain: false }), ["/opt/node", "/opt/node/bin/node", "/bin/sh"]);
  assert.deepEqual(allowedFor(programs, { git: true }), [...programs.always, ...programs.gbrain, ...programs.git]);
  // One macOS profile serves every step: the slots never change in number, and a program the step
  // may not start leaves its slot holding node.
  const slots = [programSlots(programs), programSlots(programs, { gbrain: false }), programSlots(programs, { git: true })];
  assert.ok(slots.every(slot => slot.length === 6));
  assert.deepEqual(slots[0], ["/opt/node", "/opt/node/bin/node", "/bin/sh", "/work/vendor/bun/bun", "/opt/node/bin/node", "/opt/node/bin/node"]);
  assert.deepEqual(slots[1], ["/opt/node", "/opt/node/bin/node", "/bin/sh", "/opt/node/bin/node", "/opt/node/bin/node", "/opt/node/bin/node"]);
  assert.ok(!slots[1]?.includes(programs.bun) && !slots[0]?.some(slot => slot.endsWith("/git")));
  assert.deepEqual(slots[2]?.slice(3), ["/work/vendor/bun/bun", ...programs.git]);
  // Linux judges the same allowance: a bun started by a step that must start no gbrain is a program start.
  const started = '7 execve("/work/vendor/bun/bun", ["bun"], 0x1 /* 9 vars */) = 0';
  assert.deepEqual(straceAttempts(started, "foliage search", new Set(allowedFor(programs, { gbrain: false }))).map(attempt => attempt.kind), ["program"]);
  assert.deepEqual(straceAttempts(started, "foliage brain search", new Set(allowedFor(programs))), []);
});

/**
 * A probe for `missingTools`: every path exists and every command runs, except those named.
 * @param {{ absent?: string[], failing?: string[] }} [broken]
 */
const fakeProbe = ({ absent = [], failing = [] } = {}) => ({
  exists: (/** @type {string} */ path) => !absent.includes(path),
  runs: (/** @type {string} */ command, /** @type {readonly string[]} */ args) => !absent.includes(command) && !failing.includes([command, ...args].join(" ")),
});

test("a missing sandbox tool or git, or a sandbox that cannot apply a profile here, is named with the command that fixes it", () => {
  assert.deepEqual(missingTools("darwin", fakeProbe()), []);
  assert.deepEqual(missingTools("linux", fakeProbe()), []);
  const mac = missingTools("darwin", fakeProbe({ absent: ["/usr/bin/sandbox-exec", "/usr/bin/log", "/usr/bin/git"] }));
  assert.equal(mac.length, 3);
  assert.match(mac[0] ?? "", /^\/usr\/bin\/sandbox-exec is missing/);
  assert.match(mac[2] ?? "", /^\/usr\/bin\/git does not run .*Fix: xcode-select --install$/);
  // Present, but only a stub: the probe runs it rather than trusting the file.
  assert.match(missingTools("darwin", fakeProbe({ failing: ["/usr/bin/git --version"] }))[0] ?? "", /Fix: xcode-select --install$/);
  // Inside another sandbox, sandbox_apply fails (measured: exit 71).
  assert.deepEqual(missingTools("darwin", fakeProbe({ failing: ["/usr/bin/sandbox-exec -p (version 1)(allow default) /usr/bin/true"] })),
    ["sandbox-exec cannot apply a profile here, most likely because this process already runs inside a sandbox (an agent's, for example). Fix: run pnpm check outside that sandbox"]);
  assert.deepEqual(missingTools("linux", fakeProbe({ absent: ["/usr/bin/strace"] })), ["/usr/bin/strace is missing, so no connection attempt can be seen. Fix: sudo apt-get install -y strace"]);
  assert.match(missingTools("linux", fakeProbe({ absent: ["/usr/bin/unshare"] }))[0] ?? "", /Fix: sudo apt-get install -y util-linux$/);
  assert.match(missingTools("linux", fakeProbe({ absent: ["/bin/ps"] }))[0] ?? "", /^\/bin\/ps is missing, .*Fix: sudo apt-get install -y procps$/);
  assert.deepEqual(missingTools("win32", fakeProbe()), ["there is no offline harness for win32: the brain is staged and gated on macOS and Linux only"]);
});

test("Linux: the gate becomes root only in CI or when asked, and says what the system-wide alternative costs", () => {
  assert.match(namespaceFailure(false), /Fix: FOLIAGE_BRAIN_GATE_SUDO=1 pnpm check, where `sudo -n` works/);
  assert.match(namespaceFailure(false), /turns off that AppArmor protection for every program/);
  assert.match(namespaceFailure(true), /`sudo -n` cannot run unshare without a password\. Fix: run the gate where `sudo -n` works$/);
});

test("a missing vendor/ or harness is red with its cause, never a skip", async t => {
  const root = await mkdtemp(join(tmpdir(), "foliage-gate-no-vendor-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  /** @type {string[]} */
  const said = [];
  for (const platform of ["darwin", "linux"]) {
    said.length = 0;
    assert.equal(await runOfflineGate({ root, platform, probe: fakeProbe(), say: line => said.push(line) }), false);
    assert.deepEqual(said, ["check-brain-offline: RED: no usable staged brain in vendor/ (no brain is staged). Fix: node tools/brain/stage-gbrain.mjs"]);
  }
  said.length = 0;
  assert.equal(await runOfflineGate({ root, platform: "darwin", probe: fakeProbe({ absent: ["/usr/bin/sandbox-exec"] }), say: line => said.push(line) }), false);
  assert.match(said.join("\n"), /^check-brain-offline: RED: \/usr\/bin\/sandbox-exec is missing/);
  said.length = 0;
  assert.equal(await runOfflineGate({ root, platform: "win32", say: line => said.push(line) }), false);
  assert.deepEqual(said, ["check-brain-offline: RED: there is no offline harness for win32: the brain is staged and gated on macOS and Linux only"]);
});

test("each rule has a control: a lookup and a program start everywhere, and on macOS a write under each stand-in owner path", () => {
  const dir = "/synthetic/gate-run";
  assert.deepEqual(controlsFor("linux", "/opt/node", dir).map(control => [control.kind, control.command]), [["network", "/opt/node"], ["program", "/usr/bin/true"]]);
  const mac = controlsFor("darwin", "/opt/node", dir);
  assert.deepEqual(mac.map(control => control.kind), ["network", "owner-write", "owner-write", "program"]);
  for (const write of mac.filter(control => control.kind === "owner-write")) {
    // Never the real home: the stand-ins live in the run's own directory.
    assert.deepEqual(write.owners, [`${dir}/control-owner/.gbrain`, `${dir}/control-owner/brain`]);
    assert.ok(write.args.at(-1)?.includes(`${dir}/control-owner/`));
  }
  // Item 8: with one loopback port allowed, another port and a lookup are each a network control under that profile.
  const embedding = controlsFor("darwin", "/opt/node", dir, { allowed: 4300, other: 4301 }).slice(mac.length);
  assert.deepEqual(embedding.map(control => [control.kind, control.loopback]), [["network", 4300], ["network", 4300]]);
  assert.ok(embedding[0]?.args.at(-1)?.includes("connect(4301, '127.0.0.1')"));
  assert.ok(embedding[1]?.args.at(-1)?.includes("lookup('example.test'"));
  assert.equal(controlsFor("linux", "/opt/node", dir, { allowed: 4300, other: 4301 }).length, 2, "Linux runs no loopback control: item 8 is macOS only");
});

test("the green line names only the phases that ran: item 8 skipped on Linux is NOT RUN, never counted", () => {
  assert.equal(greenScope(PHASES, ["2", "3", "5", "6", "8"]), "build order items 2 to 6 and 8");
  assert.equal(greenScope(PHASES, ["2", "3", "5", "6"]), "build order items 2 to 6 (build order item 8 NOT RUN on this platform)");
  assert.equal(greenScope(["8"], ["8"]), "PARTIAL, only build order item(s) 8 (pnpm check runs every phase)");
  assert.equal(greenScope(["8"], []), "PARTIAL, only build order item(s) none (build order item 8 NOT RUN on this platform) (pnpm check runs every phase)");
  assert.equal(greenScope(["2", "8"], ["2"]), "PARTIAL, only build order item(s) 2 (build order item 8 NOT RUN on this platform) (pnpm check runs every phase)");
});

test("the gate's phases are build order items, all by default; --only names some and refuses anything else", async () => {
  assert.deepEqual(PHASES, ["2", "3", "5", "6", "8"]);
  const script = fileURLToPath(new URL("../../scripts/check-brain-offline.mjs", import.meta.url));
  const refused = spawnSync(process.execPath, [script, "--only", "4"], { encoding: "utf8" });
  assert.deepEqual([refused.status, refused.stdout], [2, ""]);
  assert.match(refused.stderr, /--only takes build order items from 2, 3, 5, 6, 8/);
});

test("a process left from the run is one in a step's group, naming the run's directory, or a new process of the staged bun", () => {
  const dir = "/synthetic/foliage-brain-gate-1";
  const run = { self: 10, dir, groups: new Map([[200, "build"]]), bun: ["/work/vendor/bun/bun"], before: new Set([30]) };
  const rows = [
    { pid: 10, pgid: 200, text: "node scripts/check-brain-offline.mjs" },
    { pid: 201, pgid: 200, text: "/work/vendor/bun/bun -e sleep" },
    { pid: 202, pgid: 202, text: `/work/vendor/bun/bun check-update HOME=${dir}/repo/garden/brain/home` },
    { pid: 203, pgid: 203, text: "/work/vendor/bun/bun --no-install x" },
    { pid: 30, pgid: 30, text: "/work/vendor/bun/bun the developer's own build, running before the gate" },
    { pid: 31, pgid: 31, text: "/work/vendor/bun/bunny something else" },
    { pid: 32, pgid: 32, text: "/usr/bin/vim HOME=/Users/synthetic" },
  ];
  assert.deepEqual(survivorsAmong(rows, run).map(row => row.pid), [201, 202, 203]);
});

test("a process that outlives its step is found by its group or by the run's directory in its environment, listed without its environment, and killed", async t => {
  const dir = await mkdtemp(join(tmpdir(), "foliage-gate-survivor-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // A step that starts two sleepers and ends at once: one stays in the step's process group, the
  // other leaves it (a new session, as gbrain's detached update check does) but keeps an
  // environment naming the run's directory.
  const sleeper = "setTimeout(() => {}, 60000)";
  const step = spawn(process.execPath, ["-e", [
    "const { spawn } = require('node:child_process');",
    `spawn(process.execPath, ['-e', ${JSON.stringify(sleeper)}, 'in-the-group'], { stdio: 'ignore', env: { PATH: '/usr/bin:/bin' } }).unref();`,
    `spawn(process.execPath, ['-e', ${JSON.stringify(sleeper)}, 'own-session'], { stdio: 'ignore', detached: true, env: { PATH: '/usr/bin:/bin', HOME: ${JSON.stringify(join(dir, "home"))} } }).unref();`,
  ].join("\n")], { stdio: "ignore", detached: true, env: { PATH: "/usr/bin:/bin" } });
  await once(step, "exit");
  const run = { self: process.pid, dir, groups: new Map([[step.pid ?? -1, "synthetic step"]]), bun: [], before: new Set() };
  t.after(() => outlived(process.platform, run, { boundMs: 0 }));
  const found = await outlived(process.platform, run, { boundMs: 300, pollMs: 100 });
  assert.deepEqual(found.map(attempt => [attempt.kind, attempt.step, /in-the-group|own-session/.exec(attempt.text)?.[0]]).sort(),
    [["survivor", "synthetic step", "in-the-group"], ["survivor", "this run", "own-session"]]);
  assert.ok(found.every(attempt => /was still running 0 s after the last step, and was killed/.test(attempt.text) && !attempt.text.includes("HOME=")), "listed by arguments only");
  for (let waited = 0; (await outlived(process.platform, run, { boundMs: 0 })).length > 0; waited += 100) {
    assert.ok(waited < 5_000, "the survivors were not killed");
  }
});

test("attempts are reported once per kind of attempt with a count, pids and descriptors aside, and capped", () => {
  const lookup = (/** @type {number} */ pid, /** @type {number} */ fd) => ({ kind: /** @type {const} */ ("network"), step: "build", text: `pid ${pid} a name lookup to 192.0.2.53:53: connect(${fd}, {sa_family=AF_INET}, 16) = -1 ENETUNREACH` });
  assert.deepEqual(reportLines([lookup(1, 14), lookup(2, 19), { kind: "network", step: "build", text: "bun(101) deny(1) network-outbound /private/var/run/mDNSResponder" },
    { kind: "network", step: "build", text: "bun(202) deny(1) network-outbound /private/var/run/mDNSResponder" }, { kind: "owner-write", step: "status", text: "bun(3) deny(1) file-write-create /x" },
    { kind: "survivor", step: "build", text: "pid 7 was still running 10 s after the last step, and was killed: bun -e sleep" }]), [
    "NETWORK ATTEMPT: [build] a name lookup to 192.0.2.53:53: connect(…, {sa_family=AF_INET}, 16) = -1 ENETUNREACH (2 times)",
    "NETWORK ATTEMPT: [build] bun(…) deny(1) network-outbound /private/var/run/mDNSResponder (2 times)",
    "OWNER BRAIN WRITE: [status] bun(…) deny(1) file-write-create /x",
    "OUTLIVED ITS STEP: [build] was still running 10 s after the last step, and was killed: bun -e sleep",
  ]);
  const many = Array.from({ length: 25 }, (_, at) => ({ kind: /** @type {const} */ ("program"), step: `step ${at}`, text: "started /usr/bin/git" }));
  const capped = reportLines(many, 20);
  assert.equal(capped.length, 21);
  assert.equal(capped.at(-1), "... and 5 more distinct attempts");
});
