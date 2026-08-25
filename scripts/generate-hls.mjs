import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('../', import.meta.url).pathname.replace(/^\/+/, '');
const ffmpeg = process.env.FFMPEG_BIN || 'ffmpeg';
const variants = [
  ['public/background/WUWA-desktop.mp4', 'public/background/hls/desktop/720p', '1280:720', '1600k', '1800k', '3200k'],
  ['public/background/WUWA-desktop.mp4', 'public/background/hls/desktop/480p', '854:480', '700k', '800k', '1400k'],
  ['public/background/WUWA-mobile.mp4', 'public/background/hls/mobile/540p', '960:540', '1000k', '1100k', '2000k'],
  ['public/background/WUWA-mobile.mp4', 'public/background/hls/mobile/360p', '640:360', '450k', '520k', '900k'],
];

for (const [input, output, size, bitrate, maxrate, bufsize] of variants) {
  mkdirSync(join(root, output), { recursive: true });
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', join(root, input),
    '-vf', `scale=${size}:flags=lanczos`, '-c:v', 'libx264', '-preset', 'medium',
    '-pix_fmt', 'yuv420p', '-b:v', bitrate, '-maxrate', maxrate, '-bufsize', bufsize,
    '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-an', '-f', 'hls',
    '-hls_time', '2', '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4', '-hls_segment_filename', join(root, output, 'seg-%03d.m4s'),
    join(root, output, 'index.m3u8'),
  ];
  const result = spawnSync(ffmpeg, args, { stdio: 'inherit' });
  if (result.error) {
    console.error(`Unable to run FFmpeg (${ffmpeg}). Install FFmpeg or set FFMPEG_BIN to its executable path.`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
