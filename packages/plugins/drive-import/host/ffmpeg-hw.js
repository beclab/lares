import { existsSync } from "node:fs";

export const VAAPI_RENDER_NODE = "/dev/dri/renderD128";

const CUDA_LIB_DIRS = [
  "/usr/lib/x86_64-linux-gnu",
  "/usr/lib/aarch64-linux-gnu",
  "/usr/lib64",
  "/usr/local/nvidia/lib64",
  "/usr/local/nvidia/lib",
];

/** Olares One can expose /dev/nvidia0 without mounting libcuda. */
export function cudaLibraryPresent({
  ldLibraryPath = process.env.LD_LIBRARY_PATH,
  exists = existsSync,
} = {}) {
  const dirs = [
    ...String(ldLibraryPath ?? "").split(":").filter(Boolean),
    ...CUDA_LIB_DIRS,
  ];
  return dirs.some((dir) => exists(`${dir}/libcuda.so.1`) || exists(`${dir}/libcuda.so`));
}

export function nvencHw() {
  return {
    kind: "nvenc",
    encoder: "h264_nvenc",
    decodeArgv: ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"],
    encodeArgv: ["-c:v", "h264_nvenc", "-preset", "p4", "-cq", "23"],
  };
}

export function vaapiHw(device = VAAPI_RENDER_NODE) {
  return {
    kind: "vaapi",
    encoder: "h264_vaapi",
    device,
    globalArgv: ["-vaapi_device", device],
    encodeArgv: ["-vf", "format=nv12,hwupload", "-c:v", "h264_vaapi", "-qp", "23"],
  };
}

export function cpuHw() {
  return {
    kind: "cpu",
    encoder: "libx264",
    encodeArgv: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"],
  };
}

/**
 * Device nodes plus a loadable CUDA library. A failed encode still falls through
 * to the next candidate; this only skips NVENC when CUDA cannot load.
 */
export function ffmpegHwCandidates({
  nvidiaDevice = existsSync("/dev/nvidia0"),
  vaapiDevice = existsSync(VAAPI_RENDER_NODE) ? VAAPI_RENDER_NODE : null,
  nvidiaVisible = process.env.NVIDIA_VISIBLE_DEVICES,
  cudaLibrary = cudaLibraryPresent(),
} = {}) {
  const nvidiaVisibleOn = Boolean(nvidiaVisible)
    && nvidiaVisible !== "void"
    && nvidiaVisible !== "none";
  const nvidia = Boolean(cudaLibrary) && (nvidiaDevice || nvidiaVisibleOn);
  const candidates = [];
  if (nvidia) candidates.push(nvencHw());
  if (vaapiDevice) candidates.push(vaapiHw(vaapiDevice));
  candidates.push(cpuHw());
  return candidates;
}
