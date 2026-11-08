# Bundled tools

AI Clip Studio looks for FFmpeg and FFprobe in this order:

1. `AICS_FFMPEG_PATH` / `AICS_FFPROBE_PATH`
2. `tools\ffmpeg\bin\ffmpeg.exe` and `tools\ffmpeg\bin\ffprobe.exe`
3. Your system `PATH`

You can use an existing FFmpeg install instead of bundling it. For a portable
copy, download a Windows build from <https://www.gyan.dev/ffmpeg/builds/> or
<https://github.com/BtbN/FFmpeg-Builds/releases>, then place the binaries here:

```text
tools/
  ffmpeg/
    bin/
      ffmpeg.exe
      ffprobe.exe
```

The binaries are intentionally not committed to this repository. FFmpeg is a
separate project with its own license.
