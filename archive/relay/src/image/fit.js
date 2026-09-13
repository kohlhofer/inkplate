// Contain-fit: scale (up or down) to the largest size that fits inside the
// box while preserving aspect ratio, then nearest-neighbour resample —
// simple and dependency-free, and dithering/blocking afterward hides
// resampling artifacts anyway.
export function computeFit(srcWidth, srcHeight, boxWidth, boxHeight) {
    const scale = Math.min(boxWidth / srcWidth, boxHeight / srcHeight);
    return {
        width: Math.max(1, Math.round(srcWidth * scale)),
        height: Math.max(1, Math.round(srcHeight * scale)),
    };
}

export function resample(rgba, srcWidth, srcHeight, destWidth, destHeight) {
    const out = new Uint8ClampedArray(destWidth * destHeight * 4);
    for (let y = 0; y < destHeight; y++) {
        const srcY = Math.min(srcHeight - 1, Math.floor((y * srcHeight) / destHeight));
        for (let x = 0; x < destWidth; x++) {
            const srcX = Math.min(srcWidth - 1, Math.floor((x * srcWidth) / destWidth));
            const srcOff = (srcY * srcWidth + srcX) * 4;
            const destOff = (y * destWidth + x) * 4;
            out[destOff] = rgba[srcOff];
            out[destOff + 1] = rgba[srcOff + 1];
            out[destOff + 2] = rgba[srcOff + 2];
            out[destOff + 3] = rgba[srcOff + 3];
        }
    }
    return out;
}
