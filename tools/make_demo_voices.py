"""Voice the demo films' lines with Kokoro (open-source text to speech, Apache 2.0): theme/assets/dv-<film>-<beat>.mp3,
and write their lengths to server_code/demo_voice_lengths.py (DemoData uses them as the takes' clip lengths).

    python tools/make_demo_voices.py          # only new or changed lines
    python tools/make_demo_voices.py --all    # everything again
Needs: pip install kokoro soundfile (and imageio-ffmpeg or ffmpeg on PATH for MP3). Run after changing server_code/demo_films.py.
"""
import hashlib
import importlib.util
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "theme" / "assets"
OUT = ROOT / "server_code" / "demo_voice_lengths.py"
RATE = 24000


def films():
    spec = importlib.util.spec_from_file_location("demo_films", ROOT / "server_code" / "demo_films.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def main():
    import numpy as np
    import soundfile as sf
    from kokoro import KPipeline
    m = films()
    every = "--all" in sys.argv
    old = {}
    if OUT.exists():
        ns = {}
        exec(OUT.read_text(encoding="utf-8"), ns)
        old = ns.get("LENGTHS", {}), ns.get("TEXTS", {})
    lengths, texts = (dict(old[0]), dict(old[1])) if old else ({}, {})
    pipes = {}
    todo = []
    for key, film, _ in m.FILMS:
        for b in film["beats"]:
            if b["kind"] != "line" or not b["who"]:
                continue
            name = m.voice_file(key, b["id"])
            voice, speed = m.VOICES.get(b["who"], ("af_heart", 1.0))
            sig = hashlib.sha1(("%s|%s|%s" % (b["text"], voice, speed)).encode()).hexdigest()[:12]
            if every or texts.get(name) != sig or not (ASSETS / name).exists():
                todo.append((name, b["text"], voice, speed, sig))
    print("%d lines to record" % len(todo))
    for name, text, voice, speed, sig in todo:
        lang = "b" if voice.startswith("b") else "a"
        if lang not in pipes:
            pipes[lang] = KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M")
        parts = [r.audio.numpy() for r in pipes[lang](text, voice=voice, speed=speed, split_pattern=r"\n+")]
        a = np.concatenate(parts) if parts else np.zeros(RATE // 4, dtype="float32")
        loud = np.flatnonzero(np.abs(a) > 0.012)
        if len(loud):
            a = a[max(0, loud[0] - int(RATE * 0.04)): min(len(a), loud[-1] + int(RATE * 0.12))]
        a = a / max(1e-4, float(np.max(np.abs(a)))) * 0.89
        wav = ASSETS / (name + ".tmp.wav")
        sf.write(str(wav), a, RATE)
        subprocess.run([ffmpeg(), "-y", "-loglevel", "error", "-i", str(wav), "-ac", "1", "-b:a", "56k", str(ASSETS / name)], check=True)
        wav.unlink()
        lengths[name] = round(len(a) / RATE, 3)
        texts[name] = sig
        print("  %s  %.2fs  %s" % (name, lengths[name], text))
    OUT.write_text('"""Made by tools/make_demo_voices.py: the length (seconds) of each demo voice file. Don\'t edit."""\n'
                   "LENGTHS = %s\nTEXTS = %s\n" % (json.dumps(lengths, indent=1, sort_keys=True), json.dumps(texts, indent=1, sort_keys=True)),
                   encoding="utf-8", newline="\n")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
