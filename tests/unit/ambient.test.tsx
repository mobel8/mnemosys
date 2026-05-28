/**
 * Tests for the context ambient-sound generator (Vague 18).
 *
 * Targets:
 *  - `createAmbient` returns a controller with `start` / `stop` / `kind`
 *  - with a richer AudioContext mock, `start()` builds a looping buffer source
 *    and `stop()` tears it down (stops the source + closes the context)
 *  - `fillNoiseBuffer` fills every sample within the normalised [-1, 1] range
 *
 * We don't assert on the *spectrum* of the noise — that's a property of the
 * Web Audio runtime we don't have in jsdom — only that the graph is wired and
 * released without throwing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAmbient, fillNoiseBuffer } from "@/lib/ambient";

// --- A fuller AudioContext mock than tests/setup.ts provides, so we can spy
//     on the buffer-source lifecycle the ambient generator drives. ----------

const startSpy = vi.fn();
const stopSpy = vi.fn();
const closeSpy = vi.fn();
let createBufferSourceCalls = 0;

class FakeAudioParam {
  value = 0;
}
class FakeAudioNode {
  connect(target: unknown) {
    return target;
  }
  disconnect() {}
}
class FakeBufferSource extends FakeAudioNode {
  buffer: unknown = null;
  loop = false;
  start = startSpy;
  stop = stopSpy;
}
class FakeGain extends FakeAudioNode {
  gain = new FakeAudioParam();
}
class FakeBiquad extends FakeAudioNode {
  type = "lowpass";
  frequency = new FakeAudioParam();
}
class FakeOscillator extends FakeAudioNode {
  frequency = new FakeAudioParam();
  start() {}
  stop() {}
}
class FakeBuffer {
  private channel: Float32Array;
  constructor(length: number) {
    this.channel = new Float32Array(length);
  }
  getChannelData() {
    return this.channel;
  }
}
class RichAudioContext {
  state: AudioContextState = "running";
  currentTime = 0;
  sampleRate = 44100;
  destination = new FakeAudioNode();
  createBuffer(_channels: number, length: number) {
    return new FakeBuffer(length) as unknown as AudioBuffer;
  }
  createBufferSource() {
    createBufferSourceCalls += 1;
    return new FakeBufferSource() as unknown as AudioBufferSourceNode;
  }
  createGain() {
    return new FakeGain() as unknown as GainNode;
  }
  createBiquadFilter() {
    return new FakeBiquad() as unknown as BiquadFilterNode;
  }
  createOscillator() {
    return new FakeOscillator() as unknown as OscillatorNode;
  }
  close() {
    this.state = "closed";
    closeSpy();
    return Promise.resolve();
  }
}

beforeEach(() => {
  startSpy.mockReset();
  stopSpy.mockReset();
  closeSpy.mockReset();
  createBufferSourceCalls = 0;
  vi.stubGlobal("AudioContext", RichAudioContext as unknown as typeof AudioContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createAmbient", () => {
  it("returns a controller exposing start, stop and kind", () => {
    const controller = createAmbient("white");
    expect(typeof controller.start).toBe("function");
    expect(typeof controller.stop).toBe("function");
    expect(controller.kind).toBe("white");
  });

  it("returns an inert no-op controller for 'none'", () => {
    const controller = createAmbient("none");
    expect(controller.kind).toBe("none");
    // start/stop must not throw and must not touch the (mocked) AudioContext.
    controller.start();
    controller.stop();
    expect(createBufferSourceCalls).toBe(0);
  });

  it("builds a looping buffer source on start and releases it on stop", () => {
    const controller = createAmbient("pink");
    controller.start();
    expect(createBufferSourceCalls).toBe(1);
    expect(startSpy).toHaveBeenCalledTimes(1);

    controller.stop();
    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("start is idempotent (does not stack sources)", () => {
    const controller = createAmbient("brown");
    controller.start();
    controller.start();
    expect(createBufferSourceCalls).toBe(1);
    controller.stop();
  });
});

describe("fillNoiseBuffer", () => {
  it.each(["white", "pink", "brown", "rain"] as const)(
    "fills %s noise within the normalised range",
    (kind) => {
      const data = new Float32Array(2048);
      fillNoiseBuffer(data, kind);
      // Not all-zero (it actually wrote something)...
      expect(data.some((v) => v !== 0)).toBe(true);
      // ...and stays within a sane amplitude band (allow a little headroom).
      for (const v of data) {
        expect(Math.abs(v)).toBeLessThanOrEqual(1.5);
      }
    },
  );
});
