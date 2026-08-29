// Ported from reference-ui/index.html's parseCycle(): a pattern's `cycle`
// field is entered as one unbroken string (e.g. "MMAANNOO" or a cycle mixing
// multi-character codes like "DEPFSDEP"), so tokenizing it needs the set of
// real shift-definition codes to know where one code ends and the next
// begins — tried longest-first so a 3-char code like "DEP" isn't
// mis-tokenized as "D","E","P".
function parseCycle(cycle, knownCodes) {
  const codes = [];
  const str = (cycle || "").toUpperCase().replace(/\s/g, "");
  const multiCodes = (knownCodes || [])
    .filter(c => c.length > 1)
    .sort((a, b) => b.length - a.length);

  let i = 0;
  while (i < str.length) {
    let matched = false;
    for (const mc of multiCodes) {
      if (str.startsWith(mc, i)) { codes.push(mc); i += mc.length; matched = true; break; }
    }
    if (!matched) { codes.push(str[i]); i++; }
  }
  return codes.length ? codes : ["O"];
}

module.exports = { parseCycle };
