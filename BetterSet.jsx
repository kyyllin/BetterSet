//@target indesign
/*
    BetterSet.jsx                                             Version 3.3

    Optimizes ragged and justified text in Adobe InDesign.

    HOW TO USE
    Select text (only those paragraphs), select a text frame (the whole
    story) or select nothing (the whole document), then run the script.
    The start window shows the current score. The only settings are the
    tracking range, horizontal scaling, rag style, precision, rag zone
    and search time, everything else follows from the text itself. The live view shows
    every attempt with its score. Hold Esc to stop, improvements made so
    far are kept. At the end, everything can be undone with one click.

    HOW IT WORKS
    The script runs on top of the Adobe Paragraph or Single-line
    Composer. For each line it tries small tracking and scaling values,
    lets InDesign recompose the text and scores the whole paragraph each
    time. Lower is better. First it improves line by line, starting with
    half the tracking range. Then it keeps searching until the search
    time is used up: it shifts a few lines at random, improves from
    there and keeps the result only if it is better. The search time
    applies per paragraph, only the first round always runs to the end.
    Alternatively it searches until no further improvement turns up:
    a paragraph is finished once many random attempts in a row did not
    find anything better (at most two minutes per paragraph).

    RAGGED TEXT (left aligned), two styles
    Natural: a calm, rhythmic edge. Staircases, bellies and hollows,
    holes, protruding lines, an edge that is too uniform, and the depth
    of the rag zone.
    Alternating: long and short lines take turns. The long lines should
    reach the right edge and end at the same point, the short lines
    should end at the same point the rag zone deep. Which line starts
    long is chosen per paragraph.

    PRECISION
    Exact keeps tolerances small, so lines have to hit their targets
    closely. Optical allows more tolerance and favours the overall
    impression.

    JUSTIFIED TEXT (all justification types)
    Word spaces that are too loose or too tight, uneven word spacing from
    line to line, and rivers.

    BOTH
    Hyphens and hyphen stacks, short words at the end of a line, sentence
    breaks at the edge, the last line, and the amount of change itself.

    RUNNING IT AGAIN
    Processed stories get an invisible marker. On the next run the
    tracking of the paragraph style is used as the baseline there, so
    earlier corrections can be taken back again.

    LIMITATIONS
    Right aligned and centered paragraphs, rotated frames, text wrap,
    table cells and footnotes are not evaluated.
*/

(function () {

    var SCRIPT_NAME = "BetterSet";
    var VERSION = "3.3";
    var LABEL_KEY = "betterset";
    var TIME_LIMIT = 30;          // hard limit for the first round, seconds per paragraph
    var GOAL_PER_LINE = 0.4;      // below this, the stronger stage is not used

    var AUTO_CAP = 120;           // "until no further improvement": at most this many seconds per paragraph
    var AUTO_PATIENCE = 40;       // ...and stop after this many attempts in a row without improvement (at least)

    // ragStyle: 0 natural, 1 alternating long short. precision: 0 exact, 1 optical
    var DEFAULTS = { tMin: -15, tMax: 10, tStep: 1, scale: 1, zone: 15, search: 8, untilBest: 0, ragStyle: 0, precision: 1 };

    var WEIGHTS = {
        // ragged text
        stair: 3, belly: 2.5, hollow: 1.5, hole: 4, depth: 2, bulge: 1.5, flat: 0.3,
        // ragged text, alternating style
        altTarget: 3, altEven: 2,
        // justified text
        loose: 4, tight: 2, even: 2, river: 2,
        // both
        hyph: 2.5, shortWord: 3, sentence: 3, last: 0.75
    };

    // Words that should not end a line (in addition to all words of up to
    // three characters). German, English and French.
    var STOPWORDS = ("der die das den dem des ein eine einen einem einer eines " +
        "und oder aber doch denn sowie mit von vom zu zum zur im in ins an am auf aus bei beim " +
        "für vor nach über unter um bis durch ohne gegen seit als wie so da wo wenn dass ob " +
        "nicht nur auch noch schon sehr ich du er sie es wir ihr man sein seine ihre " +
        "the a an and or nor but of to in on at by for with from as is it its if so this that " +
        "le la les de du des et un une au aux en").split(" ");

    // Two stages from the settings: first half the tracking range without
    // scaling, then the full range with scaling
    function makeStages(S) {
        var st = Math.max(1, S.tStep);
        var hLo = Math.ceil(S.tMin / 2 / st) * st, hHi = Math.floor(S.tMax / 2 / st) * st;
        var sv = [0];
        for (var x = 1; x <= (S.scale || 0); x++) { sv.push(-x); sv.push(x); }
        return [
            { t: range(hLo, hHi, st), s: [0], passes: 4 },
            { t: range(S.tMin, S.tMax, st), s: sv, passes: 3 }
        ];
    }

    // Colors are only used for the custom drawn areas
    var COL = {
        bg: [1, 1, 1, 1],
        fg: [0.08, 0.08, 0.08, 1],
        dim: null,
        ghost: [0.84, 0.84, 0.82, 1],
        edge: [0.55, 0.55, 0.53, 1],
        accent: [1, 0.33, 0.15, 1]
    };
    var FONT_FAMILY = "Helvetica Neue";

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function range(lo, hi, st) {
        var v = [0], x;
        for (x = -st; x >= lo; x -= st) v.push(x);
        if (lo < 0 && v[v.length - 1] !== lo) v.push(lo);
        for (x = st; x <= hi; x += st) v.push(x);
        if (hi > 0 && v[v.length - 1] !== hi) v.push(hi);
        return v;
    }
    function toArr(v) { return (v instanceof Array) ? v : [v]; }
    function sq(x) { return x * x; }
    function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
    function now() { return new Date().getTime(); }
    function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    function median(a) {
        var b = a.slice(0).sort(function (x, y) { return x - y; });
        var m = Math.floor(b.length / 2);
        return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
    }

    function fmt(x) {
        var s = (Math.round(x * 10) / 10).toFixed(1).split(".");
        return s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + s[1];
    }
    function fmtInt(n) {
        return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
    function fmtDur(sec) {
        if (sec < 90) return "about " + Math.max(1, Math.round(sec)) + " s";
        return "about " + Math.round(sec / 60) + " min";
    }
    function pct(before, after) {
        if (before <= 0) return 0;
        return Math.round((1 - after / before) * 100);
    }
    function num(v, def) {
        var n = parseFloat(String(v).replace(",", ".").replace("−", "-"));
        return isNaN(n) ? def : n;
    }
    function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

    // Maps InDesign special characters (enumerators) to plain characters
    function normChar(c) {
        if (typeof c === "string") return c;
        var n = String(c);
        if (n.indexOf("FORCED_LINE_BREAK") >= 0) return "\n";
        if (n.indexOf("DISCRETIONARY_HYPHEN") >= 0) return "­";
        if (n.indexOf("TAB") >= 0) return "\t";
        if (n.indexOf("SPACE") >= 0) return " ";
        if (n.indexOf("BREAK") >= 0) return "\n";
        if (/NESTED|INDENT_HERE|ZERO_WIDTH|JOINER/.test(n)) return "";
        return "#";
    }

    var RX_INVISIBLE = /^[\s ­ -‍  ⁠　﻿]*$/;
    var RX_WORDCHAR = /[0-9A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;
    var RX_SPLIT = /[\s  -​ 　]+/;
    var RX_TRIM = /^[\s  -​ 　]+|[\s  -​ 　]+$/g;
    var RX_SENT_END = /[.!?…][“”„»«’‘"')\]]*$/;
    var RX_PUNCT_END = /[.,;:!?…“”„»«’‘"')\]]$/;
    var RX_STRIP = /^[„“‚‘»«"'(\[]+|[.,;:!?…“”’»«"')\]]+$/g;

    function isInvisible(s) { return RX_INVISIBLE.test(s); }

    function tokens(text) {
        var t = text.replace(/[­﻿]/g, "").replace(RX_TRIM, "");
        return t ? t.split(RX_SPLIT) : [];
    }

    // Line lengths as a fraction of the column width
    function lens(L) {
        var r = [];
        if (!L || !L.lines) return r;
        for (var i = 0; i < L.lines.length; i++) {
            var l = L.lines[i];
            r.push(l.W > 0 ? clamp((l.W - l.gap) / l.W, 0, 1.02) : 0);
        }
        return r;
    }

    // The words of each line as blocks (start, end) as fractions of the column width
    function segs(L) {
        var out = [];
        if (!L || !L.lines || !L.sh) return out;
        for (var i = 0; i < L.lines.length; i++) {
            var l = L.lines[i], r = [], st = -1;
            for (var k = l.a; k <= l.j; k++) {
                var vis = !isInvisible(L.cs[k]);
                if (vis && st < 0) st = k;
                if (st >= 0 && (!vis || k === l.j)) {
                    var e = vis ? k : k - 1;
                    r.push([clamp((L.sh[st] - l.left) / l.Wpt, 0, 1.05), clamp((L.eh[e] - l.left) / l.Wpt, 0, 1.05)]);
                    st = -1;
                }
            }
            out.push(r);
        }
        return out;
    }

    // ------------------------------------------------------------------
    // Scoring
    // ------------------------------------------------------------------

    // S: the settings (zone, ragStyle, precision)
    function buildParams(S) {
        S = S || {};
        var exact = S.precision === 0;
        var tf = exact ? 0.5 : 1;        // exact: half the tolerances
        var P = {
            wStair: WEIGHTS.stair, wBelly: WEIGHTS.belly, wHollow: WEIGHTS.hollow,
            wHole: WEIGHTS.hole, wDepth: WEIGHTS.depth, wBulge: WEIGHTS.bulge, wFlat: WEIGHTS.flat,
            wLoose: WEIGHTS.loose, wTight: WEIGHTS.tight, wEven: WEIGHTS.even, wRiver: WEIGHTS.river,
            wHyph: WEIGHTS.hyph, wShort: WEIGHTS.shortWord, wSentence: WEIGHTS.sentence, wLast: WEIGHTS.last,
            wAltTarget: WEIGHTS.altTarget, wAltEven: WEIGHTS.altEven,
            zonePct: S.zone || 15,
            style: S.ragStyle === 1 ? "alt" : "natural",
            tolHole: 0.8 * tf, tolBulge: 0.8 * tf, tolStair: 0.3 * tf, tolFlat: 0.25 * tf, tolBelly: 0.5 * tf,
            // alternating: tolerance for lines of a group ending together (em),
            // depth band of the long lines (em), band of the short lines (share of the rag zone)
            tolAlt: exact ? 0.08 : 0.35, tolAltLong: exact ? 0.1 : 0.5, tolAltShort: exact ? 0.05 : 0.25,
            minLast: 0.25, tolLast: 0.5, shortLen: 3,
            wChange: 0.5, wScale: 1,
            stop: {}
        };
        if (exact) P.wEven *= 1.5;       // justified text: stricter about even spacing
        for (var i = 0; i < STOPWORDS.length; i++) P.stop["_" + STOPWORDS[i]] = true;
        return P;
    }

    // Shape of one continuous run of ragged lines (gaps measured in em)
    function shapeSeq(seq, P, parts) {
        var m = seq.length, k, s;
        if (!m) return;
        var g = [];
        for (k = 0; k < m; k++) g.push(seq[k].gap);

        // Rag zone
        var Z = P.zonePct / 100 * seq[0].W;
        for (k = 0; k < m; k++) {
            if (g[k] > Z) parts.depth += P.wDepth * sq(g[k] - Z);
        }
        if (m < 2) return;

        // Holes and protruding lines (direct neighbours)
        for (k = 0; k < m; k++) {
            var nb, f = 1;
            if (k > 0 && k < m - 1) {
                nb = (g[k - 1] + g[k + 1]) / 2;
            } else {
                nb = (k === 0) ? g[1] : g[m - 2];
                f = 0.6;
            }
            var h = g[k] - nb - P.tolHole;
            if (h > 0) parts.hole += f * P.wHole * sq(h);
            var bl = nb - g[k] - P.tolBulge;
            if (bl > 0) parts.bulge += f * P.wBulge * sq(bl);
        }

        // Bellies and hollows: compared with the lines two and three away.
        // A short long rhythm is not penalized.
        for (k = 2; k < m - 2; k++) {
            var belly = 0, hollow = 0;
            for (s = 2; s <= 3; s++) {
                if (k - s < 0 || k + s > m - 1) continue;
                var outer = (g[k - s] + g[k + s]) / 2;
                var inner = 0, cnt = 0;
                for (var q = k - s + 1; q <= k + s - 1; q++) { inner += g[q]; cnt++; }
                inner /= cnt;
                belly = Math.max(belly, outer - inner - P.tolBelly);
                hollow = Math.max(hollow, inner - outer - P.tolBelly);
            }
            if (belly > 0) parts.belly += P.wBelly * sq(belly);
            if (hollow > 0) parts.belly += P.wHollow * sq(hollow);
        }

        // Staircases and an edge that is too uniform
        var run = 0;
        for (k = 1; k < m - 1; k++) {
            var d1 = g[k] - g[k - 1], d2 = g[k + 1] - g[k];
            if (Math.abs(d1) > P.tolStair && Math.abs(d2) > P.tolStair && d1 * d2 > 0) {
                run++;
                parts.stair += P.wStair * sq(Math.min(Math.abs(d1), Math.abs(d2)) + 0.3) * run;
            } else {
                run = 0;
            }
            if (Math.abs(d1) < P.tolFlat && Math.abs(d2) < P.tolFlat) parts.flat += P.wFlat;
        }
    }

    // Alternating style: long and short lines take turns. Long lines should
    // reach the right edge, short lines should end the rag zone deep, and
    // each group should end together. Both phases are tried (first line
    // long or short), the better one counts.
    // Returns the target edge of the short lines as a fraction of the column width.
    function altSeq(seq, P, parts) {
        var m = seq.length, k, p;
        if (!m) return null;
        var W = seq[0].W, D = P.zonePct / 100 * W;
        var tolL = P.tolAltLong, tolS = P.tolAltShort * D, tolE = P.tolAlt;
        var bestPen = null;
        for (p = 0; p < 2; p++) {
            var sl = 0, nl = 0, ss = 0, ns = 0, pen = 0, dv;
            for (k = 0; k < m; k++) {
                var g = seq[k].gap;
                if ((k + p) % 2 === 0) {
                    // long line: from the right edge to tolL deep
                    dv = Math.max(g - tolL, -g, 0);
                    sl += g; nl++;
                } else {
                    // short line: the rag zone deep, give or take tolS
                    dv = Math.max(Math.abs(g - D) - tolS, 0);
                    ss += g; ns++;
                }
                pen += P.wAltTarget * sq(dv);
            }
            // each group ends together
            var lm = sl / nl, sm = ns ? ss / ns : 0;
            for (k = 0; k < m; k++) {
                dv = Math.abs(seq[k].gap - ((k + p) % 2 === 0 ? lm : sm)) - tolE;
                if (dv > 0) pen += P.wAltEven * sq(dv);
            }
            if (bestPen === null || pen < bestPen) bestPen = pen;
        }
        parts.alt += bestPen;
        return [clamp(1 - D / W, 0, 1)];
    }

    function scoreRag(L, P, parts) {
        var ls = L.lines, n = ls.length, i;
        var seq = [], alt = P.style === "alt";
        function flush() {
            if (!seq.length) return;
            if (alt) {
                var g = altSeq(seq, P, parts);
                if (g && !L.guides) L.guides = g;
            } else {
                shapeSeq(seq, P, parts);
            }
            seq = [];
        }
        for (i = 0; i < n; i++) {
            var l = ls[i];
            if (seq.length && seq[seq.length - 1].col !== l.col) flush();
            if (l.end) flush();
            else seq.push(l);
        }
        flush();

        // Last line (and lines before a forced line break)
        for (i = 1; i < n; i++) {
            var e = ls[i], pr = ls[i - 1];
            if (!e.end || pr.end || pr.col !== e.col) continue;
            var len = e.W - e.gap, minLen = P.minLast * e.W;
            if (len < minLen) parts.last += P.wLast * sq(minLen - len) * 0.5;
            if (alt) continue;
            var over = pr.gap - e.gap - P.tolLast;
            if (over > 0) parts.last += P.wLast * sq(over) * 0.5;
        }
    }

    function scoreJust(L, P, parts) {
        var ls = L.lines, n = ls.length, i, s0 = L.s0 || 0.25;
        var prevR = null, prevCol = null;

        // Word spaces: too loose, too tight, uneven
        for (i = 0; i < n; i++) {
            var l = ls[i];
            if (l.end) { prevR = null; continue; }
            if (l.sp < 0) { parts.loose += P.wLoose * 4; prevR = null; continue; }
            var r = l.sp / s0;
            if (r > 1) parts.loose += P.wLoose * sq((r - 1) * 2.5);
            else parts.tight += P.wTight * sq((1 - r) * 2.5);
            if (prevR !== null && prevCol === l.col) parts.even += P.wEven * sq((r - prevR) * 2.5);
            prevR = r;
            prevCol = l.col;
        }

        // Rivers: word spaces stacked on top of each other over three or more lines
        var chains = null, prev = null;
        for (i = 0; i < n; i++) {
            var li = ls[i];
            if (!li.spc || !li.spc.length) { chains = null; prev = li; continue; }
            var tol = Math.max(0.2, s0 * 0.9), nc = [];
            var linked = chains && prev && prev.col === li.col;
            for (var a = 0; a < li.spc.length; a++) {
                var len = 1;
                if (linked) {
                    for (var b = 0; b < prev.spc.length; b++) {
                        if (Math.abs(li.spc[a] - prev.spc[b]) < tol) len = Math.max(len, chains[b] + 1);
                    }
                }
                nc.push(len);
                if (len >= 3) parts.river += P.wRiver * (len - 2);
            }
            chains = nc;
            prev = li;
        }

        // Last line not too short
        for (i = 1; i < n; i++) {
            var e = ls[i];
            if (!e.end || ls[i - 1].end) continue;
            var ln = e.W - e.gap, minLen = P.minLast * e.W;
            if (ln < minLen) parts.last += P.wLast * sq(minLen - ln) * 0.5;
        }
    }

    // Hyphens and words at the line edge, for both kinds of setting
    function scoreCommon(L, P, parts, wordFactor) {
        var ls = L.lines, n = ls.length, i, run = 0;
        for (i = 0; i < n; i++) {
            if (ls[i].hyph) {
                parts.hyph += P.wHyph;
                run++;
                if (run >= 2) parts.hyph += P.wHyph * (run - 1);
            } else {
                run = 0;
            }
        }
        var tk = [];
        for (i = 0; i < n; i++) tk.push(tokens(ls[i].text));
        for (i = 0; i < n; i++) {
            var li = ls[i], t = tk[i];
            if (li.end || li.hyph || !t.length) continue;
            var lastT = t[t.length - 1];
            var punct = RX_PUNCT_END.test(lastT);
            var core = lastT.replace(RX_STRIP, "");
            if (!punct && core.length > 0) {
                // short word or filler word at the end of the line
                if (core.length <= P.shortLen || P.stop["_" + core.toLowerCase()]) parts.words += P.wShort * wordFactor;
                // a new sentence starts with the last word of the line
                var prevT = null;
                if (t.length >= 2) prevT = t[t.length - 2];
                else if (i > 0 && !ls[i - 1].hyph && tk[i - 1].length) prevT = tk[i - 1][tk[i - 1].length - 1];
                if (prevT && RX_SENT_END.test(prevT)) parts.words += P.wSentence * wordFactor;
            }
            // a sentence ends with a single word at the start of the next line
            var nt = (i + 1 < n) ? tk[i + 1] : null;
            if (nt && nt.length >= 2 && RX_SENT_END.test(nt[0]) && !RX_SENT_END.test(lastT)) {
                parts.words += P.wSentence * 0.5 * wordFactor;
            }
        }
    }

    function scoreLayout(L, P) {
        L.guides = null;
        var parts = {
            depth: 0, hole: 0, bulge: 0, belly: 0, stair: 0, flat: 0, alt: 0,
            loose: 0, tight: 0, even: 0, river: 0,
            last: 0, hyph: 0, words: 0
        };
        if (L.mode === "just") {
            scoreJust(L, P, parts);
            scoreCommon(L, P, parts, 0.5);
        } else {
            scoreRag(L, P, parts);
            scoreCommon(L, P, parts, 1);
        }
        L.parts = parts;
        var s = 0, k;
        for (k in parts) if (parts.hasOwnProperty(k)) s += parts[k];
        return s;
    }

    // Cost of the change itself: on a tie, change nothing
    function changeCost(ctx, P) {
        return P.wChange * ctx.costD + P.wScale * ctx.costS;
    }

    // ------------------------------------------------------------------
    // InDesign access
    // ------------------------------------------------------------------

    // styleBase: the paragraph style is the baseline (for text processed before)
    function initContext(p, styleBase, mode) {
        var chars = p.characters;
        var ctx = {
            para: p, chars: chars, n: chars.length, start: p.index, mode: mode || "rag",
            cs: [], curD: [], curS: [], origT: [], origS: [],
            costD: 0, costS: 0, geo: {}
        };
        var raw = toArr(chars.everyItem().contents);
        var tr = toArr(chars.everyItem().tracking);
        var hs = toArr(chars.everyItem().horizontalScale);
        var bt = null, bs = null;
        if (styleBase) {
            try {
                bt = p.appliedParagraphStyle.tracking;
                bs = p.appliedParagraphStyle.horizontalScale;
            } catch (e) { bt = null; }
        }
        for (var k = 0; k < ctx.n; k++) {
            ctx.cs.push(normChar(raw[k]));
            if (bt !== null) {
                ctx.origT.push(bt);
                ctx.origS.push(bs);
                ctx.curD.push(tr[k] - bt);
                ctx.curS.push(hs[k] - bs);
                ctx.costD += Math.abs(tr[k] - bt) / 1000;
                ctx.costS += Math.abs(hs[k] - bs) / 200;
            } else {
                ctx.origT.push(tr[k]);
                ctx.origS.push(hs[k]);
                ctx.curD.push(0);
                ctx.curS.push(0);
            }
        }
        ctx.em = chars[0].pointSize;
        ctx.leftIndent = p.leftIndent;
        ctx.rightIndent = p.rightIndent;
        return ctx;
    }

    function storyIsMarked(story) {
        try { return story.extractLabel(LABEL_KEY) === "1"; } catch (e) { return false; }
    }

    function makeContext(target) {
        var p = target.story.characters[target.start].paragraphs[0];
        var J = p.justification, mode = null;
        if (J == Justification.LEFT_ALIGN) mode = "rag";
        else if (J == Justification.LEFT_JUSTIFIED || J == Justification.FULLY_JUSTIFIED ||
            J == Justification.CENTER_JUSTIFIED || J == Justification.RIGHT_JUSTIFIED) mode = "just";
        if (!mode) return { skip: "right aligned or centered" };
        if (p.characters.length < 2) return { skip: "quiet" };
        var ctx = initContext(p, storyIsMarked(target.story), mode);
        ctx.lastStretched = (J == Justification.FULLY_JUSTIFIED);
        return ctx;
    }

    function frameGeo(ctx, fr) {
        var id;
        try { id = fr.id; } catch (e) { return null; }
        if (ctx.geo.hasOwnProperty("_" + id)) return ctx.geo["_" + id];
        var g = null;
        try {
            if (Math.abs(fr.absoluteRotationAngle) < 0.01) {
                var gb = fr.geometricBounds;
                var tp = fr.textFramePreferences;
                var ins = tp.insetSpacing;
                var il = (ins instanceof Array) ? ins[1] : ins;
                var ir = (ins instanceof Array) ? ins[3] : ins;
                var left = gb[1] + il, right = gb[3] - ir;
                var cc = Math.max(1, tp.textColumnCount);
                var gut = tp.textColumnGutter;
                var colW = tp.useFixedColumnWidth ? tp.textColumnFixedWidth : (right - left - (cc - 1) * gut) / cc;
                g = { id: id, left: left, cc: cc, gut: gut, colW: colW };
            }
        } catch (e2) {
            g = null;
        }
        ctx.geo["_" + id] = g;
        return g;
    }

    // Reads the current line breaks of the paragraph with a few bulk queries
    function readLayout(ctx) {
        var out = { ok: true, lines: [], mode: ctx.mode, cs: ctx.cs };
        try {
            var p = ctx.para, chars = ctx.chars;
            var lastFr = chars[ctx.n - 1].parentTextFrames;
            var firstFr = chars[0].parentTextFrames;
            if (!lastFr || !lastFr.length || !firstFr || !firstFr.length) {
                out.ok = false; out.why = "overset text"; return out;
            }
            var lineIdx = toArr(p.lines.everyItem().index);
            var m = lineIdx.length;
            var endH = toArr(chars.everyItem().endHorizontalOffset);
            var startH = toArr(chars.everyItem().horizontalOffset);
            var single = (firstFr[0].id === lastFr[0].id);
            var frames = single ? null : toArr(p.lines.everyItem().parentTextFrames);
            var em = ctx.em;
            out.sh = startH;
            out.eh = endH;

            for (var i = 0; i < m; i++) {
                var a = lineIdx[i] - ctx.start;
                var b = (i < m - 1) ? lineIdx[i + 1] - ctx.start - 1 : ctx.n - 1;
                var fr = single ? firstFr[0] : toArr(frames[i])[0];
                var geo = frameGeo(ctx, fr);
                if (!geo) { out.ok = false; out.why = "frame cannot be measured"; return out; }

                var lastCh = ctx.cs[b];
                var isLast = (i === m - 1);
                var forced = (lastCh === "\n");
                var j = b;
                while (j >= a && isInvisible(ctx.cs[j])) j--;
                var softHy = (lastCh === "­");
                var autoHy = !isLast && !forced && (softHy || (j === b && RX_WORDCHAR.test(lastCh)));
                var hardHy = !isLast && !forced && j === b && (lastCh === "-" || lastCh === "‐");

                var x0 = startH[a];
                var col = clamp(Math.floor((x0 - geo.left + geo.gut / 2) / (geo.colW + geo.gut)), 0, geo.cc - 1);
                var colLeft = geo.left + col * (geo.colW + geo.gut);
                var right = colLeft + geo.colW - ctx.rightIndent;
                var width = geo.colW - ctx.leftIndent - ctx.rightIndent;
                var x1 = (j >= a) ? endH[j] : x0;
                if (autoHy) x1 += 0.3 * em; // the set hyphen is not part of the text

                var line = {
                    a: a, b: b, j: j,
                    gap: (right - x1) / em,
                    W: width / em,
                    left: colLeft + ctx.leftIndent,
                    Wpt: width,
                    col: geo.id + "_" + col,
                    end: isLast || forced,
                    last: isLast,
                    hyph: autoHy || hardHy,
                    text: ctx.cs.slice(a, b + 1).join("")
                };

                if (ctx.mode === "just") {
                    var cnt = 0, sum = 0, centers = [];
                    for (var k = a; k < j; k++) {
                        if (ctx.cs[k] !== " ") continue;
                        sum += endH[k] - startH[k];
                        cnt++;
                        centers.push(((startH[k] + endH[k]) / 2 - line.left) / em);
                    }
                    line.sp = cnt ? sum / cnt / em : -1;
                    line.spc = centers;
                }
                out.lines.push(line);
            }

            // Natural word space: measured once from the unstretched lines
            if (ctx.mode === "just") {
                if (ctx.s0 === undefined) ctx.s0 = naturalSpace(ctx, out, startH, endH);
                out.s0 = ctx.s0;
            }
        } catch (err) {
            out.ok = false;
            out.why = "cannot be measured";
        }
        return out;
    }

    function naturalSpace(ctx, L, startH, endH) {
        var nat = [], all = [], k, i, l;
        for (i = 0; i < L.lines.length; i++) {
            l = L.lines[i];
            var unstretched = l.end && !(l.last && ctx.lastStretched);
            for (k = l.a; k < l.j; k++) {
                if (ctx.cs[k] !== " ") continue;
                var wd = (endH[k] - startH[k]) / ctx.em - (ctx.origT[k] + ctx.curD[k]) / 1000;
                if (unstretched) nat.push(wd); else all.push(wd);
            }
        }
        if (nat.length) return clamp(median(nat), 0.12, 0.5);
        if (!all.length) return 0.25;
        // no unstretched line: use the lower quarter of the measured spaces
        all.sort(function (x, y) { return x - y; });
        return clamp(all[Math.floor(all.length / 4)], 0.15, 0.3);
    }

    // Writes tracking (isT) or horizontal scale for the characters a..b.
    // want holds the desired offsets from the baseline. Consecutive equal
    // values are written in one call.
    function writeProp(ctx, a, b, want, isT) {
        var cur = isT ? ctx.curD : ctx.curS;
        var orig = isT ? ctx.origT : ctx.origS;
        var k = a;
        while (k <= b) {
            var w = want[k - a];
            if (w === cur[k]) { k++; continue; }
            var val = orig[k] + w, e = k;
            while (e + 1 <= b && want[e + 1 - a] !== cur[e + 1] && orig[e + 1] + want[e + 1 - a] === val) e++;
            var rng = (e === k) ? ctx.chars[k] : ctx.chars.itemByRange(k, e);
            if (isT) rng.tracking = val;
            else rng.horizontalScale = val;
            for (var q = k; q <= e; q++) {
                var nw = want[q - a];
                if (isT) ctx.costD += (Math.abs(nw) - Math.abs(cur[q])) / 1000;
                else ctx.costS += (Math.abs(nw) - Math.abs(cur[q])) / 200;
                cur[q] = nw;
            }
            k = e + 1;
        }
    }

    function applyRange(ctx, a, b, d, s) {
        var wd = [], ws = [];
        for (var k = a; k <= b; k++) { wd.push(d); ws.push(s); }
        writeProp(ctx, a, b, wd, true);
        writeProp(ctx, a, b, ws, false);
    }

    function snapshot(ctx, a, b) {
        return { a: a, b: b, d: ctx.curD.slice(a, b + 1), s: ctx.curS.slice(a, b + 1) };
    }

    function restore(ctx, snap) {
        writeProp(ctx, snap.a, snap.b, snap.d, true);
        writeProp(ctx, snap.a, snap.b, snap.s, false);
    }

    function sameState(ctx, a, b, d, s) {
        for (var k = a; k <= b; k++) {
            if (ctx.curD[k] !== d || ctx.curS[k] !== s) return false;
        }
        return true;
    }

    var API = { read: readLayout, apply: applyRange, snapshot: snapshot, restore: restore };

    // ------------------------------------------------------------------
    // Optimization
    // ------------------------------------------------------------------

    function optimize(ctx, P, stageList, api, hooks, searchTime) {
        var L = api.read(ctx);
        if (!L.ok) return { skip: L.why };
        var nLines = L.lines.length;
        if (nLines < 2) return { skip: "quiet" };

        var cur = scoreLayout(L, P) + changeCost(ctx, P);
        var res = { before: cur, after: cur, tries: 0, kicks: 0, lines: nLines, L: L, timeout: false, stopped: false };
        var t0 = now();
        // searchTime < 0 means: search until no further improvement turns up
        var auto = searchTime < 0;
        var budgetEnd = t0 + (auto ? AUTO_CAP : Math.max(1, searchTime || 0)) * 1000;
        var hardEnd = auto ? budgetEnd : t0 + Math.max(TIME_LIMIT, searchTime || 0) * 1000;
        var patience = Math.max(AUTO_PATIENCE, nLines * 5), failStreak = 0;
        var best = null, snap = null, halt = false, firstPassDone = false;
        var gScore = cur, gL = L;

        // The first round always runs to the end, after that the search time counts
        function mustStop() {
            if (now() > hardEnd) { res.timeout = true; return true; }
            if (firstPassDone && now() > budgetEnd) return true;
            if (hooks && hooks.shouldStop && hooks.shouldStop()) { res.stopped = true; return true; }
            return false;
        }

        // Reports every attempt to the live view
        function show(tryL, sc) {
            if (!hooks || !hooks.onTry) return;
            var bs = gScore, bL = gL;
            if (best && best.L && best.score < bs) { bs = best.score; bL = best.L; }
            hooks.onTry(res.tries, tryL, sc, bs, bL);
        }

        function evalMove(moves) {
            res.tries++;
            var live = hooks && hooks.liveDoc && hooks.liveDoc();
            if (live) hooks.redraw(true);
            for (var z = 0; z < moves.length; z++) api.apply(ctx, moves[z].a, moves[z].b, moves[z].d, moves[z].s);
            if (live) hooks.redraw(false);
            var L2 = api.read(ctx), sc = null;
            if (L2.ok) {
                sc = scoreLayout(L2, P) + changeCost(ctx, P);
                if (L2.lines.length !== nLines) sc = null;
                else if (sc < best.score - 0.01) best = { score: sc, moves: moves, L: L2 };
            }
            show(L2.ok ? L2 : null, sc);
            api.restore(ctx, snap);
        }

        // Tries all values for one line (and optionally the next one) and keeps the best
        function improveLine(i, stage, pair) {
            var ln = L.lines[i], a = ln.a, b = ln.b, q, d, s, d2;
            var nx = (pair && i + 1 < L.lines.length) ? L.lines[i + 1] : null;
            snap = api.snapshot(ctx, a, nx ? nx.b : b);
            best = { score: cur, moves: null, L: null };
            var sBase = ctx.curS[a];

            for (q = 0; q < stage.t.length; q++) {
                d = stage.t[q];
                if (sameState(ctx, a, b, d, sBase)) continue;
                evalMove([{ a: a, b: b, d: d, s: sBase }]);
            }
            if (stage.s.length > 1) {
                var dB = best.moves ? best.moves[0].d : ctx.curD[a];
                for (q = 0; q < stage.s.length; q++) {
                    s = stage.s[q];
                    if (sameState(ctx, a, b, dB, s)) continue;
                    evalMove([{ a: a, b: b, d: dB, s: s }]);
                }
            }
            if (nx) {
                var sN = ctx.curS[nx.a], co = stage.coarse;
                for (var u = 0; u < co.length; u++) {
                    for (var v = 0; v < co.length; v++) {
                        d = co[u]; d2 = co[v];
                        if (sameState(ctx, a, b, d, sBase) && sameState(ctx, nx.a, nx.b, d2, sN)) continue;
                        evalMove([{ a: a, b: b, d: d, s: sBase }, { a: nx.a, b: nx.b, d: d2, s: sN }]);
                    }
                }
            }

            var ok = false;
            if (best.moves) {
                for (q = 0; q < best.moves.length; q++) {
                    var mv = best.moves[q];
                    api.apply(ctx, mv.a, mv.b, mv.d, mv.s);
                }
                L = best.L;
                cur = best.score;
                ok = true;
            }
            best = null;
            return ok;
        }

        function coarseOf(tv) {
            var lo = 0, hi = 0;
            for (var q = 0; q < tv.length; q++) { if (tv[q] < lo) lo = tv[q]; if (tv[q] > hi) hi = tv[q]; }
            var c = [lo, Math.round(lo / 2), 0, Math.round(hi / 2), hi], r = [], seen = {};
            for (q = 0; q < c.length; q++) if (!seen["_" + c[q]]) { seen["_" + c[q]] = true; r.push(c[q]); }
            return r;
        }

        // 1. Improve line by line, stage by stage
        var lastStage = null;
        for (var st = 0; st < stageList.length && !halt; st++) {
            if (st > 0 && cur <= GOAL_PER_LINE * nLines) break;
            var stage = stageList[st];
            stage.coarse = coarseOf(stage.t);
            lastStage = stage;
            for (var pass = 0; pass < stage.passes && !halt; pass++) {
                var improved = false;
                for (var i = 0; i < L.lines.length; i++) {
                    if (mustStop()) { halt = true; break; }
                    if (improveLine(i, stage, pass > 0)) { improved = true; gScore = cur; gL = L; }
                }
                firstPassDone = true;
                if (!improved) break;
            }
        }

        // 2. Keep searching until the search time is used up: shift a few
        //    lines at random, improve from there, keep only improvements
        while (!halt && lastStage && now() < budgetEnd && cur > 0.05 && (!auto || failStreak < patience)) {
            if (mustStop()) break;
            var keep = api.snapshot(ctx, 0, ctx.n - 1), keepScore = cur, keepL = L;
            gScore = cur;
            gL = L;
            var m = L.lines.length;
            var i0 = Math.floor(Math.random() * m);
            var i1 = Math.min(m - 1, i0 + Math.floor(Math.random() * 3));
            var j;
            res.tries++;
            for (j = i0; j <= i1; j++) api.apply(ctx, L.lines[j].a, L.lines[j].b, pick(lastStage.t), pick(lastStage.s));
            var L2 = api.read(ctx), sc = null;
            if (L2.ok && L2.lines.length === nLines) sc = scoreLayout(L2, P) + changeCost(ctx, P);
            show(L2.ok ? L2 : null, sc);
            if (sc === null) { api.restore(ctx, keep); failStreak++; continue; }
            L = L2;
            cur = sc;
            var lo = Math.max(0, i0 - 1), hi = Math.min(m - 1, i1 + 1);
            for (var round = 0; round < 2 && !halt; round++) {
                var imp = false;
                for (j = lo; j <= hi; j++) {
                    if (mustStop()) { halt = true; break; }
                    if (improveLine(j, lastStage, false)) imp = true;
                }
                if (!imp) break;
            }
            if (cur < keepScore - 0.01) {
                res.kicks++;
                failStreak = 0;
            } else {
                failStreak++;
                api.restore(ctx, keep);
                cur = keepScore;
                L = keepL;
            }
        }

        res.converged = auto && failStreak >= patience;
        res.after = cur;
        res.L = L;
        return res;
    }

    // ------------------------------------------------------------------
    // Finding the paragraphs automatically
    // ------------------------------------------------------------------

    function collectTargets(rep) {
        var doc = app.activeDocument, sel = app.selection;
        var list = [], seen = {}, stories = {}, nStories = 0, mode = "doc";

        function add(p) {
            try {
                var pc = p.parent.constructor.name;
                if (pc === "Cell" || pc === "Footnote") { countSkip(rep, "table or footnote"); return; }
                var st = p.parentStory, key = "_" + st.id + ":" + p.index;
                if (seen[key]) return;
                seen[key] = true;
                if (!stories["_" + st.id]) { stories["_" + st.id] = true; nStories++; }
                list.push({ story: st, start: p.index });
            } catch (e) {}
        }
        function addAll(coll) {
            if (!coll || !coll.length) return;
            var arr = coll.everyItem().getElements();
            for (var i = 0; i < arr.length; i++) add(arr[i]);
        }
        function addFrame(fr) {
            try { addAll(fr.parentStory.paragraphs); mode = (mode === "text") ? "text" : "story"; } catch (e) {}
        }

        if (sel && sel.length) {
            for (var j = 0; j < sel.length; j++) {
                var it = sel[j], cn = "";
                try { cn = it.constructor.name; } catch (e) {}
                if (cn === "TextFrame") {
                    addFrame(it);
                } else if (it.hasOwnProperty("parentStory") && it.hasOwnProperty("paragraphs")) {
                    addAll(it.paragraphs);
                    mode = "text";
                } else if (it.hasOwnProperty("allPageItems")) {
                    var items = it.allPageItems;
                    for (var i = 0; i < items.length; i++) {
                        if (items[i].constructor.name === "TextFrame") addFrame(items[i]);
                    }
                }
            }
        }
        if (!list.length) {
            mode = "doc";
            var st = doc.stories.everyItem().getElements();
            for (var k = 0; k < st.length; k++) addAll(st[k].paragraphs);
        }
        var where = mode === "text" ? "in the selected text"
            : mode === "story" ? (nStories === 1 ? "in the story" : "in " + nStories + " stories")
            : "in the whole document";
        return { list: list, where: where };
    }

    function countSkip(rep, why) {
        if (why === "quiet") { rep.quiet++; return; }
        rep.skips["_" + why] = (rep.skips["_" + why] || 0) + 1;
    }

    function skipText(rep) {
        var parts = [], k;
        for (k in rep.skips) if (rep.skips.hasOwnProperty(k)) parts.push(k.substring(1) + ": " + rep.skips[k]);
        return parts.length ? "Skipped, " + parts.join(", ") : "";
    }

    // ------------------------------------------------------------------
    // Remembering the settings
    // ------------------------------------------------------------------

    function settingsFile() { return File(Folder.userData + "/BetterSet_Settings.txt"); }

    function loadSettings() {
        var S = {}, k;
        for (k in DEFAULTS) if (DEFAULTS.hasOwnProperty(k)) S[k] = DEFAULTS[k];
        var f = settingsFile();
        try {
            if (f.exists) {
                f.open("r");
                var txt = f.read();
                f.close();
                for (k in S) {
                    if (!S.hasOwnProperty(k)) continue;
                    var m = new RegExp(k + "=(-?[0-9.]+)").exec(txt);
                    if (m) S[k] = parseFloat(m[1]);
                }
            }
        } catch (e) { try { f.close(); } catch (e2) {} }
        return S;
    }

    function saveSettings(S) {
        var f = settingsFile(), lines = [], k;
        for (k in DEFAULTS) if (DEFAULTS.hasOwnProperty(k)) lines.push(k + "=" + S[k]);
        try { f.open("w"); f.write(lines.join("\n")); f.close(); } catch (e) { try { f.close(); } catch (e2) {} }
    }

    // ------------------------------------------------------------------
    // Interface
    // ------------------------------------------------------------------

    function ink(el, col) {
        try { el.graphics.foregroundColor = el.graphics.newPen(el.graphics.PenType.SOLID_COLOR, col, 1); } catch (e) {}
    }
    function setFont(el, size, bold) {
        var style = bold ? "BOLD" : "REGULAR";
        try { el.graphics.font = ScriptUI.newFont(FONT_FAMILY, style, size); }
        catch (e) { try { el.graphics.font = ScriptUI.newFont("dialog", style, size); } catch (e2) {} }
    }
    function label(parent, str, size, col, bold, width) {
        var t = parent.add("statictext", undefined, str);
        setFont(t, size, bold);
        if (col === COL.accent) ink(t, col);
        if (width) t.preferredSize.width = width;
        return t;
    }
    function spacer(parent, h) {
        var g = parent.add("group");
        g.preferredSize = [10, h];
        return g;
    }

    // Forces a custom drawn element to redraw
    function redraw(el) {
        var before = el.draws;
        try { el.notify("onDraw"); } catch (e) {}
        if (el.draws === before) {
            try { el.visible = false; el.visible = true; } catch (e2) {}
        }
    }

    // Live drawing: each line with its words as blocks.
    // Grey behind it the starting length, orange the best state so far.
    function makeCanvas(parent, width, height) {
        var cv = parent.add("group");
        cv.preferredSize = [width, height];
        cv.minimumSize = [width, height];
        cv.ghost = [];
        cv.cur = [];
        cv.best = [];
        cv.guides = [];
        cv.draws = 0;
        cv.onDraw = function () {
            this.draws++;
            var g = this.graphics, W = this.size.width, H = this.size.height;
            g.newPath(); g.rectPath(0, 0, W, H); g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, COL.bg));
            g.newPath(); g.rectPath(0, 0, W, H); g.strokePath(g.newPen(g.PenType.SOLID_COLOR, COL.ghost, 1));
            var x0 = 8, usable = W - 16;
            g.newPath(); g.moveTo(x0 + usable + 0.5, 4); g.lineTo(x0 + usable + 0.5, H - 4);
            g.strokePath(g.newPen(g.PenType.SOLID_COLOR, COL.edge, 1));
            var gp = g.newPen(g.PenType.SOLID_COLOR, COL.accent, 1), q;
            for (q = 0; q < this.guides.length; q++) {
                var gx = x0 + this.guides[q] * usable + 0.5;
                for (var yy = 4; yy < H - 4; yy += 6) { g.newPath(); g.moveTo(gx, yy); g.lineTo(gx, Math.min(yy + 3, H - 4)); g.strokePath(gp); }
            }
            var n = Math.max(this.ghost.length, this.cur.length);
            if (!n) return;
            var pitch = Math.min(12, (H - 16) / n), bh = Math.max(1, pitch * 0.72);
            var y0 = Math.max(8, (H - pitch * n) / 2);
            var gb = g.newBrush(g.BrushType.SOLID_COLOR, COL.ghost);
            var fb = g.newBrush(g.BrushType.SOLID_COLOR, COL.fg);
            var ab = g.newBrush(g.BrushType.SOLID_COLOR, COL.accent);
            var i, y, k;
            for (i = 0; i < this.ghost.length; i++) {
                y = y0 + i * pitch;
                g.newPath(); g.rectPath(x0, y, Math.max(1, this.ghost[i] * usable), bh); g.fillPath(gb);
            }
            for (i = 0; i < this.cur.length; i++) {
                y = y0 + i * pitch;
                var row = this.cur[i];
                for (k = 0; k < row.length; k++) {
                    g.newPath();
                    g.rectPath(x0 + row[k][0] * usable, y, Math.max(0.7, (row[k][1] - row[k][0]) * usable), bh);
                    g.fillPath(fb);
                }
            }
            for (i = 0; i < this.best.length; i++) {
                y = y0 + i * pitch;
                g.newPath(); g.rectPath(x0 + this.best[i] * usable - 1, y - 2, 2, bh + 4); g.fillPath(ab);
            }
        };
        cv.setData = function (gh, cu, be, gd) {
            if (gh) this.ghost = gh;
            if (cu) this.cur = cu;
            if (be) this.best = be;
            if (gd) this.guides = gd;
            redraw(this);
        };
        return cv;
    }

    function makeBar(parent, width, height) {
        var pb = parent.add("group");
        pb.preferredSize = [width, height];
        pb.minimumSize = [width, height];
        pb.value = 0;
        pb.draws = 0;
        pb.onDraw = function () {
            this.draws++;
            var g = this.graphics, W = this.size.width, H = this.size.height;
            g.newPath(); g.rectPath(0, 0, W, H); g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, COL.ghost));
            var f = clamp(this.value, 0, 1);
            if (f > 0) { g.newPath(); g.rectPath(0, 0, W * f, H); g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, COL.accent)); }
        };
        pb.setValue = function (v) { this.value = v; redraw(this); };
        return pb;
    }

    function headRow(parent, left, width) {
        var row = parent.add("group");
        row.orientation = "row";
        row.alignChildren = ["fill", "center"];
        var l = label(row, left, 10, COL.dim, true, width / 2);
        var r = label(row, " ", 10, COL.dim, false, width / 2);
        r.justify = "right";
        return { left: l, right: r };
    }

    function buttonRow(parent) {
        var g = parent.add("group");
        g.alignment = "right";
        g.spacing = 8;
        return g;
    }

    function settingRow(parent, title) {
        var g = parent.add("group");
        g.orientation = "row";
        g.alignChildren = ["left", "center"];
        label(g, title, 13, COL.fg, true, 110);
        return g;
    }
    function field(g, value, chars) {
        var e = g.add("edittext", undefined, String(value));
        e.characters = chars;
        return e;
    }

    // Overlay while working
    function makeOverlay() {
        var WD = 480;
        var w = new Window("palette", SCRIPT_NAME, undefined, { closeButton: false });
        w.orientation = "column";
        w.alignChildren = ["fill", "top"];
        w.margins = [30, 24, 30, 22];
        w.spacing = 4;

        var head = headRow(w, "BETTERSET", WD);
        spacer(w, 6);
        label(w, "LIVE SCORE", 10, COL.dim, true, WD);
        var tScore = label(w, "0.0", 64, COL.fg, true, WD);
        var tSub = label(w, " ", 12, COL.dim, false, WD);
        spacer(w, 14);
        var cv = makeCanvas(w, WD, 200);
        spacer(w, 4);
        var tStatus = label(w, " ", 11, COL.dim, false, WD);
        label(w, "Black the current attempt, grey the starting length, orange the best state, dashed the target of the short lines", 10, COL.dim, false, WD);
        spacer(w, 10);
        var bar = makeBar(w, WD, 3);
        spacer(w, 6);
        var foot = headRow(w, " ", WD);
        setFont(foot.left, 10, false);
        foot.right.text = "Hold Esc to stop";

        w.layout.layout(true);
        try { w.center(); } catch (e) {}
        w.show();

        var last = 0, lastEsc = 0, esc = false;
        return {
            due: function () { return now() - last >= 16; },
            set: function (o, force) {
                if (!force && now() - last < 16) return;
                last = now();
                try {
                    if (o.head !== undefined) head.right.text = o.head;
                    if (o.score !== undefined) tScore.text = fmt(o.score);
                    if (o.sub !== undefined) tSub.text = o.sub;
                    if (o.status !== undefined) tStatus.text = o.status;
                    if (o.tries !== undefined) foot.left.text = "Variants " + fmtInt(o.tries);
                    if (o.ghost || o.cur || o.best || o.guides) cv.setData(o.ghost, o.cur, o.best, o.guides);
                    if (o.progress !== undefined) bar.setValue(o.progress);
                    w.update();
                } catch (e) {}
            },
            escape: function () {
                if (esc) return true;
                if (now() - lastEsc < 100) return false;
                lastEsc = now();
                try { esc = (ScriptUI.environment.keyboardState.keyName === "Escape"); } catch (e) {}
                return esc;
            },
            close: function () { try { w.close(); } catch (e) {} }
        };
    }

    // Start window: score and settings
    function startDialog(info, S) {
        var WD = 480;
        var w = new Window("dialog", SCRIPT_NAME);
        w.orientation = "column";
        w.alignChildren = ["fill", "top"];
        w.margins = [30, 24, 30, 22];
        w.spacing = 4;

        var head = headRow(w, "BETTERSET", WD);
        head.right.text = plural(info.count, "paragraph", "paragraphs") + " " + info.where;
        spacer(w, 6);
        var tTotal = label(w, fmt(info.total), 64, COL.fg, true, WD);
        label(w, "Current score, lower is better.   " + info.mix, 12, COL.dim, false, WD);
        spacer(w, 14);
        var cv = makeCanvas(w, WD, 120);
        cv.cur = info.worst.seg;
        spacer(w, 4);
        var tWorst = label(w, "Roughest paragraph: score " + fmt(info.worst.score), 11, COL.dim, false, WD);
        if (info.skip) label(w, info.skip, 11, COL.dim, false, WD);
        spacer(w, 16);

        var gT = settingRow(w, "Tracking");
        gT.add("statictext", undefined, "from");
        var eMin = field(gT, S.tMin, 4);
        gT.add("statictext", undefined, "to");
        var eMax = field(gT, S.tMax, 4);
        gT.add("statictext", undefined, "step");
        var eStep = field(gT, S.tStep, 3);
        gT.add("statictext", undefined, "1/1000 em");

        var gS = settingRow(w, "Scaling");
        gS.add("statictext", undefined, "up to ±");
        var eScale = field(gS, S.scale, 3);
        gS.add("statictext", undefined, "%   (0 = off)");

        var gR = settingRow(w, "Rag style");
        var rbNat = gR.add("radiobutton", undefined, "Natural");
        var rbAlt = gR.add("radiobutton", undefined, "Alternating long short");
        rbNat.value = S.ragStyle !== 1;
        rbAlt.value = S.ragStyle === 1;

        var gP = settingRow(w, "Precision");
        var rbExact = gP.add("radiobutton", undefined, "Exact");
        var rbOpt = gP.add("radiobutton", undefined, "Optical, more tolerance");
        rbExact.value = S.precision === 0;
        rbOpt.value = S.precision !== 0;

        var gZ = settingRow(w, "Rag zone");
        var eZone = field(gZ, S.zone, 4);
        var tZone = gZ.add("statictext", undefined, "");
        tZone.preferredSize.width = 300;

        var gF = settingRow(w, "Search");
        var rbFixed = gF.add("radiobutton", undefined, "fixed time");
        var eSearch = field(gF, S.search, 4);
        gF.add("statictext", undefined, "seconds per paragraph");
        var gA = settingRow(w, " ");
        var rbAuto = gA.add("radiobutton", undefined, "until no further improvement turns up");
        rbFixed.value = !S.untilBest;
        rbAuto.value = !!S.untilBest;

        spacer(w, 4);
        var tEst = label(w, " ", 11, COL.dim, false, WD);
        tEst.preferredSize.height = 32;
        function updateEst() {
            eSearch.enabled = rbFixed.value;
            if (rbAuto.value) {
                tEst.text = "Each paragraph is finished once " + AUTO_PATIENCE + " or more attempts in a row find nothing better, " +
                    "at most " + Math.round(AUTO_CAP / 60) + " min per paragraph.";
            } else {
                var s = clamp(num(eSearch.text, S.search), 1, 600);
                tEst.text = "More search time means more variants. Total time up to " + fmtDur(info.count * s) + ".";
            }
        }
        rbFixed.onClick = function () { rbFixed.value = true; rbAuto.value = false; updateEst(); };
        rbAuto.onClick = function () { rbAuto.value = true; rbFixed.value = false; updateEst(); };
        updateEst();
        eSearch.onChanging = updateEst;

        // The score reacts to rag style, precision and rag zone right away
        function rescore() {
            tZone.text = rbAlt.value ? "% of the column width, depth of the short lines"
                : "% of the column width, ragged text only";
            var z = num(eZone.text, NaN);
            if (isNaN(z) || z < 3 || z > 60) return;
            var r = info.rescore({ zone: z, ragStyle: rbAlt.value ? 1 : 0, precision: rbExact.value ? 0 : 1 });
            tTotal.text = fmt(r.total);
            tWorst.text = "Roughest paragraph: score " + fmt(r.worst.score);
            cv.setData(null, r.worst.seg, null, r.worst.guides || []);
        }
        eZone.onChanging = rescore;
        rbNat.onClick = rbAlt.onClick = rbExact.onClick = rbOpt.onClick = rescore;
        rescore();

        spacer(w, 14);
        var gB = buttonRow(w);
        gB.add("button", undefined, "Cancel", { name: "cancel" });
        gB.add("button", undefined, "Optimize", { name: "ok" });

        if (w.show() !== 1) return null;
        var R = {
            tMin: clamp(Math.round(num(eMin.text, S.tMin)), -200, 0),
            tMax: clamp(Math.round(num(eMax.text, S.tMax)), 0, 200),
            tStep: clamp(Math.round(Math.abs(num(eStep.text, S.tStep))), 1, 50),
            scale: clamp(Math.round(Math.abs(num(eScale.text, S.scale))), 0, 5),
            zone: clamp(num(eZone.text, S.zone), 3, 60),
            search: clamp(num(eSearch.text, S.search), 1, 600),
            untilBest: rbAuto.value ? 1 : 0,
            ragStyle: rbAlt.value ? 1 : 0,
            precision: rbExact.value ? 0 : 1
        };
        if (R.tMin === 0 && R.tMax === 0) R.tMin = -1;
        return R;
    }

    // Result: score before and after, biggest improvement, undo
    function resultDialog(rep, secs) {
        var WD = 480;
        var w = new Window("dialog", SCRIPT_NAME);
        w.orientation = "column";
        w.alignChildren = ["fill", "top"];
        w.margins = [30, 24, 30, 22];
        w.spacing = 4;

        var head = headRow(w, "BETTERSET", WD);
        head.right.text = rep.stopped ? "Stopped" : "Done";
        spacer(w, 6);
        label(w, fmt(rep.totalBefore) + "  →  " + fmt(rep.totalAfter), 44, COL.fg, true, WD);
        var p = pct(rep.totalBefore, rep.totalAfter);
        if (rep.changed && p > 0) label(w, "−" + p + " %", 22, COL.accent, true, WD);
        else label(w, "No improvement found, the text stays as it is.", 12, COL.dim, false, WD);
        spacer(w, 6);
        label(w, plural(rep.done, "paragraph", "paragraphs") + ", " + rep.changed + " improved, " +
            fmtInt(rep.tries) + " variants, " + fmt(secs) + " s", 11, COL.dim, false, WD);
        if (rep.stopped) label(w, "Improvements made so far are kept.", 11, COL.dim, false, WD);
        if (rep.timeouts) label(w, "Time limit reached for " + plural(rep.timeouts, "paragraph", "paragraphs") + ".", 11, COL.dim, false, WD);
        if (rep.converged) label(w, plural(rep.converged, "paragraph", "paragraphs") + " searched until no further improvement turned up.", 11, COL.dim, false, WD);
        var sk = skipText(rep);
        if (sk) label(w, sk, 10, COL.dim, false, WD);

        if (rep.bestImp && rep.bestImp.gain > 0.01) {
            spacer(w, 14);
            var cv = makeCanvas(w, WD, 120);
            cv.ghost = rep.bestImp.ghost;
            cv.cur = rep.bestImp.cur;
            spacer(w, 4);
            label(w, "Biggest improvement: paragraph " + rep.bestImp.idx + ", " + fmt(rep.bestImp.before) +
                " → " + fmt(rep.bestImp.after) + "   (grey the starting length)", 10, COL.dim, false, WD);
        }

        spacer(w, 14);
        var gB = buttonRow(w);
        if (rep.changed) {
            var bU = gB.add("button", undefined, "Undo");
            bU.onClick = function () { w.close(2); };
        }
        gB.add("button", undefined, "Done", { name: "ok" });
        return w.show() === 2 ? "undo" : "done";
    }

    // ------------------------------------------------------------------
    // Run
    // ------------------------------------------------------------------

    function subText(start, current) {
        var p = pct(start, current);
        return "Best so far " + fmt(current) + "   Start " + fmt(start) + (p > 0 ? "   −" + p + " %" : "");
    }

    function setRedraw(on) {
        try { app.scriptPreferences.enableRedraw = on; } catch (e) {}
    }

    // Brings the spread of the paragraph into the window
    function showInWindow(tg) {
        try {
            var pg = tg.ctx.chars[0].parentTextFrames[0].parentPage;
            if (pg && app.activeWindow.activeSpread !== pg.parent) {
                setRedraw(true);
                app.activeWindow.activeSpread = pg.parent;
                setRedraw(false);
            }
        } catch (e) { setRedraw(false); }
    }

    // Shows the kept state in the document instead of the last attempt
    function refreshDocument(tg) {
        try {
            setRedraw(true);
            var c = tg.ctx.chars[0];
            c.tracking = c.tracking;
        } catch (e) {}
        setRedraw(false);
    }

    function totalFor(list, P) {
        var t = 0, worst = null;
        for (var i = 0; i < list.length; i++) {
            var tg = list[i];
            tg.before = scoreLayout(tg.L0, P) + changeCost(tg.ctx, P);
            t += tg.before;
            if (!worst || tg.before > worst.score) worst = { score: tg.before, seg: tg.seg0, guides: tg.L0.guides };
        }
        return { total: t, worst: worst };
    }

    function measureAll(list, P, rep) {
        var ov = list.length > 20 ? makeOverlay() : null;
        var usable = [], rag = 0, just = 0;
        for (var t = 0; t < list.length; t++) {
            var tg = list[t];
            if (ov) ov.set({ head: "Measuring " + (t + 1) + " of " + list.length, sub: "Scoring the current text", progress: t / list.length });
            try {
                var ctx = makeContext(tg);
                if (ctx.skip) { countSkip(rep, ctx.skip); continue; }
                var L = readLayout(ctx);
                if (!L.ok) { countSkip(rep, L.why); continue; }
                if (L.lines.length < 2) { countSkip(rep, "quiet"); continue; }
                tg.ctx = ctx;
                tg.L0 = L;
                tg.len0 = lens(L);
                tg.seg0 = segs(L);
                if (ctx.mode === "just") just++; else rag++;
                usable.push(tg);
            } catch (e) {
                countSkip(rep, "cannot be read");
            }
        }
        if (ov) ov.close();
        var r = totalFor(usable, P);
        var mix = rag && just ? rag + " ragged, " + just + " justified" : (just ? "Justified text" : "Ragged text");
        return { list: usable, total: r.total, worst: r.worst, mix: mix };
    }

    function runAll(list, P, stageList, searchTime, rep, ov) {
        var n = list.length, pending = 0, doneSum = 0, i;
        for (i = 0; i < n; i++) pending += list[i].before;
        var startTotal = pending;
        rep.totalBefore = startTotal;
        var stop = false, lastDoc = 0;

        for (i = 0; i < n && !stop; i++) {
            var tg = list[i];
            var isRag = tg.ctx.mode !== "just";
            pending -= tg.before;
            var base = doneSum + pending;
            showInWindow(tg);
            ov.set({
                head: "Paragraph " + (i + 1) + " of " + n + (isRag ? ", ragged" : ", justified"),
                score: base + tg.before, sub: subText(startTotal, base + tg.before),
                status: "Paragraph " + (i + 1) + ": start " + fmt(tg.before),
                tries: rep.tries, ghost: tg.len0, cur: tg.seg0, best: isRag ? tg.len0 : [],
                guides: (isRag && tg.L0.guides) || [], progress: i / n
            }, true);

            var r;
            try {
                r = optimize(tg.ctx, P, stageList, API, {
                    onTry: function (tries, tryL, tryScore, bestScore, bestL) {
                        if (!ov.due()) return;
                        ov.set({
                            score: tryScore === null ? undefined : base + tryScore,
                            sub: subText(startTotal, base + bestScore),
                            status: tryScore === null
                                ? "Attempt " + fmtInt(rep.tries + tries) + " rejected, the line count would change"
                                : "Attempt " + fmtInt(rep.tries + tries) + ":  paragraph " + fmt(tryScore) + ",  best " + fmt(bestScore),
                            tries: rep.tries + tries,
                            cur: tryL ? segs(tryL) : null,
                            best: isRag ? lens(bestL) : null,
                            guides: (isRag && bestL && bestL.guides) || [],
                            progress: (i + 0.5) / n
                        }, true);
                    },
                    shouldStop: function () {
                        if (ov.escape()) stop = true;
                        return stop;
                    },
                    liveDoc: function () {
                        if (now() - lastDoc < 200) return false;
                        lastDoc = now();
                        return true;
                    },
                    redraw: setRedraw
                }, searchTime);
            } catch (e) {
                countSkip(rep, "error: " + e.message);
                doneSum += tg.before;
                continue;
            }
            if (r.skip) { countSkip(rep, r.skip); doneSum += tg.before; continue; }
            refreshDocument(tg);

            rep.done++;
            rep.tries += r.tries;
            doneSum += r.after;
            if (r.timeout) rep.timeouts++;
            if (r.converged) rep.converged++;
            if (r.after < r.before - 0.01) {
                rep.changed++;
                try { tg.story.insertLabel(LABEL_KEY, "1"); } catch (e2) {}
                var gain = r.before - r.after;
                if (!rep.bestImp || gain > rep.bestImp.gain) {
                    rep.bestImp = { gain: gain, idx: i + 1, before: r.before, after: r.after, ghost: tg.len0, cur: segs(r.L) };
                }
            }
            ov.set({ score: doneSum + pending, sub: subText(startTotal, doneSum + pending), tries: rep.tries, cur: segs(r.L) }, true);
        }
        rep.stopped = stop;
        rep.totalAfter = doneSum + pending;
        ov.set({ head: stop ? "Stopped" : "Done", score: rep.totalAfter, sub: subText(startTotal, rep.totalAfter), progress: 1 }, true);
    }

    function flow() {
        if (!app.documents.length) { alert("Please open a document first.", SCRIPT_NAME); return; }
        var rep = { done: 0, changed: 0, tries: 0, timeouts: 0, converged: 0, quiet: 0, skips: {}, bestImp: null, stopped: false };
        var S = loadSettings();
        var P = buildParams(S);

        var found = collectTargets(rep);
        if (!found.list.length) { alert("No paragraphs found.", SCRIPT_NAME); return; }

        var m = measureAll(found.list, P, rep);
        if (!m.list.length) {
            alert("No paragraph can be optimized.\n" + (skipText(rep) || "Only single line or empty paragraphs."), SCRIPT_NAME);
            return;
        }

        var R = startDialog({
            total: m.total, count: m.list.length, where: found.where, mix: m.mix,
            worst: m.worst, skip: skipText(rep),
            rescore: function (o) { return totalFor(m.list, buildParams(o)); }
        }, S);
        if (!R) return;
        saveSettings(R);
        P = buildParams(R);
        totalFor(m.list, P);
        var stages = makeStages(R);

        var prefs = app.scriptPreferences, oldRedraw = prefs.enableRedraw;
        var t0 = now();
        var ov = makeOverlay();
        try {
            prefs.enableRedraw = false;
            app.doScript(function () { runAll(m.list, P, stages, R.untilBest ? -1 : R.search, rep, ov); },
                ScriptLanguage.JAVASCRIPT, undefined, UndoModes.ENTIRE_SCRIPT, SCRIPT_NAME);
        } finally {
            prefs.enableRedraw = oldRedraw;
            ov.close();
        }

        if (resultDialog(rep, (now() - t0) / 1000) === "undo") {
            try { app.activeDocument.undo(); }
            catch (e) { alert("Undo was not possible: " + e.message, SCRIPT_NAME); }
        }
    }

    function main() {
        var prefs = app.scriptPreferences, oldUnit = prefs.measurementUnit;
        try {
            prefs.measurementUnit = MeasurementUnits.POINTS;
            flow();
        } catch (e) {
            alert("Error: " + e.message + (e.line ? " (line " + e.line + ")" : ""), SCRIPT_NAME);
        } finally {
            prefs.measurementUnit = oldUnit;
        }
    }

    // In Node.js only the core is exported for tests, in InDesign the script runs
    if (typeof app === "undefined" && typeof module !== "undefined") {
        module.exports = {
            buildParams: buildParams, scoreLayout: scoreLayout, initContext: initContext,
            readLayout: readLayout, optimize: optimize, API: API, changeCost: changeCost,
            lens: lens, segs: segs, makeStages: makeStages
        };
    } else {
        main();
    }

}());
