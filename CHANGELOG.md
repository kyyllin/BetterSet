# Changelog

All notable changes to BetterSet. The newest version is at the top.

## 3.2 (2026-10-30)

### Added
- New search mode **until no further improvement turns up**. A paragraph is finished once many random attempts in a row find nothing better (at least 40, or five per line for long paragraphs). Every improvement resets the counter. Safety limit: two minutes per paragraph.
- The start window offers both modes under *Search*: fixed time or until no further improvement.
- The result window reports how many paragraphs were searched until no further improvement turned up.
- The chosen search mode is remembered for the next run.

## 3.1 (2026-10-30)

### Changed
- The whole script is in English: comments, header, all windows, status lines, error messages and the undo entry.
- Numbers use English formatting (1,234.5). Input with a comma as decimal separator is still accepted.
- The settings file is now called `BetterSet_Settings.txt`, so settings from 3.0 are reset once.

## 3.0 (2026-10-30)

Renamed from BetterFlatter to **BetterSet**.

### Added
- **Justified text**: all justification types are detected and scored separately. Penalties for loose and tight word spaces (measured against the natural word space of the last line), uneven word spacing from line to line, and rivers over three or more lines.
- **Continued search**: after the line by line pass, the script shifts one to three lines at random, improves from there and keeps the result only if the score drops. This gets it out of dead ends and produces thousands of variants per paragraph instead of a few hundred.
- New setting **Search time** in seconds per paragraph.
- Live view draws the words of each line as blocks, so word spacing and rivers become visible.

### Changed
- **Bellies and hollows** in ragged text: each line is also compared with the lines two and three away, so edges that bulge over several lines are penalized. The short long rhythm stays allowed.
- Short words at the end of a line count half in justified text.

## 2.2 (2026-10-30)

### Added
- **Horizontal scaling** as a setting (up to ±1 % by default, 0 turns it off). Used only in the second stage.
- **Live view of every attempt**: the large live score follows each variant, the drawing shows the current attempt in black and the best state per line in orange, a status line shows attempt number and score.
- InDesign jumps to the spread of the current paragraph and redraws the text about five times per second.

## 2.1 (2026-10-30)

Renamed from Flatterkante to **BetterFlatter**.

### Changed
- Only two settings left: tracking range and rag zone. Stages are derived automatically.
- Changing the rag zone updates the score in the start window immediately.
- Light interface: windows use the normal InDesign colors, only the drawing has its own white area. The dark background made text unreadable.

## 2.0 (2026-10-30)

### Added
- Start window with the current score in large type and one choice (Gentle, Balanced, Strong).
- Dark overlay during the run with live score, edge drawing and progress bar. Hold Esc to stop.
- Result window with score before and after, biggest improvement and an Undo button.
- Scope is detected automatically: selected text, selected frame (whole story) or the whole document.
- Processed stories are marked invisibly, so a second run starts from the paragraph style instead of stacking corrections.

## 1.0 (2026-10-30)

First version, called **Flatterkante**.
- Optimizes left aligned ragged text by testing small tracking values per line and scoring the whole edge.
- Scores staircases, holes, protruding lines, uniform edges, rag zone depth, hyphens, short words and sentence breaks at the line edge, and the last line.
- Many settings in one dialog.
