"""Free narration via Microsoft Edge neural TTS (no key, unlimited).
Reads out/story.json -> writes out/narration.mp3 + out/words.json (word-level timing).

If the story has sections[], each section is synthesized with its own pace/pitch
(hook faster, landing slower) so the delivery breathes instead of droning — parts
are concatenated and word timings offset-accumulated to stay caption-accurate."""
import asyncio, json, os, subprocess
import edge_tts

VOICE = os.environ.get("EDGE_VOICE", "en-US-AndrewNeural")
BASE_RATE = os.environ.get("EDGE_RATE", "+0%")
BASE_PITCH = os.environ.get("EDGE_PITCH", "+0Hz")
GAP = 0.30  # silence between sections (seconds)

# energy pattern across sections: hook hot, middle varied, landing calm
RATES = ["+8%", "+3%", "+5%", "+2%", "+6%", "+3%", "+5%", "-2%"]
PITCHES = ["+4Hz", "+0Hz", "+2Hz", "+0Hz", "+3Hz", "+0Hz", "+2Hz", "-2Hz"]


async def synth(text, rate, pitch, outfile):
    comm = edge_tts.Communicate(text, VOICE, rate=rate, pitch=pitch, boundary="WordBoundary")
    audio = bytearray()
    words = []
    async for chunk in comm.stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            words.append({
                "w": chunk["text"],
                "start": chunk["offset"] / 1e7,   # 100ns ticks -> seconds
                "end": (chunk["offset"] + chunk["duration"]) / 1e7,
            })
    if not audio or not words:
        raise SystemExit("edge-tts returned no audio/timings")
    open(outfile, "wb").write(bytes(audio))
    return words


async def main():
    story = json.load(open("out/story.json"))
    sections = story.get("sections") or [{"narration": story["script"]}]
    all_words = []
    part_files = []
    offset = 0.0
    for i, sec in enumerate(sections):
        rate = RATES[i % len(RATES)] if len(sections) > 1 else BASE_RATE
        pitch = PITCHES[i % len(PITCHES)] if len(sections) > 1 else BASE_PITCH
        part = f"out/narr-part-{i}.mp3"
        words = await synth(sec["narration"], rate, pitch, part)
        for w in words:
            all_words.append({"w": w["w"], "start": round(w["start"] + offset, 3), "end": round(w["end"] + offset, 3)})
        # actual audio length via ffprobe (mp3 padding makes word-end an underestimate)
        dur = float(subprocess.check_output([
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", part]).strip())
        offset += dur + GAP
        part_files.append(part)
        print(f"  section {i + 1}/{len(sections)} rate={rate} pitch={pitch} dur={dur:.1f}s")

    if len(part_files) == 1:
        os.replace(part_files[0], "out/narration.mp3")
    else:
        # concat with GAP silences between parts, re-encoded for clean timestamps
        inputs = []
        filters = []
        streams = ""
        for i, p in enumerate(part_files):
            inputs += ["-i", p]
            filters.append(f"[{i}:a]aresample=24000[a{i}]")
            streams += f"[a{i}]"
            if i < len(part_files) - 1:
                filters.append(f"aevalsrc=0:d={GAP}:s=24000[s{i}]")
                streams += f"[s{i}]"
        n = len(part_files) * 2 - 1
        filters.append(f"{streams}concat=n={n}:v=0:a=1[out]")
        subprocess.check_call(["ffmpeg", "-y", "-loglevel", "error", *inputs,
                               "-filter_complex", ";".join(filters),
                               "-map", "[out]", "out/narration.mp3"])
    json.dump(all_words, open("out/words.json", "w"))
    # drop any stale ElevenLabs alignment so prepare-render uses THIS run's timing
    try:
        os.remove("out/alignment.json")
    except OSError:
        pass
    print(f"edge-tts: {len(all_words)} words, {all_words[-1]['end']:.1f}s, voice={VOICE}, {len(sections)} section(s)")


asyncio.run(main())
