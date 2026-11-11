/*
 * Browser port of the peak channel compressor from the local Benzai Audio
 * 33593f9 clone, src/engine/src/core/engine_rt.cpp and compiler.cpp.
 * Stereo tracks share gain reduction; ORBITAL handles the fader and the 8D render.
 */
const amplitude = db => Math.pow(10, db / 20);
const pole = ms => Math.exp(-1000 / (ms * sampleRate));

class BenzaiOrbitalStrip extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.hold = 0;
    this.reduction = 0;
    this.configure(options.processorOptions);
    this.engagement = this.targetEngagement;
    this.engagementPole = pole(12);
    this.port.onmessage = ({data}) => {
      if (data.type === "config") this.configure(data.value);
    };
  }

  configure({comp = {}} = {}) {
    this.targetEngagement = comp.enabled ? 1 : 0;
    const threshold = comp.threshold ?? -20;
    const knee = comp.knee ?? 6;
    const attack = comp.attack ?? 10;
    const release = comp.release ?? 150;
    this.slope = 1 / (comp.ratio ?? 3) - 1;
    this.threshold = threshold;
    this.halfKnee = knee / 2;
    this.kneeStart = amplitude(threshold - this.halfKnee);
    this.kneeFactor = knee ? this.slope / (2 * knee) : 0;
    this.attackPole = pole(attack);
    this.releasePole = pole(Math.max(release - attack, release / 2));
  }

  process([input], [output]) {
    const [left, right = left] = input;
    if (!left) return true;
    const [outLeft, outRight] = output;
    if (this.engagement === 0 && this.targetEngagement === 0) {
      outLeft.set(left);
      outRight.set(right);
      return true;
    }

    for (let i = 0; i < left.length; i++) {
      const level = Math.max(Math.abs(left[i]), Math.abs(right[i]));
      let desired = 0;
      if (this.targetEngagement && level > this.kneeStart) {
        const over = 20 * Math.log10(level) - this.threshold;
        desired = over >= this.halfKnee
          ? this.slope * over
          : this.kneeFactor * (over + this.halfKnee) ** 2;
      }
      // As in the native peak mode, release the held peak before smoothing attack.
      this.hold = Math.min(desired, desired + this.releasePole * (this.hold - desired));
      this.reduction = this.hold + this.attackPole * (this.reduction - this.hold);
      this.engagement = this.targetEngagement + this.engagementPole * (this.engagement - this.targetEngagement);
      const gain = 1 + this.engagement * (amplitude(this.reduction) - 1);
      outLeft[i] = left[i] * gain;
      outRight[i] = right[i] * gain;
    }
    if (!this.targetEngagement && this.engagement < 1e-6) this.engagement = this.reduction = this.hold = 0;
    return true;
  }
}

registerProcessor("benzai-orbital-strip", BenzaiOrbitalStrip);
