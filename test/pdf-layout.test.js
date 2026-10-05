import test from "node:test";
import assert from "node:assert/strict";
import {
  constructionBlocks,
  associateFigure,
  figureGroups,
  personnelTables,
  extractQuantities,
  documentDate,
  textLayout,
  markDecorativeImages,
} from "../src/pdf-layout.js";
import { analyzeRecords } from "../src/analytics.js";
const date = { date: "2026-09-30", uncertain: false, candidates: [] };
test('small or repeated margin logos are excluded while construction photos remain',()=>{
  const pages=[1,2].map(pageNumber=>({pageNumber,width:600,height:840,imagePlacements:[
    {objectId:`logo_${pageNumber}`,bbox:{x:20,y:18,width:120,height:34}},
    {objectId:`photo_${pageNumber}`,bbox:{x:45,y:145,width:510,height:330}},
  ]}));
  assert.equal(markDecorativeImages(pages),2);
  assert.equal(pages[0].imagePlacements[0].decorative,true);
  assert.equal(pages[1].imagePlacements[0].decorativeReason,'small-margin-image');
  assert.equal(pages.every(p=>p.imagePlacements[1].decorative===false),true);
  const repeated=[1,2,3].map(pageNumber=>({pageNumber,width:600,height:840,imagePlacements:[{objectId:`different_${pageNumber}`,bbox:{x:15,y:8,width:400,height:85}}]}));
  assert.equal(markDecorativeImages(repeated),3);
  assert.equal(repeated[0].imagePlacements[0].decorativeReason,'repeated-margin-image');
});
function page(lines) {
  const rows = lines.map(([y, values]) => {
    const tokens = values.map(([x, text]) => ({
      text,
      bbox: { x, y, width: text.length * 10, height: 10 },
    }));
    return {
      text: tokens.map((t) => t.text).join(" "),
      tokens,
      bbox: { x: tokens[0].bbox.x, y, width: 500, height: 10 },
      y: y + 10,
    };
  });
  return {
    pageNumber: 1,
    width: 600,
    height: 840,
    layout: { rows, lines: rows },
  };
}
const personnel = (a = 12, b = 2, c = 55, d = 28, total = 97) =>
  page([
    [50, [[30, "当日人员统计"]]],
    [
      80,
      [
        [30, "单位"],
        [200, "中国人"],
        [300, "当地人"],
        [400, "总人数"],
      ],
    ],
    [
      100,
      [
        [30, "管理人员"],
        [200, String(a)],
        [300, String(b)],
        [400, String(a + b)],
      ],
    ],
    [
      120,
      [
        [30, "劳务人员"],
        [200, String(c)],
        [300, String(d)],
        [400, String(c + d)],
      ],
    ],
    [
      140,
      [
        [30, "合计"],
        [200, "67"],
        [300, "30"],
        [400, String(total)],
      ],
    ],
  ]);
test("separate photos link to separate numbered sections, ambiguous photos remain unresolved", () => {
  const p = page([
      [60, [[30, "2 中控楼：柱模板拆除施工。"]]],
      [400, [[30, "3 水泥配料站：筒仓混凝土浇筑施工。"]]],
    ]),
    blocks = constructionBlocks(p, date, "source.pdf");
  assert.equal(blocks.length, 2);
  const a = associateFigure(
      { bbox: { x: 90, y: 85, width: 410, height: 300 } },
      blocks,
    ),
    b = associateFigure(
      { bbox: { x: 90, y: 425, width: 410, height: 300 } },
      blocks,
    );
  assert.equal(a.record.workshop, "中控楼");
  assert.equal(b.record.workshop, "水泥配料站");
  assert.ok(!a.excerpt.includes("筒仓"));
  assert.equal(
    associateFigure({ bbox: { x: 90, y: 380, width: 410, height: 80 } }, blocks)
      .status,
    "unassociated",
  );
  assert.equal(
    associateFigure({ bbox: { x: 90, y: 85, width: 410, height: 300 } }, [
      ...blocks,
      blocks[0],
    ]).status,
    "unassociated",
  );
});
test("multiple processes retain separate activities without assigning a photo one invented process", () => {
  const blocks = constructionBlocks(
    page([[60, [[30, "2 中控楼：钢筋绑扎；柱模板拆除施工。"]]]]),
    date,
    "a.pdf",
  );
  assert.equal(blocks[0].record.activities.length, 2);
  assert.equal(blocks[0].record.reviewFields.includes("process"), true);
  assert.equal(
    associateFigure({ bbox: { x: 50, y: 90, width: 450, height: 200 } }, blocks)
      .status,
    "linked-workshop",
  );
});
test("staff table retains roles, reported totals, category sums and provenance; conflicts never overwrite raw totals", () => {
  const good = personnelTables(personnel(), date, "a.pdf", "abc").records[0];
  assert.equal(good.chineseStaff, 67);
  assert.equal(good.localStaff, 30);
  assert.equal(good.totalStaff, 97);
  assert.equal(
    good.personnelStatistics.categoryTotals.management[0].chinese,
    12,
  );
  assert.equal(good.personnelStatistics.categoryTotals.labour[0].local, 28);
  assert.deepEqual(good.personnelStatistics.issues, []);
  const bad = personnelTables(
    personnel(13, 2, 55, 28, 96),
    date,
    "a.pdf",
    "abc",
  ).records[0];
  assert.equal(bad.totalStaff, 96);
  assert.equal(bad.personnelStatistics.derivedTotal, 97);
  assert.equal(bad.chineseStaff, 67);
  assert.ok(bad.reviewFields.includes("chineseStaff"));
  assert.equal(analyzeRecords([bad, good]).kpis.totalStaff, null);
});
test("cumulative staff is excluded from current project totals and workshop totals are not summed as project staff", () => {
  const p = personnel();
  p.layout.rows[0].text = "累计人员统计";
  const cumulative = personnelTables(p, date, "a.pdf", "abc").records[0];
  assert.equal(cumulative.staffScope, "累计人数");
  assert.equal(analyzeRecords([cumulative]).kpis.totalStaff, null);
  const w = personnel();
  w.layout.rows[0].text = "车间人员统计";
  assert.equal(
    personnelTables(w, date, "a.pdf", "abc").records[0].staffScope,
    "车间施工人数",
  );
});
test("only explicit daily/cumulative quantities are accepted; elevations are not completed quantities", () => {
  assert.deepEqual(extractQuantities("2.8m 标高混凝土浇筑，6.8米脚手架"), []);
  const q = extractQuantities("当日完成工程量：12m³；累计完成量：180m³");
  assert.equal(q[0].value, 12);
  assert.equal(q[1].basis, "cumulative");
  assert.equal(q[1].value, 180);
});
test("contiguous strips stitch into one figure but separate columns and gaps stay separate", () => {
  const parts = [0, 100, 200].map((y) => ({
    bbox: { x: 90, y, width: 400, height: 100 },
    operatorIndex: y,
  }));
  const g = figureGroups([
    ...parts,
    { bbox: { x: 90, y: 400, width: 400, height: 100 } },
    { bbox: { x: 510, y: 0, width: 80, height: 100 } },
  ]);
  assert.equal(g.length, 3);
  assert.equal(g.find((g) => g.parts.length === 3).bbox.height, 300);
});
test("date comes from header text rather than file name; conflicting dates are unresolved", () => {
  const p = page([[40, [[10, "2026 年 9 月 30 日"]]]]);
  assert.equal(documentDate([p]).date, "2026-09-30");
  const p2 = page([[40, [[10, "2026-09-29"]]]]);
  assert.equal(documentDate([p, p2]).date, "");
});
test("distant same-baseline columns retain separate text blocks and coordinates", () => {
  const l = textLayout(
    [
      {
        str: "1 A区：绑扎",
        width: 90,
        height: 10,
        transform: [1, 0, 0, 10, 30, 740],
      },
      {
        str: "2 B区：浇筑",
        width: 90,
        height: 10,
        transform: [1, 0, 0, 10, 330, 740],
      },
    ],
    { height: 840, transform: [1, 0, 0, -1, 0, 840] },
  );
  assert.equal(l.lines.length, 2);
  assert.equal(l.lines[1].bbox.x, 330);
});

test("standalone reported project total is retained even when nationalities are absent", () => {
  const r = personnelTables(
    page([[50, [[30, "项目总人数：96"]]]]),
    date,
    "a.pdf",
    "abc",
  ).records[0];
  assert.equal(r.totalStaff, 96);
  assert.equal(r.chineseStaff, null);
  assert.equal(r.localStaff, null);
  assert.equal(analyzeRecords([r]).kpis.totalStaff, 96);
});

test("standalone current and cumulative personnel stay distinct", () => {
  const rows = personnelTables(
    page([
      [40, [[30, "当日项目总人数：90 中方人数：61 属地人数：29"]]],
      [80, [[30, "累计项目总人数：180 中方人数：122 属地人数：58"]]],
    ]),
    date,
    "a.pdf",
    "abc",
  ).records;
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.staffScope === "项目总人数").totalStaff, 90);
  assert.equal(rows.find((r) => r.staffScope === "累计人数").totalStaff, 180);
  assert.equal(analyzeRecords(rows).kpis.totalStaff, 90);
});
test("explicit photo caption narrows activity without copying unrelated whole-page text", () => {
  const p = page([
      [40, [[30, "1 A区：钢筋绑扎；混凝土浇筑。"]]],
      [80, [[80, "图1：钢筋绑扎施工"]]],
    ]),
    blocks = constructionBlocks(p, date, "a.pdf"),
    a = associateFigure(
      { bbox: { x: 80, y: 100, width: 440, height: 150 } },
      blocks,
    );
  assert.equal(a.status, "linked-activity");
  assert.equal(a.process, "钢筋绑扎");
  assert.equal(a.figureNumber, "1");
  assert.equal(a.method, "explicit-caption-and-section");
});

test("personnel comparison matches scope across different file fingerprints rather than losing headcount delta", async () => {
  const { compareReports } = await import("../src/comparison.js");
  const before = personnelTables(
      personnel(),
      { ...date, date: "2026-09-29" },
      "b.pdf",
      "different1",
    ).records[0],
    after = personnelTables(personnel(), date, "a.pdf", "different2")
      .records[0];
  after.chineseStaff = 68;
  const comparison = compareReports([before, after]);
  assert.equal(comparison.rows.length, 1);
  assert.equal(comparison.rows[0].changes.chineseStaff, 1);
});

test('quantity tables retain explicit workshop, process, decimals, unit and original row',async()=>{const {otherTables,quantityTableRecords}=await import('../src/pdf-layout.js');const p=page([[50,[[20,'车间'],[140,'工序'],[270,'单位'],[380,'当日完成量'],[490,'累计完成量']]],[80,[[20,'A区'],[140,'混凝土浇筑'],[270,'m³'],[380,'12.5'],[490,'180.5']]]]);const r=quantityTableRecords(otherTables(p),p,date,'a.pdf')[0];assert.equal(r.workshop,'A区');assert.equal(r.dailyConcrete,12.5);assert.equal(r.cumulativeConcrete,180.5);assert.equal(r.workUnit,'m³');assert.match(r.sourceExcerpt,/180.5/);});

test('uncertain reported quantities remain in provenance but never become trusted dashboard totals',()=>{const record={date:'2026-09-30',workshop:'A',process:'浇筑',dailyConcrete:12,cumulativeConcrete:10,workUnit:'m³',reviewFields:['dailyConcrete','cumulativeConcrete']};const q=analyzeRecords([record]).quantityGroups[0];assert.equal(q.daily,null);assert.equal(q.cumulative,null);assert.equal(record.dailyConcrete,12);const absent=analyzeRecords([{...record,dailyConcrete:null,cumulativeConcrete:null,reviewFields:[]}]).quantityGroups[0];assert.equal(absent.cumulative,null);});
