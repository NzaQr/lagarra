import type { MachineState } from "./types";

/** Small synthesized mechanical sounds. Audio starts only after a player gesture. */
export class ArcadeAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private motor: OscillatorNode | null = null;
  private motorGain: GainNode | null = null;
  private muted = false;
  private volume = 0.35;

  unlock() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.context.destination);
      this.motor = this.context.createOscillator();
      this.motor.type = "triangle";
      this.motorGain = this.context.createGain();
      this.motorGain.gain.value = 0;
      this.motor.connect(this.motorGain).connect(this.master);
      this.motor.start();
    }
    if (this.context.state === "suspended")
      void this.context.resume().catch(() => {});
  }

  setMuted(value: boolean) {
    this.muted = value;
    this.updateVolume();
  }
  setVolume(value: number) {
    this.volume = Math.max(0, Math.min(1, value));
    this.updateVolume();
  }
  private updateVolume() {
    if (this.context && this.master)
      this.master.gain.setTargetAtTime(
        this.muted ? 0 : this.volume,
        this.context.currentTime,
        0.025,
      );
  }

  tick(state: MachineState, moving: boolean) {
    if (!this.context || !this.motor || !this.motorGain) return;
    const active =
      moving ||
      ["dropping", "lifting", "transporting", "resetting"].includes(state);
    this.motor.frequency.setTargetAtTime(
      state === "dropping" ? 92 : 120,
      this.context.currentTime,
      0.12,
    );
    this.motorGain.gain.setTargetAtTime(
      active ? 0.028 : 0,
      this.context.currentTime,
      0.08,
    );
  }

  tone(
    frequency: number,
    duration = 0.08,
    delay = 0,
    type: OscillatorType = "sine",
  ) {
    if (!this.context || !this.master) return;
    const time = this.context.currentTime + delay;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, time);
    osc.frequency.exponentialRampToValueAtTime(
      frequency * 0.8,
      time + duration,
    );
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.11, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(gain).connect(this.master);
    osc.start(time);
    osc.stop(time + duration);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  transition(state: MachineState, won: boolean) {
    if (state === "closing") this.tone(220, 0.12, 0, "triangle");
    if (state === "releasing") this.tone(155, 0.09, 0, "triangle");
    if (state === "result") {
      if (won)
        [523, 659, 784, 1047].forEach((note, index) =>
          this.tone(note, 0.24, index * 0.11),
        );
      else this.tone(260, 0.17);
    }
  }

  pause() {
    if (this.context?.state === "running") void this.context.suspend();
  }
  dispose() {
    this.motor?.stop();
    if (this.context) void this.context.close();
  }
}
