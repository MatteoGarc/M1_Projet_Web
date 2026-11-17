/**
 * Faux Web Audio pour les tests unitaires (jsdom ne fournit ni
 * `AudioContext`, ni `OfflineAudioContext`, ni `AudioBuffer`).
 *
 * Ces classes n'émettent aucun son : elles ENREGISTRENT ce que le code leur
 * demande (nœuds créés, connexions, `start()`…) pour que les tests puissent
 * vérifier le circuit construit par `take-graph`, `MixPlayer` ou `renderMix`.
 *
 * Fichier utilisé uniquement par les `*.spec.ts` : il n'est jamais importé
 * par l'application, il n'est donc pas inclus dans le bundle.
 */

export class FakeAudioParam {
  readonly events: (readonly [string, number, number])[] = [];

  constructor(public value = 0) {}

  setValueAtTime(value: number, time: number): this {
    this.events.push(['set', value, time]);
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push(['ramp', value, time]);
    return this;
  }
}

export class FakeAudioNode {
  readonly connections: FakeAudioNode[] = [];
  disconnectCount = 0;

  constructor(readonly kind: string) {}

  connect<T extends FakeAudioNode>(node: T): T {
    this.connections.push(node);
    return node;
  }

  disconnect(): void {
    this.disconnectCount++;
    this.connections.length = 0;
  }
}

export class FakeGainNode extends FakeAudioNode {
  readonly gain = new FakeAudioParam(1);
  constructor() {
    super('gain');
  }
}

export class FakeBufferSourceNode extends FakeAudioNode {
  buffer: AudioBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  /** Arguments de `start(when, offset, duration)`, ou `null` si jamais démarrée. */
  started: readonly number[] | null = null;
  stopCount = 0;

  constructor() {
    super('bufferSource');
  }

  start(...args: number[]): void {
    this.started = args;
  }

  stop(): void {
    // Comme le vrai navigateur : arrêter une source jamais démarrée lève une erreur.
    if (!this.started) throw new DOMException('Source jamais démarrée', 'InvalidStateError');
    this.stopCount++;
  }
}

export class FakeBiquadFilterNode extends FakeAudioNode {
  type = 'lowpass';
  readonly frequency = new FakeAudioParam(350);
  constructor() {
    super('biquadFilter');
  }
}

export class FakeWaveShaperNode extends FakeAudioNode {
  curve: Float32Array | null = null;
  oversample = 'none';
  constructor() {
    super('waveShaper');
  }
}

export class FakeDelayNode extends FakeAudioNode {
  readonly delayTime = new FakeAudioParam(0);
  constructor() {
    super('delay');
  }
}

export class FakeConvolverNode extends FakeAudioNode {
  buffer: AudioBuffer | null = null;
  constructor() {
    super('convolver');
  }
}

export class FakeCompressorNode extends FakeAudioNode {
  readonly threshold = new FakeAudioParam(-24);
  readonly knee = new FakeAudioParam(30);
  readonly ratio = new FakeAudioParam(12);
  readonly attack = new FakeAudioParam(0.003);
  readonly release = new FakeAudioParam(0.25);
  constructor() {
    super('compressor');
  }
}

export class FakeAnalyserNode extends FakeAudioNode {
  fftSize = 2048;
  /** Valeur renvoyée par `getFloatTimeDomainData` (niveau du micro simulé). */
  level = 0;
  constructor() {
    super('analyser');
  }

  getFloatTimeDomainData(target: Float32Array): void {
    target.fill(this.level);
  }
}

/**
 * Crée un faux `AudioBuffer` contenant une sinusoïde (pour que la forme
 * d'onde et l'encodeur MP3 aient de vraies valeurs à traiter).
 */
export function fakeAudioBuffer(duration = 1, sampleRate = 8000, numberOfChannels = 2): AudioBuffer {
  const length = Math.max(1, Math.round(duration * sampleRate));
  const channels = Array.from({ length: numberOfChannels }, () => {
    const data = new Float32Array(length);
    for (let i = 0; i < length; i++) data[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    return data;
  });
  const buffer = {
    duration: length / sampleRate,
    sampleRate,
    length,
    numberOfChannels,
    getChannelData: (channel: number): Float32Array => channels[channel],
  };
  return buffer as unknown as AudioBuffer;
}

/** Faux `AudioContext` : horloge contrôlable (`currentTime`) et nœuds enregistrés. */
export class FakeAudioContext {
  currentTime = 0;
  state: 'running' | 'suspended' | 'closed' = 'running';
  sampleRate = 8000;
  readonly destination = new FakeAudioNode('destination');
  /** Tous les nœuds créés, dans l'ordre. */
  readonly nodes: FakeAudioNode[] = [];
  resumeCount = 0;
  /** Fichier renvoyé par `decodeAudioData` (une prise enregistrée). */
  decoded: AudioBuffer = fakeAudioBuffer(1);
  decodeError: Error | null = null;

  createGain(): FakeGainNode {
    return this.track(new FakeGainNode());
  }

  createBufferSource(): FakeBufferSourceNode {
    return this.track(new FakeBufferSourceNode());
  }

  createBiquadFilter(): FakeBiquadFilterNode {
    return this.track(new FakeBiquadFilterNode());
  }

  createWaveShaper(): FakeWaveShaperNode {
    return this.track(new FakeWaveShaperNode());
  }

  createDelay(): FakeDelayNode {
    return this.track(new FakeDelayNode());
  }

  createConvolver(): FakeConvolverNode {
    return this.track(new FakeConvolverNode());
  }

  createDynamicsCompressor(): FakeCompressorNode {
    return this.track(new FakeCompressorNode());
  }

  createAnalyser(): FakeAnalyserNode {
    return this.track(new FakeAnalyserNode());
  }

  createMediaStreamSource(): FakeAudioNode {
    return this.track(new FakeAudioNode('mediaStreamSource'));
  }

  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    return fakeAudioBuffer(length / sampleRate, sampleRate, channels);
  }

  resume(): Promise<void> {
    this.resumeCount++;
    this.state = 'running';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }

  decodeAudioData(): Promise<AudioBuffer> {
    return this.decodeError ? Promise.reject(this.decodeError) : Promise.resolve(this.decoded);
  }

  /** Nœuds d'un type donné (ex. toutes les sources). */
  nodesOf<T extends FakeAudioNode>(type: new () => T): T[] {
    return this.nodes.filter((node): node is T => node instanceof type);
  }

  /** Vue typée pour passer ce faux au code de production. */
  asContext(): AudioContext {
    return this as unknown as AudioContext;
  }

  private track<T extends FakeAudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }
}

/**
 * Faux `OfflineAudioContext` : `startRendering()` renvoie immédiatement un
 * buffer stéréo de la durée demandée. La dernière instance créée est
 * exposée pour inspecter le circuit rendu.
 */
export class FakeOfflineAudioContext extends FakeAudioContext {
  static last: FakeOfflineAudioContext | null = null;

  constructor(
    readonly channels: number,
    readonly length: number,
    sampleRate: number,
  ) {
    super();
    this.sampleRate = sampleRate;
    FakeOfflineAudioContext.last = this;
  }

  startRendering(): Promise<AudioBuffer> {
    return Promise.resolve(fakeAudioBuffer(this.length / this.sampleRate, this.sampleRate, this.channels));
  }
}
