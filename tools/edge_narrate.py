"""Free narration via Microsoft Edge neural TTS (no key, unlimited).
Reads out/story.json -> writes out/narration.mp3 + out/words.json (word-level timing)."""
import asyncio, json, os
import edge_tts

VOICE = os.environ.get("EDGE_VOICE", "en-US-AndrewNeural")
RATE = os.environ.get("EDGE_RATE", "+0%")
PITCH = os.environ.get("EDGE_PITCH", "+0Hz")


async def main():
    text = json.load(open("out/story.json"))["script"]
    comm = edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH, boundary="WordBoundary")
    audio = bytearray()
    words = []
    async for chunk in comm.stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            start = chunk["offset"] / 1e7            # 100ns ticks -> seconds
            end = (chunk["offset"] + chunk["duration"]) / 1e7
            words.append({"w": chunk["text"], "start": round(start, 3), "end": round(end, 3)})
    if not audio:
        raise SystemExit("edge-tts returned no audio")
    if not words:
        raise SystemExit("edge-tts returned no word timings")
    open("out/narration.mp3", "wb").write(bytes(audio))
    json.dump(words, open("out/words.json", "w"))
    # drop any stale ElevenLabs alignment so prepare-render uses THIS run's timing
    try:
        os.remove("out/alignment.json")
    except OSError:
        pass
    print(f"edge-tts: {len(words)} words, {words[-1]['end']:.1f}s, voice={VOICE}")


asyncio.run(main())
