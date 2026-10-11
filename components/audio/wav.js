// Sound without files.
//
// The pages Raptor builds are self-contained and open from `file://`, so there
// is nowhere to put a .wav. This builds one in memory instead — header and all —
// and hands back a `data:` URL that the asset loader fetches like any other
// file. That matters: the sound then travels the whole real path (fetch, bytes,
// `decodeAudioData`) rather than a shortcut only synthesised audio could take.
//
//     const pickup = wavUrl(0.24, (t) => Math.sin(2 * Math.PI * 880 * t) * Math.exp(-t * 9));
//     assets.sound("moneda", pickup);
//
// `sample(t)` is called once per frame with the time in seconds and returns the
// amplitude in −1..1; anything outside is clipped rather than wrapped, because
// a wrap is a loud buzz and a clip is just a louder note.
//
// Mono, 16-bit PCM. 22 050 Hz is half of CD rate: plenty for the blips and
// thunks a game needs, and half the base64 to carry around.

const DEFAULT_RATE = 22050;

export function wavUrl(seconds, sample, { rate = DEFAULT_RATE } = {}) {
    const frames = Math.max(1, Math.floor(rate * seconds));
    const bytes = new Uint8Array(44 + frames * 2);
    const view = new DataView(bytes.buffer);
    const ascii = (at, text) => { for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i)); };

    ascii(0, "RIFF");
    view.setUint32(4, 36 + frames * 2, true);
    ascii(8, "WAVEfmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);          // PCM
    view.setUint16(22, 1, true);          // mono
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);   // byte rate
    view.setUint16(32, 2, true);          // block align
    view.setUint16(34, 16, true);         // bits per sample
    ascii(36, "data");
    view.setUint32(40, frames * 2, true);

    for (let i = 0; i < frames; i++) {
        const value = Math.max(-1, Math.min(1, sample(i / rate)));
        view.setInt16(44 + i * 2, value * 32767, true);
    }

    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return "data:audio/wav;base64," + btoa(binary);
}
