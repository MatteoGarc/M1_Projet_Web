import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShaderBackgroundComponent } from './shader-background';

describe('ShaderBackgroundComponent lifecycle', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Angular also schedules a frame for its own change detection. Count only the renderer.
  const renderFrames = () => vi.mocked(requestAnimationFrame).mock.calls.filter(([callback]) => callback.name === 'render').length;

  function setup(reduced = false, webgl = true) {
    const motion = { matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', () => motion);
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      disconnect = disconnect;
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 42));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const gl = {
      createProgram: () => ({}), createShader: () => ({}), createBuffer: () => ({}),
      shaderSource: vi.fn(), compileShader: vi.fn(), getShaderParameter: () => true,
      attachShader: vi.fn(), linkProgram: vi.fn(), getProgramParameter: () => true,
      useProgram: vi.fn(), bindBuffer: vi.fn(), bufferData: vi.fn(),
      getAttribLocation: () => 0, enableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(),
      getUniformLocation: () => ({}), viewport: vi.fn(),
      deleteBuffer: vi.fn(), deleteProgram: vi.fn(), deleteShader: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(webgl ? gl as unknown as WebGLRenderingContext : null);
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 4000, height: 2000 } as DOMRect);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fixture = TestBed.createComponent(ShaderBackgroundComponent);
    fixture.detectChanges();
    return { fixture, gl, motion, disconnect };
  }

  it('falls back without WebGL and reports only one diagnostic', () => {
    const { fixture } = setup(false, false);
    expect(fixture.componentInstance.available()).toBe(false);
    expect(renderFrames()).toBe(0);
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('caps the buffer and releases GPU resources and listeners on destruction', () => {
    const { fixture, gl, motion, disconnect } = setup();
    const canvas: HTMLCanvasElement = fixture.nativeElement.querySelector('canvas');
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(2_000_000);
    expect(renderFrames()).toBe(1);
    fixture.destroy();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(motion.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(gl.deleteBuffer).toHaveBeenCalledOnce();
    expect(gl.deleteProgram).toHaveBeenCalledOnce();
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
  });

  it('respects reduced motion and responds when the preference changes', () => {
    const { fixture, motion } = setup(true);
    expect(fixture.componentInstance.animated()).toBe(false);
    expect(renderFrames()).toBe(0);
    motion.matches = false;
    const listener = motion.addEventListener.mock.calls[0][1] as () => void;
    listener();
    expect(fixture.componentInstance.animated()).toBe(true);
    expect(renderFrames()).toBe(1);
    fixture.componentInstance.toggle();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
  });

  it('stops when hidden and resumes without scheduling duplicate loops', () => {
    const { fixture } = setup();
    const hidden = vi.spyOn(document, 'hidden', 'get');
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(renderFrames()).toBe(2);
    expect(fixture.componentInstance.animated()).toBe(true);
  });

  it('uses the static background after losing its context', () => {
    const { fixture } = setup();
    fixture.nativeElement.querySelector('canvas').dispatchEvent(new Event('webglcontextlost'));
    expect(fixture.componentInstance.available()).toBe(false);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
    expect(console.warn).toHaveBeenCalledOnce();
  });
});
