"""Create labelled synthetic media for a no-spend editing smoke test."""
import argparse
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("--output", required=True)
parser.add_argument("--ffmpeg", default="ffmpeg")
args = parser.parse_args()
out = Path(args.output).resolve()
out.mkdir(parents=True, exist_ok=False)

def ffmpeg(*parts):
    subprocess.run([args.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-n", *parts], check=True)

clips = []
for number, colour in enumerate(["0x183c55", "0x496052", "0x784436"], 1):
    path = out / f"shot-{number}.mp4"
    ffmpeg("-f", "lavfi", "-i", f"color=c={colour}:s=640x360:r=30:d=4.1", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path))
    clips.append({"id": str(number), "file": str(path), "duration": 4, "caption": f"LOCAL TEST FOOTAGE - Shot {number} / 3"})
sound = out / "test-tone.wav"
ffmpeg("-f", "lavfi", "-i", "sine=frequency=220:duration=12.1", str(sound))
timeline = {"version": 1, "title": "Clipmivo Film - synthetic editing test", "aspect_ratio": "16:9", "clips": clips,
            "audio": [{"file": str(sound), "role": "Fixture tone", "duration": 12, "volume": 0.1}]}
(out / "timeline.json").write_text(json.dumps(timeline, indent=2), encoding="utf-8")
print(out / "timeline.json")
