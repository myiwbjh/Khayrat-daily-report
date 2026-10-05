import { parseReportDate, withProvenance } from "./report-model.js";

export const IDENTITY = [1, 0, 0, 1, 0, 0];
export function multiply(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export function bounds(matrix, box = [0, 0, 1, 1]) {
  const [l, t, r, b] = box,
    points = [
      [l, t],
      [r, t],
      [l, b],
      [r, b],
    ].map(([x, y]) => [
      matrix[0] * x + matrix[2] * y + matrix[4],
      matrix[1] * x + matrix[3] * y + matrix[5],
    ]);
  return {
    x: Math.min(...points.map((p) => p[0])),
    y: Math.min(...points.map((p) => p[1])),
    width:
      Math.max(...points.map((p) => p[0])) -
      Math.min(...points.map((p) => p[0])),
    height:
      Math.max(...points.map((p) => p[1])) -
      Math.min(...points.map((p) => p[1])),
  };
}
export function union(boxes) {
  return bounds(IDENTITY, [
    Math.min(...boxes.map((b) => b.x)),
    Math.min(...boxes.map((b) => b.y)),
    Math.max(...boxes.map((b) => b.x + b.width)),
    Math.max(...boxes.map((b) => b.y + b.height)),
  ]);
}

const rounded = value => Math.round(value * 40) / 40;
// Logos and page furniture are identified from layout, never from filename or OCR.
// A single small item in the header/footer is decorative; larger margin images
// are excluded only when the same object/placement repeats across pages.
export function markDecorativeImages(pages) {
  const occurrences = new Map();
  const signature = (image, page) => {
    const b=image.bbox||{}, w=Math.max(1,page.width), h=Math.max(1,page.height);
    const geometry=[b.x/w,b.y/h,b.width/w,b.height/h].map(rounded).join('|');
    return `geometry:${geometry}`;
  };
  for(const page of pages)for(const image of page.imagePlacements||[]){
    const key=signature(image,page), seen=occurrences.get(key)||new Set();seen.add(page.pageNumber);occurrences.set(key,seen);
  }
  let count=0;
  for(const page of pages)for(const image of page.imagePlacements||[]){
    const b=image.bbox||{}, pageArea=Math.max(1,page.width*page.height), area=Math.max(0,b.width*b.height), centerY=b.y+b.height/2;
    const top=centerY<=page.height*.14, bottom=centerY>=page.height*.9;
    const smallMargin=(top||bottom)&&b.width<=page.width*.35&&b.height<=page.height*.1&&area<=pageArea*.04;
    const repeatedMargin=(top||bottom)&&occurrences.get(signature(image,page))?.size>=2&&area<=pageArea*.09;
    image.decorative=Boolean(smallMargin||repeatedMargin);
    image.decorativeReason=smallMargin?'small-margin-image':repeatedMargin?'repeated-margin-image':'';
    if(image.decorative)count++;
  }
  return count;
}
export function textLayout(items, viewport) {
  const tokens = items
    .filter((i) => i.str?.trim())
    .map((i, index) => {
      const m = multiply(
          viewport.transform || [1, 0, 0, -1, 0, viewport.height],
          i.transform || IDENTITY,
        ),
        h = i.height || Math.hypot(m[2], m[3]) || 10;
      return {
        id: index,
        text: i.str,
        bbox: {
          x: m[4],
          y: m[5] - h,
          width: i.width || (i.str.length * h) / 2,
          height: h,
        },
        baseline: m[5],
      };
    });
  const rows = [];
  for (const token of tokens.sort(
    (a, b) => a.baseline - b.baseline || a.bbox.x - b.bbox.x,
  )) {
    let row = rows.find((r) => Math.abs(r.baseline - token.baseline) < 2);
    if (!row) {
      row = { baseline: token.baseline, tokens: [] };
      rows.push(row);
    }
    row.tokens.push(token);
  }
  // Keep distant columns separate; a single baseline is not necessarily one paragraph.
  const lines = [];
  for (const row of rows) {
    const sorted = row.tokens.sort((a, b) => a.bbox.x - b.bbox.x);
    let group = [];
    const flush = () => {
      if (group.length)
        lines.push({
          tokens: group,
          bbox: union(group.map((t) => t.bbox)),
          text: group
            .map((t) => t.text)
            .join(" ")
            .trim(),
          y: row.baseline,
        });
      group = [];
    };
    for (const t of sorted) {
      const prev = group.at(-1);
      if (prev && t.bbox.x - prev.bbox.x - prev.bbox.width > 85) flush();
      group.push(t);
    }
    flush();
  }
  return {
    tokens,
    rows: rows.map((r) => ({
      ...r,
      bbox: union(r.tokens.map((t) => t.bbox)),
      text: r.tokens
        .map((t) => t.text)
        .join(" ")
        .trim(),
      y: r.baseline,
    })),
    lines: lines.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x),
  };
}

export function documentDate(pages) {
  const candidates = [];
  for (const p of pages) {
    for (const l of p.layout.lines) {
      if (l.bbox.y > p.height * 0.25) continue;
      const compact = l.text.replace(/\s/g, "");
      for (const m of compact.matchAll(
        /(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})日?/g,
      )) {
        const date = parseReportDate(`${m[1]}-${m[2]}-${m[3]}`);
        if (date)
          candidates.push({
            date,
            pageNumber: p.pageNumber,
            bbox: l.bbox,
            excerpt: l.text,
          });
      }
    }
  }
  const dates = [...new Set(candidates.map((c) => c.date))];
  return {
    date: dates.length === 1 ? dates[0] : "",
    candidates,
    uncertain: dates.length !== 1,
  };
}

const integer = (s) => (/^\d+$/.test(String(s).trim()) ? Number(s) : null);
export function tableFromHeader(page, header) {
  const columns = header.tokens
    .filter((t) => t.text.trim())
    .map((t) => ({
      label: t.text.trim(),
      x: t.bbox.x + t.bbox.width / 2,
      bbox: t.bbox,
    }));
  const rows = [];
  for (const line of page.layout.rows.filter(
    (l) =>
      l.bbox.y > header.bbox.y + header.bbox.height &&
      l.bbox.y < header.bbox.y + 220,
  )) {
    if (/^[一二三四五六七八九十]+[、．.]/.test(line.text.trim())) break;
    const cells = columns.map(() => []);
    for (const t of line.tokens) {
      let index = columns.reduce(
        (best, c, i) =>
          Math.abs(t.bbox.x + t.bbox.width / 2 - c.x) <
          Math.abs(t.bbox.x + t.bbox.width / 2 - columns[best].x)
            ? i
            : best,
        0,
      );
      cells[index].push(t.text);
    }
    const values = cells.map((c) => c.join(" ").trim());
    if (
      values.some((v) => /^\d+(?:\.\d+)?$/.test(v)) ||
      /合计|总计/.test(line.text)
    )
      rows.push({ cells: values, bbox: line.bbox, excerpt: line.text });
    else if (rows.length) break;
  }
  return {
    columns,
    rows,
    bbox: union([header.bbox, ...rows.map((r) => r.bbox)]),
    pageNumber: page.pageNumber,
    method: "aligned-text-columns",
    reviewRequired: !rows.length,
  };
}
export function personnelTables(page, date, sourceFile, fingerprint) {
  const tables = [],
    records = [];
  for (const header of page.layout.rows) {
    if (
      !/中国人|中方|Chinese/i.test(header.text) ||
      !/当地人|属地|Local/i.test(header.text) ||
      !/单位|车间|工种|Unit|Trade/i.test(header.text)
    )
      continue;
    const table = tableFromHeader(page, header);
    tables.push(table);
    const ci = table.columns.findIndex((c) =>
        /中国人|中方|Chinese/i.test(c.label),
      ),
      li = table.columns.findIndex((c) => /当地人|属地|Local/i.test(c.label));
    const preceding =
      page.layout.rows.filter((l) => l.bbox.y < header.bbox.y).at(-1)?.text ||
      "";
    const timeBasis =
      /累计/.test(header.text) && /当日|今日/.test(header.text)
        ? "mixed"
        : /累计/.test(header.text + preceding)
          ? "cumulative"
          : "current";
    const scope = /车间/.test(header.text + preceding) ? "workshop" : "project";
    const breakdown = table.rows
      .filter((r) => !/合计|总计/.test(r.excerpt))
      .map((r) => ({
        unit:
          r.cells[
            table.columns.findIndex((c) =>
              /单位|车间|工种|Unit|Trade/i.test(c.label),
            )
          ] || "",
        chinese: integer(r.cells[ci]),
        local: integer(r.cells[li]),
        role: /管理人员/.test(r.excerpt)
          ? "management"
          : /劳务人员/.test(r.excerpt)
            ? "labour"
            : "not-reported",
        bbox: r.bbox,
        excerpt: r.excerpt,
      }));
    const totals = table.rows.filter((r) => /合计|总计/.test(r.excerpt));
    const total = totals[0];
    if (!total) continue;
    const chinese = integer(total.cells[ci]),
      local = integer(total.cells[li]),
      totalIndex = table.columns.findIndex((c) =>
        /总人数|合计人数|总计人数|Total/i.test(c.label),
      ),
      reportedTotal = totalIndex >= 0 ? integer(total.cells[totalIndex]) : null,
      issues = [];
    if (
      reportedTotal != null &&
      chinese != null &&
      local != null &&
      reportedTotal !== chinese + local
    )
      issues.push("报告总人数与中方、属地之和不一致");
    if (timeBasis === "mixed")
      issues.push("当日与累计列混合，需人工确认对应列");
    if (totals.length !== 1) issues.push("存在多个人员合计行");
    for (const [key, value] of [
      ["chinese", chinese],
      ["local", local],
    ])
      if (
        value == null ||
        !breakdown.length ||
        breakdown.some((r) => r[key] == null) ||
        breakdown.reduce((n, r) => n + r[key], 0) !== value
      )
        issues.push(`${key}合计与分项不一致或缺失`);
    const stats = {
      scope,
      timeBasis,
      reportedChinese: chinese,
      reportedLocal: local,
      reportedTotal,
      derivedTotal: chinese != null && local != null ? chinese + local : null,
      totalMethod:
        reportedTotal == null ? "sum-reported-nationalities" : "reported-total",
      categoryTotals: {
        management: breakdown.filter((r) => r.role === "management"),
        labour: breakdown.filter((r) => r.role === "labour"),
      },
      breakdown,
      issues,
      sourceFile,
      pageNumber: page.pageNumber,
      bbox: table.bbox,
      excerpt: table.rows.map((r) => r.excerpt).join("\n"),
    };
    records.push(
      withProvenance({
        date: date.date,
        workshop: scope === "project" ? "全项目" : "未确定车间",
        process: "人员统计",
        recordType: "personnel-summary",
        sourceType: "pdf",
        extractionMethod: "pdf-layout-personnel",
        dateSource: date.candidates,
        activityId: `personnel-${fingerprint.slice(0, 16)}-${page.pageNumber}`,
        staffScope:
          scope === "project" && timeBasis === "current"
            ? "项目总人数"
            : timeBasis === "cumulative"
              ? "累计人数"
              : "车间施工人数",
        chineseStaff: chinese,
        localStaff: local,
        totalStaff: reportedTotal ?? stats.derivedTotal,
        personnelStatistics: stats,
        sourceFile,
        pageNumber: page.pageNumber,
        sourceExcerpt: stats.excerpt,
        rawRecord: stats.excerpt,
        sourceLocation: {
          pageNumber: page.pageNumber,
          bbox: table.bbox,
          table,
        },
        reviewFields: [
          ...(date.uncertain ? ["date"] : []),
          ...(issues.length
            ? [
                "chineseStaff",
                "localStaff",
                "totalStaff",
                "personnelStatistics",
              ]
            : []),
          ...(scope !== "project" ? ["workshop"] : []),
        ],
      }),
    );
  }
  // Explicit standalone summary fields; keep missing categories null, never inferred from company names.
  if (!records.length) {
    const matched = page.layout.rows.filter((l) =>
      /项目总人数|中方人数|中国人数|属地人数|当地人数|管理人员|劳务人员/.test(
        l.text,
      ),
    );
    for (const timeBasis of ["current", "cumulative", "mixed"]) {
      const selected = matched.filter((l) => {
          const prior =
              page.layout.rows
                .filter((r) => r.bbox.y < l.bbox.y && r.bbox.y > l.bbox.y - 35)
                .at(-1)?.text || "",
            basis =
              /累计/.test(l.text) && /当日|今日/.test(l.text)
                ? "mixed"
                : /累计/.test(l.text) || /累计人员统计/.test(prior)
                  ? "cumulative"
                  : "current";
          return basis === timeBasis;
        }),
        text = selected.map((l) => l.text).join("\n");
      const get = (re) => {
          const values = [...text.matchAll(new RegExp(re.source, "g"))].map(
            (m) => Number(m[1]),
          );
          return values.length === 1 ? values[0] : null;
        },
        reportedTotal = get(/项目总人数\s*[:：]?\s*(\d+)/),
        chinese = get(/(?:中方|中国)人数\s*[:：]?\s*(\d+)/),
        local = get(/(?:属地|当地)人数\s*[:：]?\s*(\d+)/);
      if (reportedTotal != null || chinese != null || local != null) {
        const issues = [];
        if (timeBasis === "mixed")
          issues.push("同一行混合当日与累计人数，需核对");
        if (
          reportedTotal != null &&
          chinese != null &&
          local != null &&
          reportedTotal !== chinese + local
        )
          issues.push("报告总人数与中方、属地之和不一致");
        const stats = {
          scope: "project",
          timeBasis,
          reportedTotal,
          reportedChinese: chinese,
          reportedLocal: local,
          derivedTotal:
            chinese != null && local != null ? chinese + local : null,
          totalMethod:
            reportedTotal == null
              ? "sum-reported-nationalities"
              : "reported-total",
          management: get(/管理人员\s*[:：]?\s*(\d+)/),
          labour: get(/劳务人员\s*[:：]?\s*(\d+)/),
          issues,
          excerpt: text,
          bbox: union(selected.map((l) => l.bbox)),
          sourceFile,
          pageNumber: page.pageNumber,
        };
        records.push(
          withProvenance({
            date: date.date,
            workshop: "全项目",
            process: "人员统计",
            recordType: "personnel-summary",
            sourceType: "pdf",
            extractionMethod: "pdf-layout-personnel",
            dateSource: date.candidates,
            activityId: `personnel-${fingerprint.slice(0, 16)}-${page.pageNumber}-${timeBasis}`,
            staffScope:
              timeBasis === "current"
                ? "项目总人数"
                : timeBasis === "cumulative"
                  ? "累计人数"
                  : "未确认人数口径",
            chineseStaff: chinese,
            localStaff: local,
            totalStaff: reportedTotal ?? stats.derivedTotal,
            personnelStatistics: stats,
            sourceFile,
            pageNumber: page.pageNumber,
            sourceExcerpt: text,
            sourceLocation: { pageNumber: page.pageNumber, bbox: stats.bbox },
            reviewFields: [
              ...(date.uncertain ? ["date"] : []),
              ...(issues.length
                ? [
                    "chineseStaff",
                    "localStaff",
                    "totalStaff",
                    "personnelStatistics",
                  ]
                : []),
            ],
          }),
        );
      }
    }
  }
  return { tables, records };
}
export function otherTables(page) {
  return page.layout.rows
    .filter(
      (row) =>
        /单位|工序|工程量/.test(row.text) &&
        /当日|累计|数量|完成量/.test(row.text),
    )
    .map((row) => ({
      ...tableFromHeader(page, row),
      reviewRequired: true,
      semanticStatus: "requires-column-review",
    }));
}

const processRules = [
  ["钢筋绑扎", /钢筋.*?绑扎|绑扎.*?钢筋/],
  ["模板安装", /模板.*?(安装|制作)|支模/],
  ["模板拆除", /模板.*?拆除/],
  ["混凝土浇筑", /混凝土.*?浇筑/],
  ["混凝土养护", /混凝土.*?养护/],
  ["脚手架搭设", /脚手架.*?搭设/],
  ["墙体砌筑", /砌筑/],
  ["土石方破碎", /土石方.*?破碎/],
  ["回填", /回填/],
  ["开挖", /开挖/],
  ["测量放线", /放线/],
];
export function extractQuantities(text) {
  const result = [];
  for (const m of text.matchAll(
    /(当日|今日|累计)(?:完成(?:工程)?量|完成工程量|混凝土|浇筑|完成)?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(m³|m3|立方米|m²|m2|平方米|吨|t|米|m|台|件|根)(?![A-Za-z])/gi,
  ))
    result.push({
      basis: m[1] === "累计" ? "cumulative" : "daily",
      value: Number(m[2]),
      unit: m[3],
      excerpt: m[0],
    });
  return result;
}
export function constructionBlocks(page, date, sourceFile) {
  const lines = page.layout.lines,
    headings = [];
  const started = lines.find((l) => /今日工作开展|施工情况/.test(l.text));
  for (const l of lines) {
    if (started && l.bbox.y < started.bbox.y) continue;
    const m =
      /^\s*(\d{1,2})\s*[.．、:：]?\s*([^:：]{2,32})\s*[:：]\s*(.+)$/.exec(
        l.text,
      );
    if (m && !/事项|人员|天气|气温/.test(m[2]))
      headings.push({
        line: l,
        number: m[1],
        workshop: m[2].trim(),
        description: m[3].trim(),
      });
  }
  const blocks = [];
  for (const h of headings) {
    const peers = headings.filter(
      (o) => o !== h && Math.abs(o.line.bbox.y - h.line.bbox.y) < 8,
    );
    const left =
        peers.length && h.line.bbox.x >= page.width / 2 ? page.width / 2 : 0,
      right =
        peers.length && h.line.bbox.x < page.width / 2
          ? page.width / 2
          : page.width;
    const next = headings
      .filter(
        (o) =>
          o.line.bbox.y > h.line.bbox.y + 8 &&
          o.line.bbox.x >= left &&
          o.line.bbox.x < right,
      )
      .sort((a, b) => a.line.bbox.y - b.line.bbox.y)[0];
    const continuation = lines.filter(
      (l) =>
        l.bbox.y > h.line.bbox.y + 4 &&
        l.bbox.y < h.line.bbox.y + 42 &&
        l.bbox.x >= left &&
        l.bbox.x < right &&
        !headings.some((o) => o.line === l) &&
        !/^第.*页/.test(l.text),
    );
    const description = [
        h.description,
        ...continuation.map((l) => l.text),
      ].join(" "),
      excerpt = [h.line.text, ...continuation.map((l) => l.text)].join("\n");
    const activities = description.split(/[；;]/).map((text) => ({
      text: text.trim(),
      processes: processRules
        .filter(([, re]) => re.test(text))
        .map(([name]) => name),
      quantities: extractQuantities(text),
    }));
    const processes = [...new Set(activities.flatMap((a) => a.processes))];
    const process =
      processes.length === 1
        ? processes[0]
        : processes.length
          ? "多工序（待复核）"
          : /暂无.*人.*施工/.test(description)
            ? "未报告工序"
            : "土建施工（待复核）";
    const quantities = extractQuantities(description),
      units = [...new Set(quantities.map((q) => q.unit))],
      pick = (basis) => {
        const values = quantities.filter((q) => q.basis === basis);
        return values.length === 1 ? values[0].value : null;
      };
    const status = /暂无.*人.*施工/.test(description)
      ? "当日暂无人员施工"
      : /停工/.test(description)
        ? "明确报告停工"
        : /施工进行中|施工中|浇筑|绑扎|施工。?$/.test(description)
          ? "施工中"
          : "";
    const record = withProvenance({
      date: date.date,
      workshop: h.workshop,
      process,
      activityId: `section-${h.number}`,
      constructionContent: description,
      activities,
      status,
      quantities,
      dailyConcrete: pick("daily"),
      cumulativeConcrete: pick("cumulative"),
      workUnit: units.length === 1 ? units[0] : "",
      chineseStaff: null,
      localStaff: null,
      sourceType: "pdf",
      sourceFile,
      pageNumber: page.pageNumber,
      sourceExcerpt: excerpt,
      rawRecord: excerpt,
      extractionMethod: "pdf-layout",
      dateSource: date.candidates,
      sourceLocation: {
        pageNumber: page.pageNumber,
        bbox: union([h.line.bbox, ...continuation.map((l) => l.bbox)]),
      },
      reviewFields: [
        ...(date.uncertain ? ["date"] : []),
        ...(processes.length !== 1 ? ["process"] : []),
        ...(units.length > 1
          ? ["workUnit", "dailyConcrete", "cumulativeConcrete"]
          : []),
      ],
    });
    blocks.push({
      record,
      bbox: record.sourceLocation.bbox,
      region: {
        x: left,
        y: h.line.bbox.y,
        width: right - left,
        height: (next?.line.bbox.y || page.height - 35) - h.line.bbox.y,
      },
      captions: lines.filter((l) => /^\s*(图|照片)\s*\d+/.test(l.text)),
      id: `p${page.pageNumber}-section-${h.number}`,
    });
  }
  return blocks;
}
export function associateFigure(image, blocks) {
  if (!image.bbox)
    return {
      status: "unassociated",
      reason: "缺少图片布局坐标",
      candidates: [],
    };
  const b = image.bbox,
    cx = b.x + b.width / 2,
    cy = b.y + b.height / 2;
  const candidates = blocks.filter((block) => {
    const r = block.region;
    return (
      cx >= r.x &&
      cx <= r.x + r.width &&
      b.y >= block.bbox.y + block.bbox.height - 3 &&
      cy < r.y + r.height &&
      b.y + b.height <= r.y + r.height + 3
    );
  });
  if (candidates.length !== 1)
    return {
      status: "unassociated",
      reason: candidates.length
        ? "存在多个候选施工描述"
        : "未找到同区域施工描述",
      candidates: candidates.map((b) => b.id),
    };
  const block = candidates[0],
    captions = (block.captions || []).filter(
      (l) =>
        l.bbox.x < b.x + b.width &&
        l.bbox.x + l.bbox.width > b.x &&
        Math.min(
          Math.abs(l.bbox.y + l.bbox.height - b.y),
          Math.abs(l.bbox.y - b.y - b.height),
        ) < 25 &&
        l.bbox.y >= block.region.y &&
        l.bbox.y < block.region.y + block.region.height,
    );
  const caption = captions.length === 1 ? captions[0] : null,
    captionProcesses = caption
      ? processRules
          .filter(([, re]) => re.test(caption.text))
          .map(([name]) => name)
      : [];
  return {
    status:
      captionProcesses.length === 1
        ? "linked-activity"
        : block.record.reviewFields.includes("process")
          ? "linked-workshop"
          : "linked-record",
    method: caption
      ? "explicit-caption-and-section"
      : "same-column-section-region",
    blockId: block.id,
    record: block.record,
    excerpt: caption
      ? `${caption.text}\n所属段落：${block.record.sourceExcerpt}`
      : block.record.sourceExcerpt,
    caption: caption?.text,
    figureNumber: caption ? /\d+/.exec(caption.text)?.[0] : null,
    process: captionProcesses.length === 1 ? captionProcesses[0] : "",
    textBBox: caption?.bbox || block.bbox,
    imageBBox: b,
    candidates: [block.id],
    needsReview: true,
  };
}
// Some exporters split one photo into contiguous strips. Keep component evidence.
export function figureGroups(images) {
  const groups = [];
  for (const image of [...images].sort(
    (a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x,
  )) {
    const last = groups.find(
      (g) =>
        Math.abs(g.bbox.x - image.bbox.x) < 1 &&
        Math.abs(g.bbox.width - image.bbox.width) < 1 &&
        Math.abs(g.bbox.y + g.bbox.height - image.bbox.y) < 1,
    );
    if (last) {
      last.parts.push(image);
      last.bbox = union(last.parts.map((p) => p.bbox));
    } else groups.push({ bbox: image.bbox, parts: [image] });
  }
  return groups;
}

export function quantityTableRecords(tables, page, date, sourceFile) {
  const records = [];
  for (const [ti, table] of tables.entries()) {
    const find = (re) => table.columns.findIndex((c) => re.test(c.label)),
      wi = find(/车间|区域/),
      pi = find(/工序|施工内容/),
      ui = find(/单位/),
      di = find(/当日|今日/),
      ci = find(/累计/);
    if (ui < 0 || (di < 0 && ci < 0)) continue;
    for (const [ri, row] of table.rows.entries()) {
      const read = (i) =>
          i < 0 || !/^\d+(?:\.\d+)?$/.test(row.cells[i])
            ? null
            : Number(row.cells[i]),
        daily = read(di),
        cumulative = read(ci),
        unit = row.cells[ui];
      if (
        (daily == null && cumulative == null) ||
        !/^(m³|m3|立方米|m²|m2|平方米|吨|t|米|m|台|件|根)$/i.test(unit)
      )
        continue;
      records.push(
        withProvenance({
          date: date.date,
          workshop: wi >= 0 ? row.cells[wi] : "",
          process: pi >= 0 ? row.cells[pi] : "",
          recordType: "quantity-statement",
          activityId: `quantity-table-${page.pageNumber}-${ti}-${ri}`,
          dailyConcrete: daily,
          cumulativeConcrete: cumulative,
          workUnit: unit,
          sourceFile,
          pageNumber: page.pageNumber,
          sourceExcerpt: row.excerpt,
          rawRecord: row.excerpt,
          sourceLocation: {
            pageNumber: page.pageNumber,
            bbox: row.bbox,
            tableColumns: table.columns,
          },
          extractionMethod: "aligned-table-columns",
          reviewFields: [
            ...(date.uncertain ? ["date"] : []),
            ...(wi < 0 ? ["workshop"] : []),
            ...(pi < 0 ? ["process"] : []),
            ...(daily != null && cumulative != null && daily > cumulative
              ? ["dailyConcrete", "cumulativeConcrete"]
              : []),
          ],
        }),
      );
    }
  }
  return records;
}
