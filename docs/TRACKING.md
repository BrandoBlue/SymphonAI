# Smart Tool Detection: how tracking works

1. **Learn the tool.** You tap the tip. MediaPipe Interactive Segmenter finds the whole object under the tap (green outline). The tool's own pixels become the template, and the tapped tip is the point that conducts.
2. **Follow it every frame.** The template is matched near where the tool should be (motion-predicted). Matching ignores background pixels and removes each side's average colour, so auto-exposure and lighting changes don't break it. Only object pixels are compared, so a frame costs about 3-5 ms on a laptop.
3. **Anchor it to the hand.** MediaPipe hand tracking runs alongside. The tool is held in the hand, so:
   - a match far from the hand is rejected (stops jumps to lookalikes on the wall),
   - the hand's size gives the tool's size (step back or forward),
   - the hand's turn gives the tool's turn (rotation).
   If the tool is momentarily lost, conducting continues from the hand (amber light).
4. **Identity checks.** A match is rejected if a clearly different spot matches nearly as well (ambiguous), if it jumps further than the tool could move, or if it is weak. After losing the tool, it must match strongly twice in the same place before it is trusted again.
5. **Re-lock any time.** Tap the tip during play. Re-calibrate with 🎯.

Rotated / scaled versions are always made from the pristine learned template (never from a copy of a copy), which was the cause of the old "jumps to something else" bug.

## Test bench
`tests/tracking-bench.html` (serve the repo, open it in Chrome) renders synthetic scenes: waving, rotating, stepping back, lookalike objects, a second identical pencil, putting the tool down and picking it up, and camera noise + blur + lighting changes. It reports how often the tip was found and the error in pixels (of a 320 px wide frame).

Debug overlay on a real device: add `?debug=1` to the app URL.
