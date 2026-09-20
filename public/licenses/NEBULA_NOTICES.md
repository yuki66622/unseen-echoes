# Opening renderer notices

## Star Nest

- **Used for**: the Relax-mode backgrounds `Nebula · Original` / `Blue` / `Customize` (`visuals/starnest.js`)
- **Author**: Pablo Roman Andrioli
- **Licence**: MIT
- **Notice as supplied by the author**, reproduced verbatim:

      // Star Nest by Pablo Roman Andrioli
      // License: MIT

- **Extent of use**: the shader body is included **verbatim, unmodified**. This project
  added only (a) a WebGL wrapper supplying the `iResolution` / `iTime` / `iMouse`
  uniforms so it runs outside Shadertoy, and (b) post-processing applied to the output
  (cool-blue tint, a user-chosen colour ramp, brightness, optional highlight roll-off)
  plus a time-scale factor. None of that touches the original algorithm.
- **Obligation**: MIT requires the copyright and permission notice to be retained in all
  copies. It is kept at the top of `visuals/starnest.js`. **Do not strip that comment
  block when minifying or bundling.**

### MIT License (full text)

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.

---

## Sea (golfed wave shader)

- **Used for**: Relax-mode backgrounds `Sea · Blue` / `Violet` / `Customize` (`visuals/waves.js`)
- **Authors**: @FabriceNeyret2, with a further reduction by @bug
- **Licence**: MIT
- **Notice as supplied by the authors**, reproduced verbatim:

      // MIT License
      /*
          -3 by @FabriceNeyret2
          -11 by @bug (very very slight visual change)
          thanks!!  :D
      */

- **Extent of use**: the shader body is included **verbatim except for one necessary fix** —
  the original declares `i`, `n` and `p` without initialising them before use. Shadertoy's
  drivers happen to zero-initialise, but per the GLSL spec that is undefined behaviour and
  other GPUs may render noise or black. This project adds `i=0. / n=0. / p=vec3(0)`, which is
  exactly the zero value the original relies on — no visual change.
  Everything else this project added sits outside the original: the WebGL uniform wrapper,
  output colour grading (cool-blue / violet / user-chosen palettes, brightness, the moon
  roll-off) and a time-scale factor that slows the motion without touching the original's
  internals.
- **Obligation**: MIT requires the copyright and permission notice to be retained in all
  copies. It is kept at the top of `visuals/waves.js`. **Do not strip that comment block
  when minifying or bundling.** The MIT text is reproduced in full above under Star Nest.

---
