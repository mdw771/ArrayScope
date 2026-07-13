import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import type { ComplexDisplayMode, ImageTile } from "../shared/types";
import { DEFAULT_RANGE, useViewerStore } from "./store";
import { tileCache, tileToFloatData } from "./tileCache";

const VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aUnit;
uniform vec4 uImageRect;
uniform vec2 uCanvasSize;
uniform float uZoom;
uniform vec2 uPan;
out vec2 vUv;
void main() {
  vec2 imagePoint = uImageRect.xy + aUnit * uImageRect.zw;
  vec2 screenPoint = imagePoint * uZoom + uPan;
  vec2 clip = vec2(screenPoint.x / uCanvasSize.x * 2.0 - 1.0,
                   1.0 - screenPoint.y / uCanvasSize.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vUv = aUnit;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D uData;
uniform bool uComplex;
uniform int uMode;
uniform int uColormap;
uniform vec2 uRange;
in vec2 vUv;
out vec4 outColor;

vec3 palette(float t) {
  t = clamp(t, 0.0, 1.0);
  if (uColormap == 0) return vec3(t);
  if (uColormap == 1) return vec3(1.0 - t);
  if (uColormap == 2) return clamp(vec3(0.28 + 0.55*t - 0.35*t*t, 0.03 + 1.35*t - 0.45*t*t, 0.34 + 0.85*t - 0.95*t*t), 0.0, 1.0);
  if (uColormap == 3) return clamp(vec3(0.05 + 2.1*t - 1.2*t*t, 0.02 + 0.35*t + 0.55*t*t, 0.5 + 0.8*t - 1.2*t*t), 0.0, 1.0);
  if (uColormap == 4) return clamp(vec3(0.02 + 2.3*t - 1.35*t*t, -0.05 + 0.35*t + 0.75*t*t, 0.18 + 1.1*t - 1.3*t*t), 0.0, 1.0);
  if (uColormap == 5) return clamp(vec3(0.02 + 1.75*t - 0.8*t*t, 0.01 + 0.2*t + 0.85*t*t, 0.15 + 1.0*t - 1.0*t*t), 0.0, 1.0);
  if (uColormap == 6) return clamp(vec3(0.0 + 1.1*t, 0.13 + 0.8*t, 0.3 + 0.35*t), 0.0, 1.0);
  if (uColormap == 7) {
    vec3 c = vec3(0.13572138 + 4.61539260*t - 42.66032258*t*t + 132.13108234*t*t*t,
                  0.09140261 + 2.19418839*t + 4.84296658*t*t - 14.18503333*t*t*t,
                  0.10667330 + 12.64194608*t - 60.58204836*t*t + 110.36276771*t*t*t);
    return clamp(c, 0.0, 1.0);
  }
  return t < 0.5
    ? mix(vec3(0.23, 0.30, 0.75), vec3(0.87), t * 2.0)
    : mix(vec3(0.87), vec3(0.70, 0.02, 0.15), (t - 0.5) * 2.0);
}

void main() {
  vec2 raw = texture(uData, vUv).rg;
  float value = raw.r;
  if (uComplex) {
    float magnitudeSquared = dot(raw, raw);
    if (uMode == 0) value = sqrt(magnitudeSquared);
    else if (uMode == 1) value = atan(raw.g, raw.r);
    else if (uMode == 2) value = raw.r;
    else if (uMode == 3) value = raw.g;
    else if (uMode == 4) value = log(1.0 + sqrt(magnitudeSquared));
    else value = magnitudeSquared;
  }
  if (isnan(value)) { outColor = vec4(0.9, 0.1, 0.9, 1.0); return; }
  if (isinf(value)) {
    outColor = value > 0.0 ? vec4(1.0, 0.85, 0.1, 1.0) : vec4(0.1, 0.85, 1.0, 1.0);
    return;
  }
  float denominator = max(uRange.y - uRange.x, 1e-30);
  float normalized = clamp((value - uRange.x) / denominator, 0.0, 1.0);
  outColor = vec4(palette(normalized), 1.0);
}`;

const MODE_INDEX: Record<ComplexDisplayMode, number> = {
  magnitude: 0,
  phase: 1,
  real: 2,
  imaginary: 3,
  logMagnitude: 4,
  magnitudeSquared: 5,
};

const COLORMAP_INDEX: Record<string, number> = {
  gray: 0,
  invertedGray: 1,
  viridis: 2,
  plasma: 3,
  inferno: 4,
  magma: 5,
  cividis: 6,
  turbo: 7,
  coolwarm: 8,
};

interface TextureEntry {
  texture: WebGLTexture;
  tile: ImageTile;
}

export function WebGLImage({ mode }: { mode: ComplexDisplayMode | "scalar" }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resourcesRef = useRef<{
    gl: WebGL2RenderingContext;
    program: WebGLProgram;
    textures: Map<string, TextureEntry>;
  } | undefined>(undefined);
  const state = useViewerStore(useShallow((viewer) => ({
    metadata: viewer.metadata,
    slice: viewer.currentSlice,
    zoom: viewer.zoom,
    panX: viewer.panX,
    panY: viewer.panY,
    colormap: viewer.colormap,
    range: viewer.ranges[mode] ?? DEFAULT_RANGE,
    tileRevision: viewer.tileRevision,
    viewportWidth: viewer.viewportWidth,
    viewportHeight: viewer.viewportHeight,
  })));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false });
    if (!gl) return;
    const program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    const vertices = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    resourcesRef.current = { gl, program, textures: new Map() };
    return () => {
      for (const entry of resourcesRef.current?.textures.values() ?? []) {
        gl.deleteTexture(entry.texture);
      }
      gl.deleteBuffer(vertices);
      gl.deleteProgram(program);
      resourcesRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const resources = resourcesRef.current;
    const metadata = state.metadata;
    if (!canvas || !resources || !metadata) return;
    const { gl, program, textures } = resources;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
    const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.08, 0.08, 0.08, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    uniform2f(gl, program, "uCanvasSize", rect.width, rect.height);
    uniform1f(gl, program, "uZoom", state.zoom);
    uniform2f(gl, program, "uPan", state.panX, state.panY);
    uniform2f(gl, program, "uRange", state.range[0], state.range[1]);
    uniform1i(gl, program, "uComplex", metadata.isComplex ? 1 : 0);
    uniform1i(gl, program, "uMode", mode === "scalar" ? 0 : MODE_INDEX[mode]);
    uniform1i(gl, program, "uColormap", COLORMAP_INDEX[state.colormap] ?? 0);
    uniform1i(gl, program, "uData", 0);
    gl.activeTexture(gl.TEXTURE0);

    const tiles = tileCache
      .values(state.slice)
      .sort((a, b) => b.level - a.level || a.requestId - b.requestId);
    const activeKeys = new Set<string>();
    for (const tile of tiles) {
      const key = tileKey(tile);
      activeKeys.add(key);
      let entry = textures.get(key);
      if (!entry || entry.tile.data !== tile.data) {
        if (entry) gl.deleteTexture(entry.texture);
        const texture = uploadTile(gl, tile, metadata.isComplex);
        entry = { texture, tile };
        textures.set(key, entry);
      }
      const factor = 2 ** tile.level;
      const imageX = tile.x * factor;
      const imageY = tile.y * factor;
      const imageWidth = Math.min(tile.width * factor, metadata.width - imageX);
      const imageHeight = Math.min(tile.height * factor, metadata.height - imageY);
      gl.bindTexture(gl.TEXTURE_2D, entry.texture);
      uniform4f(gl, program, "uImageRect", imageX, imageY, imageWidth, imageHeight);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    for (const [key, entry] of textures) {
      if (!activeKeys.has(key)) {
        gl.deleteTexture(entry.texture);
        textures.delete(key);
      }
    }
  }, [state, mode]);

  return <canvas ref={canvasRef} className="image-canvas" aria-label={`${mode} image canvas`} />;
}

function uploadTile(gl: WebGL2RenderingContext, tile: ImageTile, complex: boolean): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error("WebGL could not allocate an image texture.");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const values = tileToFloatData(tile);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    complex ? gl.RG32F : gl.R32F,
    tile.width,
    tile.height,
    0,
    complex ? gl.RG : gl.RED,
    gl.FLOAT,
    values,
  );
  return texture;
}

function createProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const compile = (type: number, source: string): WebGLShader => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("WebGL could not create a shader.");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? "WebGL shader compilation failed.");
    }
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error("WebGL could not create a rendering program.");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "WebGL program linking failed.");
  }
  return program;
}

function uniform1f(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, value: number): void {
  gl.uniform1f(gl.getUniformLocation(program, name), value);
}

function uniform1i(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, value: number): void {
  gl.uniform1i(gl.getUniformLocation(program, name), value);
}

function uniform2f(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, x: number, y: number): void {
  gl.uniform2f(gl.getUniformLocation(program, name), x, y);
}

function uniform4f(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  gl.uniform4f(gl.getUniformLocation(program, name), x, y, width, height);
}

function tileKey(tile: ImageTile): string {
  return `${tile.sliceIndex}:${tile.level}:${tile.x}:${tile.y}:${tile.width}:${tile.height}`;
}
