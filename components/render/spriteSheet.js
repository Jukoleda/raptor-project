// Slicing a texture into frames, and playing them back.
//
// A sheet is a grid: every frame the same size, optionally with a margin around
// the edge and spacing between cells (exporters add those to stop neighbouring
// frames bleeding into each other when filtering is on).
//
//     const sheet = new SpriteSheet(texture, { frameWidth: 16, frameHeight: 16 });
//     sheet.frame(0)            // by index, left to right then down
//     sheet.frame(2, 1)         // by column and row
//     sheet.range(0, 3)         // [0,1,2,3] as frame rectangles
//
// An Animation is a list of those rectangles plus a frame rate. It holds *time*,
// not a frame counter, so playback speed does not depend on the refresh rate:
// at 8 fps a walk cycle takes the same wall-clock time at 30 Hz and at 144 Hz.

export default class SpriteSheet {
    constructor(texture, { frameWidth, frameHeight, margin = 0, spacing = 0 } = {}) {
        this.texture = texture;
        this.frameWidth = frameWidth;
        this.frameHeight = frameHeight;
        this.margin = margin;
        this.spacing = spacing;
    }

    get columns() {
        const usable = (this.texture.width - this.margin * 2) + this.spacing;
        return Math.max(1, Math.floor(usable / (this.frameWidth + this.spacing)));
    }

    get rows() {
        const usable = (this.texture.height - this.margin * 2) + this.spacing;
        return Math.max(1, Math.floor(usable / (this.frameHeight + this.spacing)));
    }

    get count() {
        return this.columns * this.rows;
    }

    // `frame(i)` walks the grid in reading order; `frame(col, row)` is explicit.
    frame(a, b = null) {
        const [col, row] = b === null ? [a % this.columns, Math.floor(a / this.columns)] : [a, b];
        return {
            x: this.margin + col * (this.frameWidth + this.spacing),
            y: this.margin + row * (this.frameHeight + this.spacing),
            width: this.frameWidth,
            height: this.frameHeight,
        };
    }

    // Inclusive range of indices, as frame rectangles — the usual way to say
    // "frames 4 through 7 are the walk cycle".
    range(from, to) {
        const frames = [];
        for (let i = from; i <= to; i++) frames.push(this.frame(i));
        return frames;
    }

    // Convenience: build an Animation straight from indices.
    animation(from, to, options = {}) {
        return new Animation(this.range(from, to), options);
    }
}

export class Animation {
    constructor(frames, { fps = 8, loop = true, onEnd = null } = {}) {
        this.frames = frames;
        this.fps = fps;
        this.loop = loop;
        this.onEnd = onEnd;
        this.time = 0;
        this.index = 0;
        this.finished = false;
    }

    get frame() {
        return this.frames[this.index];
    }

    reset() {
        this.time = 0;
        this.index = 0;
        this.finished = false;
        return this;
    }

    // Advances by dt seconds and returns true if the frame changed, so callers
    // only touch the GPU when there is something new to show.
    update(dt) {
        if (this.finished || this.frames.length < 2) return false;
        const previous = this.index;
        this.time += dt;

        const step = 1 / this.fps;
        while (this.time >= step) {
            this.time -= step;
            if (this.index + 1 < this.frames.length) {
                this.index++;
            } else if (this.loop) {
                this.index = 0;
            } else {
                this.finished = true;
                if (this.onEnd) this.onEnd(this);
                break;
            }
        }
        return this.index !== previous;
    }
}

// Drives a Sprite from named animations, which is the shape gameplay code
// actually wants: `animator.play("walk")`, not a frame index.
export class Animator {
    constructor(sprite, animations = {}, { initial = null } = {}) {
        this.sprite = sprite;
        this.animations = animations;
        this.current = null;
        this.name = null;
        const first = initial || Object.keys(animations)[0];
        if (first) this.play(first);
    }

    // Replaying the animation that is already running is a no-op, so calling
    // `play("walk")` every frame while a key is held does not reset it to frame
    // zero forever — the mistake that makes a character look frozen mid-stride.
    play(name, { restart = false } = {}) {
        if (this.name === name && !restart) return this;
        const animation = this.animations[name];
        if (!animation) return this;
        this.name = name;
        this.current = animation.reset();
        this.sprite.setFrame(animation.frame);
        return this;
    }

    update(dt) {
        if (this.current && this.current.update(dt)) {
            this.sprite.setFrame(this.current.frame);
        }
        return this;
    }
}
