# Landing code globe

Playwright captures use fixed local JavaScript examples, with no private repository or account content. The globe and lens share cached curved code strips. Gray code and green keywords remain, along with the fixed simple handle, marked bezel, cursor/keyboard magnification, pinning and Escape. Offscreen or hidden views stop the frame loop; reduced motion paints only on interaction. The geometric background is now entirely static, including sign-in.

## Performance comparison

Short local headless Chromium samples at 1440x900 with 4x CPU throttling and the same four-second pointer sweep:

| Measurement | Original SVG | Pulses removed only | Cached renderer |
| --- | ---: | ---: | ---: |
| Median frame gap | 49.9 ms | 49.9 ms | 16.7 ms |
| 95th-percentile frame gap | 66.6 ms | 66.7 ms | 16.7 ms |
| Layout count | 198 | 173 | 0 |
| Script duration | 1.074 s | 1.064 s | 0.188 s |
| Globe DOM elements | 547 | 547 | 36 |

Raw samples are adjacent JSON files. These are emulated local observations, not universal FPS guarantees or measurements from a physical low-end device. Removing background pulses alone did not resolve the bottleneck. Cached text drawing removed repeated SVG text-path layout and its duplicate magnified subtree. Pointer state stays outside React; cached layout bounds and transform positioning avoid per-movement reflow. The updated lens uses extra backing resolution for legibility.

Validation: frontend format/lint/typing, 46 unit tests, 70 browser tests and production build. The two old pulse tests were replaced by a static-background regression check. Globe checks cover actual changing canvas pixels, opposing offsets, magnification position, keyboard/pin/Escape, rim overflow, offscreen stopping and frozen reduced-motion output. No inference calls or new dependencies are needed.
