"""Build a real Shotcut timeline and render it; no API calls or paid generation."""
import argparse
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys


def execute(args, timeout=60):
    result = subprocess.run([str(a) for a in args], capture_output=True, text=True,
                            encoding="utf-8", errors="replace", timeout=timeout,
                            env={**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"})
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout)[-3000:])
    return result.stdout


def probe(path):
    binary = os.environ.get("FFPROBE_PATH") or shutil.which("ffprobe")
    if not binary:
        raise RuntimeError("Install ffprobe or set FFPROBE_PATH")
    return json.loads(execute([binary, "-v", "error", "-show_format", "-show_streams", "-of", "json", path]))


def edit(timeline_file, output_dir, render=True):
    source = Path(timeline_file).resolve()
    timeline = json.loads(source.read_text(encoding="utf-8-sig"))
    clips = timeline.get("clips", [])
    if timeline.get("version") != 1 or not clips or len(clips) > 120:
        raise ValueError("Use a version 1 timeline with 1–120 clips")
    ratio = timeline.get("aspect_ratio", "16:9")
    if ratio not in ("16:9", "9:16"):
        raise ValueError("Supported aspect ratios: 16:9, 9:16")
    # Preflight all media before constructing an output. Do not freeze short clips.
    cursor = 0
    for clip in clips:
        seconds = clip.get("duration")
        start = clip.get("in", 0)
        if not isinstance(seconds, (int, float)) or not math.isfinite(seconds) or seconds <= 0:
            raise ValueError("Each clip needs a positive duration")
        if not isinstance(start, (int, float)) or not math.isfinite(start) or start < 0:
            raise ValueError("Invalid source in point")
        path = (source.parent / clip["file"]).resolve()
        info = probe(path)
        if not any(s["codec_type"] == "video" for s in info["streams"]):
            raise ValueError(f"No video stream: {path}")
        if float(info["format"]["duration"]) + 0.05 < start + seconds:
            raise ValueError(f"Clip {clip.get('id')} is shorter than its planned duration")
        if "#" in clip.get("caption", ""):
            raise ValueError("Captions cannot contain MLT # expressions")
        clip["file"] = str(path)
        clip["start_frame"] = round(cursor * 30000 / 1001)
        cursor += seconds
        clip["frames"] = round(cursor * 30000 / 1001) - clip["start_frame"]
        if clip["frames"] < 1:
            raise ValueError("Clip is shorter than one output frame")
    audio = timeline.get("audio", [])
    for track in audio:
        path = (source.parent / track["file"]).resolve()
        info = probe(path)
        if not any(s["codec_type"] == "audio" for s in info["streams"]):
            raise ValueError(f"No audio stream: {path}")
        at = track.get("at", 0)
        duration = track.get("duration", cursor - at)
        if not all(isinstance(x, (int, float)) and math.isfinite(x) for x in (at, duration, track.get("volume", 1))):
            raise ValueError("Invalid audio timing/volume")
        if at < 0 or duration <= 0 or at + duration > cursor + .001 or not 0 <= track.get("volume", 1) <= 2:
            raise ValueError("Audio must fit inside timeline; volume must be 0–2")
        if float(info["format"]["duration"]) + .05 < duration:
            raise ValueError("Audio too short; supply a longer file or set duration explicitly")
        track.update(file=str(path), at=at, duration=duration)
    output = Path(output_dir).resolve()
    output.mkdir(parents=True, exist_ok=False)
    project = output / "film.mlt"

    def shotcut(*args, project_arg=True, timeout=60):
        command = [sys.executable, "-m", "cli_anything.shotcut.shotcut_cli", "--json"]
        if project_arg:
            command += ["--project", str(project)]
        data = json.loads(execute(command + list(args), timeout))
        if isinstance(data, dict) and data.get("error"):
            raise RuntimeError(str(data["error"]))
        return data

    shotcut("project", "new", "--profile", "vertical1080p30" if ratio == "9:16" else "hd1080p30", "-o", str(project), project_arg=False)
    video_track = shotcut("timeline", "add-track", "--type", "video", "--name", "Story")["track_index"]
    # Shotcut accepts frame counts as time inputs; MLT out points are inclusive.
    for index, clip in enumerate(clips):
        media = shotcut("media", "import", clip["file"])
        first = round(clip.get("in", 0) * 30000 / 1001)
        shotcut("timeline", "add-clip", media["clip_id"], "--track", str(video_track),
                "--in", str(first), "--out", str(first + clip["frames"] - 1), "--at", str(clip["start_frame"]))
        if timeline.get("mute_source_audio", False):
            shotcut("filter", "add", "volume", "--track", str(video_track), "--clip", str(index), "--param", "level=-100")
        if clip.get("caption"):
            shotcut("filter", "add", "text", "--track", str(video_track), "--clip", str(index),
                    "--param", "argument=" + clip["caption"], "--param", "family=" + timeline.get("font_family", "Sans"),
                    "--param", "size=48", "--param", "geometry=5%/75%:90%x20%:100", "--param", "halign=center")
    for item in audio:
        index = shotcut("timeline", "add-track", "--type", "audio", "--name", item.get("role", "Audio"))["track_index"]
        media = shotcut("media", "import", item["file"])
        start = round(item["at"] * 30000 / 1001)
        frames = round((item["at"] + item["duration"]) * 30000 / 1001) - start
        shotcut("timeline", "add-clip", media["clip_id"], "--track", str(index), "--in", "0", "--out", str(frames - 1), "--at", str(start))
        # Native MLT volume.level is decibels, despite the adapter's linear help text.
        linear = item.get("volume", 1)
        decibels = 20 * math.log10(linear) if linear > 0 else -100
        shotcut("filter", "add", "volume", "--track", str(index), "--param", "level=" + str(decibels))
    def srt_time(frame):
        ms = round(frame * 1001 / 30)
        return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"
    entries = []
    for clip in clips:
        if clip.get("caption"):
            entries.append(f"{len(entries)+1}\n{srt_time(clip['start_frame'])} --> {srt_time(clip['start_frame']+clip['frames'])}\n{clip['caption']}\n")
    (output / "captions.srt").write_text("\n".join(entries), encoding="utf-8")
    report = {"project": str(project), "expected_seconds": cursor, "clip_count": len(clips), "rendered": False}
    if render:
        video = output / "film.mp4"
        shotcut("export", "render", str(video), "--preset", "h264-fast", timeout=900)
        info = probe(video)
        actual = float(info["format"]["duration"])
        if abs(actual - cursor) > .15:
            raise RuntimeError(f"Rendered duration {actual} differs from planned {cursor}")
        video_stream = next(s for s in info["streams"] if s["codec_type"] == "video")
        expected = (1080, 1920) if ratio == "9:16" else (1920, 1080)
        if (video_stream["width"], video_stream["height"]) != expected:
            raise RuntimeError("Unexpected output dimensions")
        if audio and not any(s["codec_type"] == "audio" for s in info["streams"]):
            raise RuntimeError("Missing output audio stream")
        report.update(rendered=True, file=str(video), actual_seconds=actual, width=expected[0], height=expected[1])
    (output / "edit-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeline", required=True)
    parser.add_argument("--output", required=True, help="New output directory; existing edits are preserved")
    parser.add_argument("--project-only", action="store_true")
    args = parser.parse_args()
    try:
        print(json.dumps(edit(args.timeline, args.output, not args.project_only), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
