import { describe, expect, it } from "vitest";
import { MAX_DEPTH, parseTime, renderBBCode, safeColor, safeHttpUrl, safeSize } from "./bbcode";

const r = (s: string, opts = {}) =>
  renderBBCode(s, { formatTime: (d) => d.toISOString(), ...opts });

/**
 * Whatever the input, the output may only contain the tags and attributes the
 * renderer writes itself. This is the safety net under the targeted XSS cases.
 */
const ALLOWED_TAGS = new Set([
  "b",
  "i",
  "u",
  "s",
  "span",
  "div",
  "blockquote",
  "cite",
  "hr",
  "ul",
  "ol",
  "li",
  "table",
  "tbody",
  "tr",
  "td",
  "th",
  "a",
  "img",
  "button",
  "pre",
  "code",
  "time",
  "br",
]);
const ALLOWED_ATTRS = new Set([
  "class",
  "style",
  "href",
  "target",
  "rel",
  "type",
  "data-clid",
  "data-uid",
  "data-cid",
  "data-bb-img",
  "data-bb-act",
  "src",
  "alt",
  "loading",
  "referrerpolicy",
  "datetime",
  "data-ft-cid",
  "data-ft-path",
  "data-ft-size",
  "data-ft-act",
  "data-ft-away",
  "data-kind",
  "role",
  "aria-hidden",
]);

function assertSafe(html: string): void {
  for (const m of html.matchAll(/<\/?([a-zA-Z0-9]+)([^>]*)>/g)) {
    const [, tag, attrs] = m;
    expect(ALLOWED_TAGS.has(tag!.toLowerCase()), `tag <${tag}> in ${html}`).toBe(true);
    // Attributes are always name="value" with the value fully escaped.
    const rest = attrs!.replace(/\s*\/$/, "").replace(/\s+([a-z-]+)="[^"<>]*"/g, (_a, name) => {
      expect(ALLOWED_ATTRS.has(name), `attribute ${name} in ${html}`).toBe(true);
      return "";
    });
    expect(rest.trim(), `stray attribute text in ${html}`).toBe("");
  }
  for (const m of html.matchAll(/href="([^"]*)"/g)) {
    expect(m[1] === "#" || /^https?:\/\//.test(m[1]!), `href ${m[1]}`).toBe(true);
  }
  for (const m of html.matchAll(/src="([^"]*)"/g)) expect(m[1]).toMatch(/^https?:\/\//);
  for (const m of html.matchAll(/style="([^"]*)"/g)) {
    expect(m[1]).toMatch(
      /^(color:(#[0-9a-f]{3,8}|[a-z]+)|font-size:[\d.]+(pt|em)|text-align:(left|center|right))$/,
    );
  }
  // Text may say anything (it is escaped); markup may not.
  const markup = (html.match(/<[^>]*>/g) ?? []).join("");
  expect(markup).not.toMatch(/javascript:|data:|vbscript:|\son[a-z]+=/i);
  expect(html.replace(/<[^>]*>/g, "")).not.toMatch(/[<>]/);
}

describe("renderBBCode: text", () => {
  it("escapes HTML", () => {
    expect(r(`<script>alert("x")</script> & 'q'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;",
    );
  });

  it("turns newlines into breaks", () => {
    expect(r("a\nb\r\nc")).toBe("a<br />b<br />c");
  });

  it("links bare URLs, leaving trailing punctuation out", () => {
    expect(r("see https://example.com/a?b=1.")).toBe(
      'see <a class="bb-link" href="https://example.com/a?b=1" target="_blank" rel="noopener noreferrer nofollow">https://example.com/a?b=1</a>.',
    );
  });

  it("can leave bare URLs alone", () => {
    expect(r("https://example.com", { autolink: false })).toBe("https://example.com");
  });
});

describe("renderBBCode: inline tags", () => {
  it.each([
    ["[b]x[/b]", "<b>x</b>"],
    ["[I]x[/i]", "<i>x</i>"],
    ["[u]x[/u]", "<u>x</u>"],
    ["[s]x[/s]", "<s>x</s>"],
    ["[b][i]x[/i][/b]", "<b><i>x</i></b>"],
  ])("%s", (input, html) => {
    expect(r(input)).toBe(html);
  });

  it("colours text", () => {
    expect(r("[color=#ff0000]x[/color]")).toBe('<span style="color:#ff0000">x</span>');
    expect(r("[COLOR=Red]x[/COLOR]")).toBe('<span style="color:red">x</span>');
    expect(r("[color=00ff00]x[/color]")).toBe('<span style="color:#00ff00">x</span>');
  });

  it("drops an invalid colour but keeps the text", () => {
    expect(r("[color=rgb(1,2,3)]x[/color]")).toBe("x");
  });

  it("sizes text, absolute in points and relative in steps, both clamped", () => {
    expect(r("[size=12]x[/size]")).toBe('<span style="font-size:12pt">x</span>');
    expect(r("[size=999]x[/size]")).toBe('<span style="font-size:28pt">x</span>');
    expect(r("[size=1]x[/size]")).toBe('<span style="font-size:6pt">x</span>');
    expect(r("[size=+2]x[/size]")).toBe('<span style="font-size:1.5em">x</span>');
    expect(r("[size=-1]x[/size]")).toBe('<span style="font-size:0.75em">x</span>');
    expect(r("[size=+50]x[/size]")).toBe('<span style="font-size:2.5em">x</span>');
    expect(r("[size=big]x[/size]")).toBe("x");
  });
});

describe("renderBBCode: blocks", () => {
  it("aligns", () => {
    expect(r("[center]x[/center]")).toBe('<div class="bb-align" style="text-align:center">x</div>');
    expect(r("[left]x[/left][right]y[/right]")).toBe(
      '<div class="bb-align" style="text-align:left">x</div><div class="bb-align" style="text-align:right">y</div>',
    );
  });

  it("draws a rule and eats the newline after it", () => {
    expect(r("a\n[hr]\nb")).toBe('a<br /><hr class="bb-hr" />b');
  });

  it("renders bullet and numbered lists", () => {
    expect(r("[list]\n[*]a\n[*]b\n[/list]")).toBe('<ul class="bb-list"><li>a</li><li>b</li></ul>');
    expect(r("[list=1][*]a[*][b]b[/b][/list]")).toBe(
      '<ol class="bb-list" type="1"><li>a</li><li><b>b</b></li></ol>',
    );
    expect(r("[list=a][*]x[/list]")).toBe('<ol class="bb-list" type="a"><li>x</li></ol>');
  });

  it("falls back to bullets for an unknown list type", () => {
    expect(r('[list=x"y][*]a[/list]')).toBe('<ul class="bb-list"><li>a</li></ul>');
  });

  it("accepts closed items and nested lists", () => {
    expect(r("[list][*]a[/*][*]b[list][*]c[/list][/list]")).toBe(
      '<ul class="bb-list"><li>a</li><li>b<ul class="bb-list"><li>c</li></ul></li></ul>',
    );
  });

  it("shows [*] outside a list as text", () => {
    expect(r("[*]a")).toBe("[*]a");
  });

  it("renders tables", () => {
    expect(r("[table]\n[tr][th]h[/th][/tr]\n[tr][td]a[/td][td]b[/td][/tr]\n[/table]")).toBe(
      '<table class="bb-table"><tbody><tr><th>h</th></tr><tr><td>a</td><td>b</td></tr></tbody></table>',
    );
  });

  it("keeps cells and rows outside a table as plain content", () => {
    expect(r("[td]a[/td][tr]b[/tr]")).toBe("ab");
  });

  it("quotes, with or without an author", () => {
    expect(r("[quote]x[/quote]")).toBe('<blockquote class="bb-quote">x</blockquote>');
    expect(r('[quote="Bob"]x[/quote]')).toBe(
      '<blockquote class="bb-quote"><cite class="bb-quote-by">Bob</cite>x</blockquote>',
    );
  });

  it("nests quotes", () => {
    expect(r("[quote=a][quote=b]x[/quote]y[/quote]")).toBe(
      '<blockquote class="bb-quote"><cite class="bb-quote-by">a</cite><blockquote class="bb-quote"><cite class="bb-quote-by">b</cite>x</blockquote>y</blockquote>',
    );
  });

  it("shows code verbatim", () => {
    expect(r("[code]\n[b]x[/b] <i>\n[/code]")).toBe(
      '<pre class="bb-code"><code>[b]x[/b] &lt;i&gt;\n</code></pre>',
    );
  });

  it("shows noparse verbatim", () => {
    expect(r("[noparse][b]x[/b][/noparse]")).toBe("[b]x[/b]");
  });
});

describe("renderBBCode: time", () => {
  it("renders unix seconds and ISO dates in local time", () => {
    expect(r("[time]0[/time]")).toBe(
      '<time class="bb-time" datetime="1970-01-01T00:00:00.000Z">1970-01-01T00:00:00.000Z</time>',
    );
    expect(r("[time]2024-05-01T12:00:00Z[/time]")).toContain('datetime="2024-05-01T12:00:00.000Z"');
  });

  it("leaves an invalid time as text", () => {
    expect(r("[time]soon[/time]")).toBe("[time]soon[/time]");
  });

  it("parses by magnitude", () => {
    expect(parseTime("1700000000")?.getTime()).toBe(1_700_000_000_000);
    expect(parseTime("1700000000000")?.getTime()).toBe(1_700_000_000_000);
    expect(parseTime("tomorrow")).toBeNull();
  });
});

describe("renderBBCode: links", () => {
  it("links http(s) URLs", () => {
    expect(r("[url]https://a.example/x[/url]")).toBe(
      '<a class="bb-link" href="https://a.example/x" target="_blank" rel="noopener noreferrer nofollow">https://a.example/x</a>',
    );
    expect(r("[URL=http://a.example]go [b]now[/b][/URL]")).toBe(
      '<a class="bb-link" href="http://a.example/" target="_blank" rel="noopener noreferrer nofollow">go <b>now</b></a>',
    );
  });

  it("opens www. addresses as web pages, like TS3", () => {
    expect(r("[URL]www.teamspeak.com[/URL]")).toContain('href="http://www.teamspeak.com/"');
  });

  it("does not autolink inside a link", () => {
    expect(r("[url=https://a.example]https://b.example[/url]")).toBe(
      '<a class="bb-link" href="https://a.example/" target="_blank" rel="noopener noreferrer nofollow">https://b.example</a>',
    );
  });

  it("does not nest links", () => {
    expect(r("[url=https://a.example][url=https://b.example]x[/url][/url]")).toBe(
      '<a class="bb-link" href="https://a.example/" target="_blank" rel="noopener noreferrer nofollow">x</a>',
    );
  });

  it("links TeamSpeak clients", () => {
    expect(r("[URL=client://7/abcDEF123+/xyz=~Bob%20B]Bob[/URL]")).toBe(
      '<a class="bb-client" href="#" data-clid="7" data-uid="abcDEF123+/xyz=">Bob</a>',
    );
  });

  it("drops a client link's uid when it is not a uid", () => {
    expect(r('[url=client://7/a"b~x]Bob[/url]')).toBe(
      '<a class="bb-client" href="#" data-clid="7">Bob</a>',
    );
  });

  it("links TeamSpeak channels", () => {
    expect(r("[url=channelid://42]Lobby[/url]")).toBe(
      '<a class="bb-channel" href="#" data-cid="42">Lobby</a>',
    );
    expect(r("[url]channelid://42[/url]")).toBe(
      '<a class="bb-channel" href="#" data-cid="42">channelid://42</a>',
    );
  });

  it("drops links with other schemes but keeps the label", () => {
    expect(r("[url=ftp://x]f[/url]")).toBe("f");
    expect(r("[url=ts3server://x]f[/url]")).toBe("f");
  });
});

describe("renderBBCode: ts3file links (files shared in chat)", () => {
  const link =
    "ts3file://ts.example?port=9987&channel=5&path=/&filename=a b.png&isDir=0&size=1536&fileDateTime=1";

  it("renders a file card, never an href", () => {
    const html = r(`[URL=${link}]a b.png[/URL]`);
    expect(html).toBe(
      '<span class="bb-file" data-ft-cid="5" data-ft-path="/a b.png" data-ft-size="1536">' +
        '<span class="bb-file-icon" aria-hidden="true">🖼</span>' +
        '<span class="bb-file-name">a b.png</span>' +
        '<span class="bb-file-size">1.5 KB</span>' +
        '<button type="button" class="bb-file-btn" data-ft-act="download">Download</button>' +
        '<button type="button" class="bb-file-btn" data-ft-act="preview">Preview</button>' +
        '<span class="bb-file-status" role="status"></span>' +
        "</span>",
    );
    assertSafe(html);
  });

  it("offers nothing to click for a file on another server", () => {
    const html = r(`[URL=${link}]a b.png[/URL]`, { fileHere: () => false });
    expect(html).toBe(
      '<span class="bb-file away" data-ft-away="1" data-ft-size="1536">' +
        '<span class="bb-file-icon" aria-hidden="true">🖼</span>' +
        '<span class="bb-file-name">a b.png</span>' +
        '<span class="bb-file-size">1.5 KB</span>' +
        '<span class="bb-file-status" role="status" data-kind="error">' +
        "On another server (ts.example)</span>" +
        "</span>",
    );
    expect(html).not.toContain("data-ft-cid");
    expect(html).not.toContain("data-ft-path");
    assertSafe(html);
  });

  it("gives a video a Play button, and no Preview", () => {
    const html = r("[url]ts3file://h?channel=5&path=/&filename=clip.mp4&size=2048[/url]");
    expect(html).toContain('<span class="bb-file-icon" aria-hidden="true">🎬</span>');
    expect(html).toContain('data-ft-act="download"');
    expect(html).toContain('data-ft-act="play"');
    expect(html).not.toContain('data-ft-act="preview"');
    assertSafe(html);
  });

  it("leaves a container no browser plays as a plain download", () => {
    // A player that fails is worse than the download the file would have had.
    for (const name of ["clip.mkv", "clip.avi", "clip.mov"]) {
      const html = r(`[url]ts3file://h?channel=5&path=/&filename=${name}&size=2048[/url]`);
      expect(html).toContain('<span class="bb-file-icon" aria-hidden="true">📄</span>');
      expect(html).not.toContain('data-ft-act="play"');
      expect(html).toContain('data-ft-act="download"');
    }
  });

  it("offers nothing to click for a video on another server", () => {
    const html = r("[url]ts3file://h?channel=5&path=/&filename=clip.webm[/url]", {
      fileHere: () => false,
    });
    expect(html).not.toContain("data-ft-act");
  });

  it("shows the file's own name, not the label the sender typed", () => {
    const html = r(
      "[url=ts3file://h?channel=5&path=/d&filename=virus.exe&size=1]holiday.jpg[/url]",
    );
    expect(html).toContain('<span class="bb-file-name">virus.exe</span>');
    expect(html).not.toContain("holiday");
    expect(html).not.toContain('data-ft-act="preview"');
    expect(html).toContain('data-ft-path="/d/virus.exe"');
  });

  it("works in the raw [url]…[/url] form and without a size", () => {
    const html = r("[url]ts3file://h?channel=5&path=/&filename=x.txt[/url]");
    expect(html).toContain('data-ft-path="/x.txt"');
    expect(html).not.toContain("data-ft-size");
    expect(html).not.toContain("bb-file-size");
  });

  it("escapes odd names", () => {
    const html = r("[url=ts3file://h?channel=5&path=/&filename=%3Cimg src=x%3E%22'.txt]x[/url]");
    expect(html).toContain('data-ft-path="/&lt;img src=x&gt;&quot;&#39;.txt"');
    expect(html).toContain(">&lt;img src=x&gt;&quot;&#39;.txt</span>");
    assertSafe(html);
  });

  it("keeps an invalid or folder link as its label, unlinked", () => {
    expect(r("[url=ts3file://h?channel=5&path=/../x&filename=a]go[/url]")).toBe("go");
    expect(r("[url=ts3file://h?channel=5&path=/&filename=d&isDir=1]dir[/url]")).toBe("dir");
    expect(r("[url]ts3file://h?channel=x[/url]")).toBe("ts3file://h?channel=x");
  });

  it("is only a label inside another link", () => {
    expect(r(`[url=https://a.example][url=${link}]f[/url][/url]`)).toBe(
      '<a class="bb-link" href="https://a.example/" target="_blank" rel="noopener noreferrer nofollow">f</a>',
    );
  });

  it("does not card a bare ts3file:// in text", () => {
    expect(r(link)).toBe(link.replace(/&/g, "&amp;"));
  });

  it("uses the given labels", () => {
    const html = r(`[url=${link}]x[/url]`, {
      fileLabels: { download: "下载", preview: "<预览>" },
    });
    expect(html).toContain(">下载</button>");
    expect(html).toContain(">&lt;预览&gt;</button>");
  });
});

describe("renderBBCode: images", () => {
  it("shows a click-to-load placeholder naming the host", () => {
    const html = r("[img]https://i.example.com/a.png[/img]");
    expect(html).toBe(
      '<span class="bb-img-ph" data-bb-img="https://i.example.com/a.png">' +
        '<button type="button" class="bb-img-load" data-bb-act="load">🖼 Load image from i.example.com</button>' +
        '<button type="button" class="bb-img-always" data-bb-act="always">Always load from i.example.com</button>' +
        "</span>",
    );
  });

  it("loads right away from an allowed host, without a referrer", () => {
    const html = r("[img]https://i.example.com/a.png[/img]", {
      loadImage: (host: string) => host === "i.example.com",
    });
    expect(html).toBe(
      '<img class="bb-img" src="https://i.example.com/a.png" alt="" loading="lazy" referrerpolicy="no-referrer" />',
    );
  });

  it("uses the given labels, escaped", () => {
    const html = r("[img]https://h.example/a.png[/img]", {
      labels: { loadImage: (h: string) => `<${h}>`, alwaysLoad: () => "always" },
    });
    expect(html).toContain("🖼 &lt;h.example&gt;</button>");
  });
});

describe("renderBBCode: malformed input degrades to text", () => {
  it.each([
    ["[b]x", "[b]x"],
    ["x[/b]", "x[/b]"],
    ["[b]x[i]y[/b]", "<b>x[i]y</b>"],
    ["[url=https://a.example]x", "[url=https://a.example]x"],
    ["[img]https://a.example/x.png", "[img]https://a.example/x.png"],
    ["[list][*]a", "[list][*]a"],
    ["[foo]x[/foo]", "[foo]x[/foo]"],
    ["[b=1]x[/b=2]", "[b=1]x[/b=2]"],
    ["[[b]]x[/b]", "[<b>]x</b>"],
    ["[", "["],
  ])("%s", (input, html) => {
    expect(r(input, { autolink: false })).toBe(html);
  });

  it("limits nesting depth", () => {
    const deep = "[b]".repeat(MAX_DEPTH + 5) + "x" + "[/b]".repeat(MAX_DEPTH + 5);
    const html = r(deep);
    expect(html.match(/<b>/g)?.length).toBe(MAX_DEPTH);
    assertSafe(html);
  });

  it("copes with a large pathological input", () => {
    const html = r("[quote][b][list][*]".repeat(2000));
    expect(html.length).toBeGreaterThan(0);
    assertSafe(html);
  });
});

describe("renderBBCode: XSS attempts", () => {
  const attacks = [
    "[url=javascript:alert(1)]x[/url]",
    "[url]javascript:alert(1)[/url]",
    "[url=JaVaScRiPt:alert(1)]x[/url]",
    "[url= javascript:alert(1)]x[/url]",
    "[url=java\tscript:alert(1)]x[/url]",
    '[url=https://a.example" onmouseover="alert(1)]x[/url]',
    '[url=https://a.example/"><script>alert(1)</script>]x[/url]',
    '[color=red" onmouseover="alert(1)]x[/color]',
    "[color=red;background:url(javascript:alert(1))]x[/color]",
    "[color=expression(alert(1))]x[/color]",
    '[size=12" onmouseover="alert(1)]x[/size]',
    "[size=12;position:fixed]x[/size]",
    "[img]data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=[/img]",
    "[img]javascript:alert(1)[/img]",
    '[img]https://a.example/x.png" onerror="alert(1)[/img]',
    "[img]https://a.example/<script>[/img]",
    '[quote="<img src=x onerror=alert(1)>"]x[/quote]',
    '[quote=a" onclick="alert(1)]x[/quote]',
    '[list=1" onclick="alert(1)][*]x[/list]',
    '[url=client://1/x" onclick="alert(1)~a]x[/url]',
    '[url=channelid://1" onclick="alert(1)]x[/url]',
    "[time]<script>[/time]",
    "[code]</code><script>alert(1)</script>[/code]",
    "[quote][quote][quote]<svg onload=alert(1)>[/quote][/quote]",
    'https://a.example/"onmouseover=alert(1)',
    "[url=https://a.example][img]javascript:x[/img][/url]",
    '<a href="javascript:alert(1)">x</a>',
    "[b onclick=alert(1)]x[/b]",
  ];

  it.each(attacks)("%s", (input) => {
    assertSafe(r(input));
    assertSafe(r(input, { loadImage: () => true }));
  });

  it("keeps a data: image as inert text", () => {
    expect(r("[img]data:x[/img]")).toBe("[img]data:x[/img]");
  });
});

describe("value validators", () => {
  it("accepts only http(s) URLs", () => {
    expect(safeHttpUrl("https://a.example/x y")).toBe("https://a.example/x%20y");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("//a.example")).toBeNull();
    expect(safeHttpUrl("https://")).toBeNull();
  });

  it("accepts only plain colours", () => {
    expect(safeColor("#abc")).toBe("#abc");
    expect(safeColor("#AABBCCDD")).toBe("#aabbccdd");
    expect(safeColor('"blue"')).toBe("blue");
    expect(safeColor("red;x")).toBeNull();
    expect(safeColor(undefined)).toBeNull();
  });

  it("accepts only numeric sizes", () => {
    expect(safeSize(" 10 ")).toBe("10pt");
    expect(safeSize("1e3")).toBeNull();
    expect(safeSize("-0")).toBe("1em");
  });
});
