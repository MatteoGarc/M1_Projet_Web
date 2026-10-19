import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, NgZone, signal, viewChild } from '@angular/core';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './shader-source';

const FRAME_INTERVAL = 1000 / 30;
const MAX_PIXELS = 2_000_000;

@Component({
  selector: 'app-shader-background',
  templateUrl: './shader-background.html',
  styleUrl: './shader-background.css',
})
export class ShaderBackgroundComponent {
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly zone = inject(NgZone);
  readonly reducedMotion = signal(false);
  readonly enabled = signal(true);
  readonly available = signal(false);
  readonly animated = computed(() => this.enabled() && !this.reducedMotion() && this.available());
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private readonly shaders: WebGLShader[] = [];
  private timeLocation: WebGLUniformLocation | null = null;
  private resolutionLocation: WebGLUniformLocation | null = null;
  private observer?: ResizeObserver;
  private motion?: MediaQueryList;
  private frame: number | null = null;
  private lastFrame: number | null = null;
  private elapsed = 0;
  private hasSize = false;
  private failed = false;

  constructor() {
    afterNextRender(() => this.zone.runOutsideAngular(() => this.initialize()));
    inject(DestroyRef).onDestroy(() => {
      this.stop();
      this.observer?.disconnect();
      this.motion?.removeEventListener('change', this.onMotionChange);
      document.removeEventListener('visibilitychange', this.syncAnimation);
      this.canvas().nativeElement.removeEventListener('webglcontextlost', this.onContextLost);
      this.releaseResources();
    });
  }

  toggle(): void {
    this.enabled.update((value) => !value);
    this.zone.runOutsideAngular(this.syncAnimation);
  }

  private initialize(): void {
    if (typeof window.matchMedia !== 'function') {
      this.fail(new Error('Préférences de mouvement indisponibles'));
      return;
    }
    this.motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion.set(this.motion.matches);
    this.motion.addEventListener('change', this.onMotionChange);
    document.addEventListener('visibilitychange', this.syncAnimation);
    const canvas = this.canvas().nativeElement;
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    try {
      this.gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false });
      const gl = this.gl;
      if (!gl) throw new Error('WebGL indisponible');
      this.program = gl.createProgram();
      if (!this.program) throw new Error('Programme WebGL indisponible');
      for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX_SHADER], [gl.FRAGMENT_SHADER, FRAGMENT_SHADER]] as const) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error('Shader WebGL indisponible');
        this.shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          throw new Error(gl.getShaderInfoLog(shader) ?? 'Compilation GLSL impossible');
        }
        gl.attachShader(this.program, shader);
      }
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(this.program) ?? 'Liaison GLSL impossible');
      }
      gl.useProgram(this.program);
      this.buffer = gl.createBuffer();
      if (!this.buffer) throw new Error('Buffer WebGL indisponible');
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(this.program, 'position');
      if (position < 0) throw new Error('Attribut position introuvable');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      this.timeLocation = gl.getUniformLocation(this.program, 'iTime');
      this.resolutionLocation = gl.getUniformLocation(this.program, 'iResolution');
      if (this.timeLocation === null || this.resolutionLocation === null) throw new Error('Uniformes GLSL introuvables');
      this.available.set(true);
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(canvas);
      this.resize();
    } catch (error: unknown) {
      this.fail(error);
    }
  }

  private resize(): void {
    const canvas = this.canvas().nativeElement;
    const { width, height } = canvas.getBoundingClientRect();
    this.hasSize = width > 0 && height > 0;
    if (this.hasSize && this.gl) {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(MAX_PIXELS / (width * height)));
      const bufferWidth = Math.max(1, Math.floor(width * ratio));
      const bufferHeight = Math.max(1, Math.floor(height * ratio));
      if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
        canvas.width = bufferWidth;
        canvas.height = bufferHeight;
        this.gl.viewport(0, 0, bufferWidth, bufferHeight);
      }
    }
    this.syncAnimation();
  }

  private readonly onMotionChange = (): void => {
    this.reducedMotion.set(this.motion?.matches ?? false);
    this.syncAnimation();
  };

  private readonly onContextLost = (): void => this.fail(new Error('Contexte WebGL perdu'));

  private readonly syncAnimation = (): void => {
    if (!this.animated() || document.hidden || !this.hasSize) {
      this.stop();
    } else if (this.frame === null) {
      this.frame = requestAnimationFrame(this.render);
    }
  };

  private readonly render = (now: number): void => {
    this.frame = null;
    const gl = this.gl;
    if (!gl || !this.animated() || document.hidden || !this.hasSize) return;
    if (this.lastFrame === null || now - this.lastFrame >= FRAME_INTERVAL - 0.5) {
      if (this.lastFrame !== null) this.elapsed += (now - this.lastFrame) / 1000;
      this.lastFrame = now;
      gl.uniform1f(this.timeLocation, this.elapsed);
      gl.uniform3f(this.resolutionLocation, gl.drawingBufferWidth, gl.drawingBufferHeight, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    this.frame = requestAnimationFrame(this.render);
  };

  private stop(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.lastFrame = null;
  }

  private fail(error: unknown): void {
    this.available.set(false);
    this.stop();
    this.observer?.disconnect();
    this.releaseResources();
    if (!this.failed) console.warn('[ShaderBackground] Fond statique utilisé.', error);
    this.failed = true;
  }

  private releaseResources(): void {
    const gl = this.gl;
    if (!gl) return;
    if (this.buffer) gl.deleteBuffer(this.buffer);
    if (this.program) gl.deleteProgram(this.program);
    for (const shader of this.shaders) gl.deleteShader(shader);
    this.shaders.length = 0;
    this.buffer = null;
    this.program = null;
    this.gl = null;
  }
}
