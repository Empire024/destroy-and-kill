# MOZA R3 — Force Feedback Feasibility

**Status:** research spike, complete. **No code was written, no HID report was sent to any device.**
**Hardware available for testing:** none. Every claim below is from documentation or third-party
source code. Anything that would need a wheel in front of us to confirm is marked
**[UNVERIFIED]** and stays unverified.

Researched 2026-08-05. Target device: MOZA R3 wheel base — 3.9 N·m peak torque direct drive,
72 W servo, 15-bit encoder, sold in a PC bundle and an Xbox-licensed bundle.

---

## Summary verdict

**Real steering-torque force feedback is not achievable from the game as it exists today, and there
is no standardised browser API that will ever give it to us.** The Gamepad API's
`vibrationActuator` exposes exactly two effects — `"dual-rumble"` and `"trigger-rumble"` — both of
which are eccentric-rotating-mass *vibration*. There is no constant force, no spring, no damper, no
torque axis anywhere in the Gamepad specification, and none is proposed. Two real paths exist.
**WebHID** is the interesting one: MOZA bases are USB HID PID (Physical Interface Device) class
devices, PID is a published USB-IF standard, Chrome's WebHID blocklist does not block the PID usage
page or MOZA's vendor ID, and a Chromium engineer has published a working browser demo that drives
constant force and autocentre on a Logitech G29 via `sendReport()`. But MOZA's PID implementation is
known to deviate from the standard in undocumented ways — the Linux driver that supports the R3
carries per-device quirks precisely because of this — so the remaining gap is exactly the part we
must not guess at on a 3.9 N·m direct-drive motor. **A native companion app** using MOZA's own
published Windows SDK is the only path that is both real and safe, and it costs the browser game its
best property: that it is just a web page. Recommendation: keep the rumble code, relabel it honestly,
build neither.

---

## What the game does today, and why calling it FFB would be wrong

All wheel handling lives in `gta_vice_city_destroy_and_kill_v31.html`:

| Function | Line | What it does |
|---|---|---|
| `wheelHapticActuators(gp)` | 1949 | Collects `gp.vibrationActuator` plus any legacy `gp.hapticActuators[]` |
| `sendWheelHaptic(actuator, strong, weak, duration)` | 1953 | Calls `playEffect('dual-rumble', …)`, falls back to `pulse()` |
| `queueWheelHaptic(strength)` | 1956 | Latches a one-shot impact level, consumed by the update loop |
| `updateWheelHaptics(gp, dt)` | 1964 | Every 92 ms, mixes speed, steering load, tyre slip, limiter and impact into `strong`/`weak` magnitudes |
| `testWheelHaptics()` | 1958 | Setup-screen test button |

`updateWheelHaptics` is genuinely a decent rumble mixer — road buzz scaling with speed, tyre-slip
texture, rev-limiter pulse, crash impacts from `playCrash` (line 1734) and shift clunks from
`playShiftSound` (line 2331). It is a **vibration** channel.

Force feedback on a wheel means the base applies **torque about the steering axis** — the wheel
physically pulls against or with your hands, in a direction, with a magnitude, sustained. That is
what communicates understeer, kerb strike, and self-aligning torque. Rumble is a scalar buzz with no
direction and no sustained load. Labelling the code above as FFB would tell a MOZA owner that the
game does something it cannot do, and it would be the specific wrong thing: on many direct-drive
bases `playEffect('dual-rumble', …)` **resolves its promise and nothing moves**, because the promise
resolves when the browser accepts and schedules the effect, not when a motor produces torque. A
resolved promise is not evidence of hardware output.

The existing UI copy is already close to honest — the checkbox reads
`HAPTICS ONLY (TRUE WHEEL FFB NEEDS A DRIVER)` (line 380) and the failure message at line 1960
correctly says real steering torque needs a device-specific native/WebHID driver. See
[Recommendation](#recommendation) for the small tightenings still worth making.

---

## Avenue 1 — Gamepad API `vibrationActuator`

### Findings

- `GamepadHapticActuator.playEffect()` accepts exactly two effect type strings: `"dual-rumble"` and
  `"trigger-rumble"`. MDN: *"A string representing the desired effect. Possible values are
  `"dual-rumble"` and `"trigger-rumble"`, and their effects can vary depending on the hardware type."*
  Any other string throws a `TypeError`.
- Parameters for both: `duration`, `startDelay`, `strongMagnitude` (0.0–1.0), `weakMagnitude`
  (0.0–1.0); `trigger-rumble` adds `leftTrigger` and `rightTrigger`. All are unsigned magnitudes —
  **there is no sign, therefore no direction, therefore no torque.**
- The older `GamepadHapticActuator.pulse(value, duration)` in the W3C gamepad-extensions draft is the
  same shape: a clamped scalar for a duration.
- The Gamepad specification defines no constant-force, spring, damper, friction, inertia or periodic
  effect, and no steering-torque concept. I found no standards-track proposal to add one.
- Browser support is not the bottleneck here; the API is.

### Verdict

**Dead end for FFB, and permanently so.** This is not a "browsers haven't caught up yet" situation —
the Gamepad API is deliberately scoped to rumble, and force feedback is left to WebHID. Keep the code
as a rumble feature; never present it as force feedback.

---

## Avenue 2 — WebHID and the USB HID PID class

### What PID is

The USB-IF publishes the *Device Class Definition for Physical Interface Devices (PID) 1.0*, the
standard HID protocol for force-feedback joysticks and steering wheels. It defines a common set of
report descriptors, usages and reports for effect blocks — constant force, ramp, spring, damper,
inertia, friction, periodic — plus effect creation, parameter setting, gain and device control. This
is a **published standard**, not folklore. DirectInput's FFB API on Windows is the same model.

### Does MOZA implement PID?

**Yes, substantially — with documented-to-exist but undocumented-in-detail deviations.**

- The Linux `hid-universal-pidff` driver explicitly supports **MOZA R3, R5, R9, R12, R16, R21**. It
  landed in Linux 6.15 and was backported to 6.12.24, 6.13.12 and 6.14.3. A device only works under a
  PID driver if it speaks PID.
- Its README is blunt about the caveat: *"Most of the DirectDrive wheelbases are basically DirectInput
  wheels, but with some caveats, which Windows allows, but pidff doesn't."* The driver exists to add
  *"multiple quirks for better initialization rules for different wheelbases"*, *"fixes for
  infinite-length effects"* and *"fixes for out-of-bounds values"*.
- MOZA's own GitHub organisation publishes `directInput_demo` (MIT licensed), a C++/Qt program that
  drives a MOZA base with a **DirectInput8 ConstantForce effect** — MOZA endorsing the DirectInput/PID
  model for their hardware.

So the protocol family is standard and public. What is *not* public is which quirks the R3 needs, its
exact report-descriptor layout, its gain/torque-scaling semantics, and its initialisation sequence.

### Can a browser reach it?

The pieces that can be checked without hardware all check out:

- **WebHID is available** in Chrome 89+, Edge 89+ and Opera 76+ on desktop. Not in Firefox, not in
  Safari, not on mobile. Windows is supported.
- **Nothing relevant is blocklisted.** The WICG blocklist blocks FIDO (`usagePage 0xF1D0`), mouse and
  keyboard usages, system control, and a couple of vendor-specific entries. It contains **no entry for
  usage page 0x0F (Physical Interface Device) and no entry for MOZA's vendor ID.** Chrome
  additionally refuses any top-level collection with a protected usage — keyboard, mouse, pointer,
  system multi-axis — but joystick and gamepad usages are not on that list.
- **`sendReport()` to a wheel demonstrably works in a browser.** Matt Reynolds (`nondebug`), the
  Chromium engineer behind WebHID, publishes `g29-wheel-demo`: a WebHID page that calls
  `navigator.hid.requestDevice()` and `device.sendReport(…)` to set **constant force** and
  **autocentre** on a Logitech G29 across multiple effect slots. Existence proof that browser →
  wheel → torque is architecturally possible.

Two important qualifications on that existence proof: the G29 uses **Logitech's proprietary protocol,
not PID**, so it says nothing about MOZA's report layout; and the repo has a two-line README with no
documentation of where the byte formats came from.

### What is unverified, and cannot be verified without hardware

- **[UNVERIFIED]** Whether Chrome's WebHID picker even lists the MOZA R3, and what its top-level
  collection usages are.
- **[UNVERIFIED]** Whether the R3's PID collection is reachable on the same HID interface WebHID
  opens, or sits behind a vendor-specific interface that the MOZA driver claims.
- **[UNVERIFIED]** Whether the MOZA driver or Pit House holds the device in a way that makes
  `sendReport()` fail. WebHID `sendReport()` failure modes are real and reported: `NotAllowedError`
  on protected collections, *"This device does not support output reports"* and *"Output report
  buffer too long"* intermittently in Chrome 117–120 (WICG/webhid#118).
- **[UNVERIFIED]** Which of the `hid-universal-pidff` quirks the R3 specifically requires, and what
  the correct torque scaling is.
- **[UNVERIFIED]** Whether the Xbox-licensed R3 bundle in Xbox mode is visible to WebHID at all —
  Xbox-licensed peripherals typically speak Microsoft's GIP protocol rather than plain HID.

### Why we will not attempt undocumented reports

**We stop here, and the reason is physical safety, not caution theatre.**

The R3 is a 3.9 N·m direct-drive base. There is no belt, no clutch, no slipping gearset between the
motor and the user's wrists. A malformed PID effect block, a wrong gain byte, a mis-set duration on
an infinite-length effect, or an effect left running after page unload can mean sustained or sudden
full torque with someone's hands on the rim. `hid-universal-pidff` needing explicit fixes for
"infinite-length effects" and "out-of-bounds values" is direct evidence that these failure modes
occur in practice on this device family.

Therefore, for this project:

1. **No HID report will be sent to any device** as part of this spike. None was.
2. **No byte sequence from a forum post, a Discord, a Reddit thread, or a reverse-engineering
   write-up is acceptable input.** Those are unverified claims about a device we cannot test, not
   documentation. Treating them as documentation is how you write a full-torque bug. This holds even
   when the post is confident, upvoted, or accompanied by a video.
3. If this is ever revisited with hardware present, the prerequisites are: a MOZA-published or
   USB-IF-published report mapping for this specific base; a hard clamp on commanded torque well
   below device maximum; a bounded effect duration with a watchdog; a guaranteed device-reset on
   `pagehide`/`visibilitychange`/disconnect; and a human with a hand near the power switch, not on the
   rim, for the first run.

### Verdict

**Technically plausible, practically blocked.** The standard is public, the browser API is open, the
blocklist permits it, and the precedent exists — but the device-specific mapping we would need is
undocumented, and guessing it is exactly the class of mistake that hurts someone. Not attempted.

---

## Avenue 3 — Native companion app (proposed, **NOT implemented**)

This is what every browser-based sim that has real FFB actually does.

### Architecture

```
  ┌───────────────────────── User's PC (Windows) ─────────────────────────┐
  │                                                                       │
  │   BROWSER TAB                          NATIVE HELPER (tray app)       │
  │   ┌────────────────────────┐           ┌──────────────────────────┐   │
  │   │ cargame page           │           │ localhost WebSocket srv  │   │
  │   │                        │           │   ws://127.0.0.1:PORT    │   │
  │   │ physics step ──────────┼──────────►│ - origin allowlist       │   │
  │   │  computes desired      │  ~60 Hz   │ - one-time pairing token │   │
  │   │  torque + spring +     │  JSON or  │ - CLAMP  |torque| <= MAX │   │
  │   │  damper                │  binary   │ - slew-rate limit        │   │
  │   │                        │           │ - watchdog: no packet    │   │
  │   │                        │◄──────────┤   for 250 ms => zero     │   │
  │   │ status / capability    │  status   └────────────┬─────────────┘   │
  │   │                        │                        │                 │
  │   │ Gamepad API ◄──────────┼── steering/pedal       │ MOZA Racing SDK │
  │   │  (inputs unchanged)    │   axes still read      │ (C++ or C#)     │
  │   └────────────────────────┘   by the browser       │   or            │
  │            ▲                                        │ DirectInput8    │
  │            │                                        ▼                 │
  │            │                              ┌──────────────────────┐    │
  │            └──── USB HID input ───────────┤ MOZA driver / Pit    │    │
  │                                           │ House → R3 wheelbase │    │
  │                                           └──────────────────────┘    │
  └───────────────────────────────────────────────────────────────────────┘
```

Inputs keep flowing through the existing Gamepad API path — the helper is output-only. `updateWheelHaptics`
would gain a sibling that posts a torque vector to the socket, gated on the helper being present.

### Honest cost/benefit

**Costs**

- **The user must download, trust, install and run a native binary** to play a web game. That is the
  whole cost, and it is large. Realistically it means code signing, a SmartScreen reputation problem
  for the first few thousand downloads, and a support burden.
- **Windows only.** The MOZA SDK ships native C++ libraries for MSVC2022 (32- and 64-bit) plus a C#
  (.NET) binding. No macOS, no Linux, no browser build.
- **Driver dependency.** Requires the MOZA driver/Pit House stack; breaks when MOZA changes it.
- **A localhost WebSocket is a security surface.** Any page the user visits can attempt to connect to
  `127.0.0.1:PORT`. A server that can command torque on a direct-drive motor must therefore do origin
  checking *and* token pairing, and still clamp server-side — never trust the magnitude the page sent.
- **[UNVERIFIED]** Mixed-content friction: an `https://` page connecting to `ws://127.0.0.1` may be
  blocked. Workarounds exist (serve the game from `http://localhost`, have the helper serve the game,
  or terminate `wss://` with a locally trusted cert) but each adds installation complexity. Confirm
  current Chrome behaviour before designing around it.
- **Maintenance.** A second language, a second build, a second release channel, for one peripheral
  brand.

**Benefits**

- Real, correct, directional steering torque with the six effect types MOZA exposes.
- Safety clamping lives in code we control, in the process closest to the hardware.
- The SDK path is vendor-supported, so no guessing at bytes — the entire Avenue 2 objection disappears.

### Verdict

**The only path that is both real and safe — and out of proportion to this project.** Documented, not
built.

---

## Official MOZA SDK availability

MOZA does publish an SDK, and it is more capable than expected.

- **<https://mozaracing.com/pages/sdk>** — the MOZA SDK page. The Racing SDK is described as providing
  access to the device parameter API and **six force feedback effects: Constant Force, Spring, Damper,
  Inertia, Friction and Sine**, each fully parameterisable. Delivery is *"Native C++ libraries for
  MSVC2022 (32-bit and 64-bit) plus a C# (.NET) binding with AnyCPU, x86, and x64 builds."*
  Direct download link on the page:
  `https://cdn.gudsen.vip/simulation_game/rs21repository/installer/MOZA_SDK.zip`
  (no version number shown). A separate MOZA Flight SDK 1.0.0.4 is also listed.
  - **No web or browser support is mentioned anywhere on the page.**
  - **[UNVERIFIED]** No licence text, terms of use, or redistribution terms appear on the page, and
    no API reference is linked — documentation appears to be bundled in the zip. **Read the licence
    inside the archive before assuming this SDK may be shipped with a game.** I did not download it.
- **<https://mozaracing.com/eu/moza-sdk/>** — appeared in search results but returned **HTTP 404**
  when fetched. Use the `/pages/sdk` URL.
- **<https://github.com/MOZA-Racing>** — MOZA's GitHub organisation, two public repositories:
  - **`directInput_demo`** (MIT, ~7 stars, last updated Feb 2023) — C++/CMake/Qt demo driving a MOZA
    R16 via **DirectInput8**. Implements a ConstantForce effect *"with a period of 1 second and a
    duration of 2.5 periods. The maximum torque of the force effect is 10% of the maximum torque of
    the target Device"* — note that MOZA's own demo caps itself at 10% torque. It shows the full
    `EnumDevices` → `CreateDevice` → `CreateEffect` → `SetParameters` workflow. This is the closest
    thing to official FFB documentation MOZA publishes, and it points at DirectInput rather than at
    a proprietary API.
  - **`pit_house_l10n`** — localisation strings for Pit House. Not relevant.
- **<https://support.mozaracing.com/>** — support portal with a developer/SDK discussion forum. The
  R3 support article covers consumer specs and Pit House only; **no developer or SDK content, and no
  HID protocol documentation.**

**Bottom line:** MOZA supports developers, on Windows, in C++ or C#, via a downloadable SDK and a
DirectInput demo. They publish **nothing** for the browser, and **no raw HID report documentation**.

---

## Recommendation

**1. Keep the rumble code. Do not delete it.** It is a real feature that works on wheels and pads that
expose a vibration actuator, and the mixer in `updateWheelHaptics` is decent. Deleting it removes
working functionality to fix a naming problem.

**2. Relabel so nothing in the UI implies torque.** The current copy is already mostly honest; tighten
these:

- Line 380 — `HAPTICS ONLY (TRUE WHEEL FFB NEEDS A DRIVER)` → drop "FFB" and say plainly what it is,
  e.g. `WHEEL RUMBLE (VIBRATION ONLY — NOT FORCE FEEDBACK)`.
- Line 1899 — the `INPUT ONLY · NO BROWSER FFB/HAPTICS` status still uses "FFB". Say
  `INPUT ONLY · NO RUMBLE MOTOR EXPOSED`. Browsers cannot deliver FFB to any wheel, so mentioning it
  as something this device lacks is misleading.
- Line 1960's message is good and should stay in spirit; it is currently the only place that tells
  the truth about steering torque.
- Consider one line of setup-screen copy: *"Browsers can send vibration, not steering torque. Real
  force feedback needs MOZA's own software or a native driver."*

**3. Do not implement Avenue 2 or Avenue 3.** Avenue 2 requires guessing undocumented commands for a
3.9 N·m direct-drive motor — refused on safety grounds. Avenue 3 is sound engineering but would make
a zero-install web game require a signed Windows binary, for one brand of peripheral, on a task the
project itself ranks lowest.

**4. If FFB is ever genuinely wanted**, the order is: download the MOZA SDK, read its licence and API
reference, prototype against the SDK (not raw HID), and only then decide whether the localhost-helper
cost is worth paying. With hardware present and a torque clamp in place from the first line of code.

---

## Sources

| Source | What it actually said |
|---|---|
| [MDN — `GamepadHapticActuator.playEffect()`](https://developer.mozilla.org/en-US/docs/Web/API/GamepadHapticActuator/playEffect) | Only `"dual-rumble"` and `"trigger-rumble"` are valid; params are `duration`, `startDelay`, `strongMagnitude`, `weakMagnitude`, plus `leftTrigger`/`rightTrigger`. Anything else throws `TypeError`. No force/spring/damper effect. |
| [MDN — `GamepadHapticActuator`](https://developer.mozilla.org/en-US/docs/Web/API/GamepadHapticActuator) | `effects` returns supported effect types; example uses `dual-rumble`. |
| [W3C Gamepad Extensions](https://w3c.github.io/gamepad/extensions.html) | Defines `pulse(value, duration)` — a clamped scalar for a duration. No effect-type enum with force effects. |
| [USB-IF HID specifications](https://www.usb.org/hid) | *Device Class Definition for PID 1.0* is the standard for Physical Interface Devices "including force feedback joysticks, steering wheels", giving a common set of report descriptors, usages and reports. |
| [WICG WebHID blocklist](https://github.com/WICG/webhid/blob/main/blocklist.txt) | Blocks FIDO (`0xF1D0`), mouse/keyboard usages, system control, and two vendor entries. **No entry for usage page 0x0F (PID) and none for MOZA's vendor ID.** |
| [Chrome for Developers — Connect to uncommon HID devices](https://developer.chrome.com/docs/capabilities/hid) | Chrome inspects top-level collection usages; protected usages (keyboard, mouse) block all reports in that collection. FIDO devices blocked. Output reports sent via `device.sendReport(reportId, bytes)`. Permission model grants one device at a time via user-driven picker. |
| [MDN — WebHID API](https://developer.mozilla.org/en-US/docs/Web/API/WebHID_API) | WebHID in Chrome 89+, Edge 89+, Opera 76+ desktop. Not Firefox, not Safari, not mobile. |
| [MDN — `HIDDevice.sendReport()`](https://developer.mozilla.org/en-US/docs/Web/API/HIDDevice/sendReport) | Sends an output report; throws `NotAllowedError` if sending fails for any reason. |
| [WICG/webhid issue #118](https://github.com/WICG/webhid/issues/118) | Intermittent output-report failures — "Output report buffer too long" / "This device does not support output reports" — on Chrome 117, 118, 120, persisting until browser restart. |
| [nondebug/g29-wheel-demo](https://github.com/nondebug/g29-wheel-demo) | WebHID page by Matt Reynolds (Chromium, WebHID implementer) using `navigator.hid.requestDevice()` and `device.sendReport()` to set constant force and autocentre on a Logitech G29 across effect slots. **Logitech proprietary protocol, not PID.** README is two lines — no docs, no provenance for the byte formats. |
| [JacKeTUs/universal-pidff](https://github.com/JacKeTUs/universal-pidff) | Linux PID FFB driver supporting **MOZA R3, R5, R9, R12, R16, R21**. README: *"Most of the DirectDrive wheelbases are basically DirectInput wheels, but with some caveats, which Windows allows, but pidff doesn't."* Adds per-device init quirks, fixes for infinite-length effects and out-of-bounds values. |
| [Phoronix — hid-universal-pidff](https://www.phoronix.com/news/Linux-hid-universal-pidff) | Driver landed in Linux 6.15; backported to 6.12.24, 6.13.12, 6.14.3. Extends generic PID driver for "slightly non-compliant" USB PID devices and improves fuzz/flat on high-precision direct-drive devices. |
| [MOZA SDK page](https://mozaracing.com/pages/sdk) | Racing SDK: device parameter API + six FFB effects (Constant Force, Spring, Damper, Inertia, Friction, Sine). Native C++ for MSVC2022 x86/x64 plus C# (.NET). Direct zip download, no version, **no licence text, no linked API docs, no web/browser support.** |
| [MOZA-Racing GitHub org](https://github.com/MOZA-Racing) | Two public repos: `directInput_demo`, `pit_house_l10n`. |
| [MOZA-Racing/directInput_demo](https://github.com/MOZA-Racing/directInput_demo) | MIT-licensed C++/CMake/Qt demo. Uses **DirectInput8**, not a proprietary MOZA API. ConstantForce effect on an R16, self-capped at *"10% of the maximum torque of the target Device"*. Shows `EnumDevices` → `CreateDevice` → `CreateEffect` → `SetParameters`. |
| [MOZA R3 support article](https://support.mozaracing.com/en/support/solutions/articles/70000668605-moza-r3-wheel-base-support) | PC bundle and Xbox Series X\|S / Xbox One + PC bundle. 3.9 N·m peak, 1000 Hz USB. Pit House for configuration. **No developer/SDK/HID content.** |
| [MOZA R3 product page](https://mozaracing.com/products/r3-racing-bundle-pc) | 3.9 N·m direct drive, 72 W servo, 15-bit encoder, 1000 Hz USB. |
| `https://mozaracing.com/eu/moza-sdk/` | Appeared in search results; **returned HTTP 404** on fetch. Not a usable source. |

### Note on source hygiene

Search results surfaced forum threads and hobbyist write-ups containing claimed HID byte sequences for
various wheels. **None of those were used, and none should be.** They are unverified claims about
hardware nobody on this project can test, and acting on them would mean commanding an unclamped
direct-drive motor from guessed data. Only vendor documentation, published standards, and
upstream-kernel or Chromium-engineer source code were treated as evidence here — and even those are
labelled above with what they do and do not establish for the R3 specifically.
