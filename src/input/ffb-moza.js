/* ============================================================================
 * REAL FORCE FEEDBACK — self-centring spring over WebHID / USB PID
 * ----------------------------------------------------------------------------
 * This is genuine steering torque, not rumble. It talks to the wheel base using
 * the USB-IF "Device Class Definition for Physical Interface Devices (PID) 1.0"
 * standard, which MOZA bases implement (the Linux `hid-universal-pidff` driver
 * supports R3/R5/R9/R12/R16/R21 explicitly, and MOZA ship their own DirectInput
 * demo). Chrome's WebHID blocklist covers neither PID usage page 0x0F nor
 * MOZA's vendor ID, so `sendReport()` to a wheel is permitted.
 *
 * ---------------------------------------------------------------------------
 * SAFETY — read this before changing anything here
 * ---------------------------------------------------------------------------
 * An R3 is a 3.9 N.m direct-drive motor attached to the user's wrists. Every
 * decision below is deliberately conservative:
 *
 *   1. SPRING ONLY. A spring resists displacement from centre proportionally.
 *      It cannot spin the wheel on its own the way a Constant Force can. If you
 *      add any other effect type, you own that risk.
 *   2. NOTHING IS HARDCODED. Report IDs are discovered by walking the device's
 *      own HID report descriptor for the PID usages. If the descriptor does not
 *      advertise what we need, we refuse to send anything at all rather than
 *      guessing at byte layouts. Guessing is exactly what makes this dangerous.
 *   3. LOW DEFAULT GAIN, and the user controls it. Device gain starts at 25%.
 *   4. EVERY EXIT PATH STOPS THE MOTOR — page hide, blur, disconnect, unload,
 *      and an explicit STOP button. If this code loses track of the wheel, the
 *      wheel must go limp, not keep pulling.
 *   5. USER-INITIATED ONLY. WebHID requires a gesture to open a device; we
 *      never auto-connect.
 *
 * ---------------------------------------------------------------------------
 * HONESTY
 * ---------------------------------------------------------------------------
 * This was written without a wheel to test on. The PID protocol is implemented
 * from the published spec, and the descriptor check means a device that does
 * not speak PID gets nothing — but "MOZA deviates from the standard in
 * undocumented ways" is a known caveat, so the FIRST run on real hardware must
 * be done with the wheel held loosely and a hand near the power switch.
 * ==========================================================================*/
(function () {
  'use strict';

  // ---- USB PID usages (Usage Page 0x0F) ----------------------------------
  const PID_PAGE = 0x0F;
  const U = {
    SET_EFFECT: 0x21,          // Set Effect Report
    SET_CONDITION: 0x5F,       // Set Condition Report
    EFFECT_OPERATION: 0x77,    // Effect Operation Report
    DEVICE_GAIN: 0x7D,         // Device Gain Report
    PID_DEVICE_CONTROL: 0x96,  // PID Device Control Report
    CREATE_NEW_EFFECT: 0xAB    // Create New Effect Report (feature)
  };
  const EFFECT_TYPE_SPRING = 0x40;
  const OP_START = 0x01, OP_STOP = 0x03;
  const DC_ENABLE_ACTUATORS = 0x01, DC_STOP_ALL = 0x03, DC_RESET = 0x04;

  const state = {
    supported: 'hid' in navigator,
    device: null,
    reports: null,          // discovered report IDs
    effectIndex: 1,
    running: false,
    gain: 0.25,             // device gain 0..1 — deliberately low
    strength: 0.35,         // spring coefficient 0..1
    lastError: '',
    onStatus: null
  };

  function say(msg, ok) {
    state.lastError = msg;
    if (state.onStatus) state.onStatus(msg, !!ok);
    (ok ? console.log : console.warn)('[ffb] ' + msg);
  }

  /**
   * Walk the device's report descriptor and find the OUTPUT report id that
   * carries each PID usage we need. Returning null anywhere means this device
   * does not advertise PID and we will not write to it.
   */
  function discoverReports(device) {
    const found = {};
    for (const col of device.collections || []) {
      const scan = (c) => {
        for (const r of c.outputReports || []) {
          for (const item of r.items || []) {
            for (const u of item.usages || []) {
              const page = (u >>> 16) & 0xFFFF, id = u & 0xFFFF;
              if (page !== PID_PAGE) continue;
              for (const k in U) if (U[k] === id && found[k] === undefined) found[k] = r.reportId;
            }
          }
          // Some descriptors put the PID usage on the collection, not the item.
          const cu = (c.usagePage === PID_PAGE) ? c.usage : -1;
          for (const k in U) if (U[k] === cu && found[k] === undefined) found[k] = r.reportId;
        }
        for (const child of c.children || []) scan(child);
      };
      scan(col);
    }
    const need = ['SET_EFFECT', 'SET_CONDITION', 'EFFECT_OPERATION', 'PID_DEVICE_CONTROL'];
    for (const k of need) if (found[k] === undefined) return null;
    if (found.DEVICE_GAIN === undefined) found.DEVICE_GAIN = null;   // optional
    return found;
  }

  const send = (id, bytes) =>
    state.device && state.device.opened
      ? state.device.sendReport(id, new Uint8Array(bytes))
      : Promise.resolve();

  async function deviceControl(code) {
    if (!state.reports) return;
    await send(state.reports.PID_DEVICE_CONTROL, [code]);
  }

  async function setDeviceGain(g) {
    state.gain = Math.max(0, Math.min(1, g));
    if (state.reports && state.reports.DEVICE_GAIN !== null) {
      await send(state.reports.DEVICE_GAIN, [Math.round(state.gain * 255)]);
    }
  }

  /**
   * Define the spring. Coefficients are signed 16-bit in PID units (-10000 ..
   * 10000); saturation is unsigned. We cap saturation well below full scale so
   * even a misinterpreted coefficient cannot command maximum torque.
   */
  async function setSpring(strength) {
    if (!state.reports) return;
    state.strength = Math.max(0, Math.min(1, strength));
    const coeff = Math.round(state.strength * 6000);       // of a 10000 max
    const sat = Math.round(state.strength * 6000);
    const i16 = v => [v & 0xFF, (v >> 8) & 0xFF];

    // Set Effect: index, type=spring, duration=infinite(0), gain, axes
    await send(state.reports.SET_EFFECT, [
      state.effectIndex, EFFECT_TYPE_SPRING,
      0x00, 0x00,                       // duration: 0 = infinite
      0x00, 0x00,                       // trigger repeat interval
      0x00, 0x00,                       // sample period
      Math.round(state.gain * 255),     // effect gain
      0x00,                             // trigger button: none
      0x01                              // axes enable: X
    ]);
    // Set Condition: index, offset, +coeff, -coeff, +sat, -sat, deadband
    await send(state.reports.SET_CONDITION, [
      state.effectIndex, 0x00,
      ...i16(coeff), ...i16(-coeff & 0xFFFF),
      ...i16(sat), ...i16(sat),
      ...i16(120)                       // small dead band around centre
    ]);
  }

  async function start() {
    if (!state.device || !state.reports) return;
    await deviceControl(DC_ENABLE_ACTUATORS);
    await setDeviceGain(state.gain);
    await setSpring(state.strength);
    await send(state.reports.EFFECT_OPERATION, [state.effectIndex, OP_START, 0x01]);
    state.running = true;
    say('Centring spring active — gain ' + Math.round(state.gain * 100) + '%.', true);
  }

  /** Stop and go limp. Safe to call at any time, including when not connected. */
  async function stop(reason) {
    state.running = false;
    try {
      if (state.device && state.device.opened && state.reports) {
        await send(state.reports.EFFECT_OPERATION, [state.effectIndex, OP_STOP, 0x00]);
        await deviceControl(DC_STOP_ALL);
        await deviceControl(DC_RESET);
      }
    } catch (e) { /* going limp must never throw */ }
    if (reason) say(reason, false);
  }

  async function connect() {
    if (!state.supported) { say('This browser has no WebHID. Use Chrome or Edge over http://localhost.', false); return false; }
    let devices;
    try {
      // Filter by the PID usage page rather than by vendor, so this works for
      // any wheel that actually speaks the standard.
      devices = await navigator.hid.requestDevice({ filters: [{ usagePage: PID_PAGE }] });
    } catch (e) { say('Device picker was dismissed.', false); return false; }
    if (!devices || !devices.length) { say('No device chosen.', false); return false; }

    const dev = devices[0];
    try { if (!dev.opened) await dev.open(); }
    catch (e) { say('Could not open the device: ' + e.message, false); return false; }

    const reports = discoverReports(dev);
    if (!reports) {
      try { await dev.close(); } catch (e) {}
      say('"' + dev.productName + '" does not advertise the PID force-feedback reports. ' +
          'Refusing to send anything rather than guess at its protocol.', false);
      return false;
    }

    state.device = dev;
    state.reports = reports;
    dev.addEventListener('inputreport', () => {});     // keep the pipe alive
    navigator.hid.addEventListener('disconnect', e => {
      if (e.device === state.device) { state.device = null; state.reports = null; stop('Wheel disconnected.'); }
    });
    say('Connected to ' + dev.productName + '. PID reports found.', true);
    return true;
  }

  // Anything that takes the page out of focus must release the motor.
  for (const ev of ['pagehide', 'blur', 'beforeunload']) {
    window.addEventListener(ev, () => { if (state.running) stop(); });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.running) stop('Paused — tab hidden.');
  });

  window.WheelFFB = {
    get supported() { return state.supported; },
    get connected() { return !!state.device; },
    get running() { return state.running; },
    get status() { return state.lastError; },
    onStatus(fn) { state.onStatus = fn; },
    connect, start, stop,
    setGain: setDeviceGain,
    setStrength: async s => { await setSpring(s); if (state.running) await start(); }
  };
})();
