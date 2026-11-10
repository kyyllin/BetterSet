# BetterSet

An Adobe InDesign script that improves ragged and justified text. It tries thousands of small tracking and scaling variants per paragraph, lets InDesign recompose the text each time and keeps only what makes the setting measurably calmer.

Current version: **3.4**. See [CHANGELOG.md](CHANGELOG.md) for what changed in each version.

## Install

1. In InDesign open *Window > Utilities > Scripts*.
2. Right click *User* and choose *Reveal in Finder* (or *Reveal in Explorer*).
3. Copy `BetterSet.jsx` into that folder. It now shows up in the Scripts panel.

## Use

1. Select text (only those paragraphs), a text frame (the whole story) or nothing (the whole document).
2. Double click **BetterSet** in the Scripts panel.
3. The start window shows the current score. Lower is better.
4. Adjust the settings if needed and click **Optimize**.
5. Watch the live view. Hold **Esc** to stop, improvements made so far are kept.
6. The result window shows the score before and after. **Undo** takes everything back in one step.

Run it once the copy is final. If the text changes later, just run it again.

For the alternating style, a wider tracking range (for example −40 to 30) and hyphenation help, because words have to move between lines.

## Settings

| Setting | Meaning |
| --- | --- |
| Tracking | Range and step in 1/1000 em. The script starts with half the range and uses the full range only where needed. |
| Scaling | Maximum horizontal scaling in percent, 0 turns it off. |
| Rag style | **Natural**: a calm, rhythmic edge. **Alternating long short**: long lines reach the right edge, short lines end the rag zone deep. Ragged text only. |
| Precision | **Exact**: small tolerances, lines must hit their targets closely. **Optical**: more tolerance, favours the overall impression. |
| Rag zone | How deep the ragged edge may be, in percent of the column width. In alternating style: how deep the short lines end. Ragged text only. |
| Search | Fixed time per paragraph, or until no further improvement turns up. |

## What is scored

**Ragged text, natural:** staircases, bellies and hollows, holes, protruding lines, an edge that is too uniform, rag zone depth.

**Ragged text, alternating:** long lines away from the right edge, short lines away from their target depth, lines of the same group not ending together.

**Justified text:** word spaces that are too loose or too tight, uneven spacing from line to line, rivers.

**Both:** hyphens and hyphen stacks, short words at the end of a line, sentence breaks at the edge, the last line, and the amount of change itself.

## Limitations

Right aligned and centered paragraphs, rotated frames, text wrap, table cells and footnotes are not evaluated.

## Working on it

- Every change raises the version number in the header of `BetterSet.jsx` and in its `VERSION` variable.
- Every version gets an entry at the top of `CHANGELOG.md`. A GitHub release with the same notes can be added by hand.
- Before making changes, pull the latest state so nobody overwrites the other person's work.
