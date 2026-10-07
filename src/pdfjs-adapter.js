import { mapPDFText } from "./pdf.js";
import { withProvenance } from "./report-model.js";
import { analyzeImageMetadata } from "./image-analysis.js";
import { businessKey } from "./storage.js";
import {
  IDENTITY,
  multiply,
  bounds,
  textLayout,
  documentDate,
  personnelTables,
  otherTables,
  quantityTableRecords,
  constructionBlocks,
  associateFigure,
  figureGroups,
  markDecorativeImages,
} from "./pdf-layout.js";

const DEFAULT_PDFJS_URL = "/vendor/pdf.mjs";
const DEFAULT_WORKER_URL = "/vendor/pdf.worker.mjs";

export async function loadPDFJS(url = DEFAULT_PDFJS_URL) {
  const pdfjs = await import(url);
  pdfjs.GlobalWorkerOptions.workerSrc = DEFAULT_WORKER_URL;
  return pdfjs;
}

export async function parseWithPDFJS(
  buffer,
  sourceFile,
  { pdfjs, ocrProvider, allowOCR = false } = {},
) {
  pdfjs ||= await loadPDFJS();
  const bytes = new Uint8Array(buffer),
    fingerprint = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    )
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
  const task = pdfjs.getDocument({
      data: bytes.slice(),
      useWorkerFetch: false,
      cMapUrl: "/vendor/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/vendor/standard_fonts/",
      wasmUrl: "/vendor/wasm/",
    }),
    doc = await task.promise;
  const records = [],
    pages = [],
    images = [],
    warnings = [],
    handles = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n),
        viewport = page.getViewport?.({ scale: 1 }) || {
          width: 595,
          height: 842,
          transform: [1, 0, 0, -1, 0, 842],
        },
        content = await page.getTextContent();
      const layout = textLayout(content.items || [], viewport);
      let text = layout.rows.map((r) => r.text).join("\n"),
        extractionMethod = "pdf-text";
      if (!text.trim() && allowOCR && ocrProvider) {
        const result = await ocrProvider.recognize(page, {
          sourceFile,
          pageNumber: n,
        });
        text = result?.text || "";
        extractionMethod = "ocr";
        warnings.push(
          `第 ${n} 页 OCR 文字需人工核对；未返回可信布局时不自动关联照片`,
        );
      }
      if (!text.trim())
        warnings.push(
          `第 ${n} 页没有可提取文字${allowOCR ? "，OCR 未返回内容" : "，未授权 OCR"}`,
        );
      const entry = {
        pageNumber: n,
        width: viewport.width,
        height: viewport.height,
        text,
        extractionMethod,
        layout,
        rows: layout.rows,
        tables: [],
        graphics: [],
        imagePlacements: [],
      };
      pages.push(entry);
      handles.push({ page, viewport });
      if (page.getOperatorList)
        try {
          const placements = await imagePlacements(page, pdfjs, viewport);
          entry.imagePlacements = placements.images;
          entry.graphics = placements.graphics;
        } catch (error) {
          warnings.push(`第 ${n} 页布局提取失败：${error.message}`);
        }
    }
    let decorativeImages=0;const date = documentDate(pages);
    for (let i = 0; i < pages.length; i++) {
      const entry = pages[i],
        { page } = handles[i],
        personnel = personnelTables(entry, date, sourceFile, fingerprint),
        blocks = constructionBlocks(entry, date, sourceFile);
      entry.tables = [...personnel.tables, ...otherTables(entry)];
      records.push(
        ...personnel.records,
        ...quantityTableRecords(otherTables(entry), entry, date, sourceFile),
      );
      if (blocks.length) records.push(...blocks.map((b) => b.record));
      else if (!personnel.records.length && entry.text.trim())
        records.push(
          ...mapPDFText(entry.text, {
            sourceFile,
            pageNumber: entry.pageNumber,
          }).map((r) =>
            withProvenance({
              ...r,
              extractionMethod: entry.extractionMethod,
              reviewFields:
                entry.extractionMethod === "ocr"
                  ? [
                      ...new Set([
                        ...(r.reviewFields || []),
                        "date",
                        "workshop",
                        "process",
                        "chineseStaff",
                        "localStaff",
                        "dailyConcrete",
                        "cumulativeConcrete",
                        "staffScope",
                        "workUnit",
                        "status",
                      ]),
                    ]
                  : r.reviewFields,
              sourceLocation: {
                pageNumber: entry.pageNumber,
                lines: entry.layout.lines.map((l) => ({
                  bbox: l.bbox,
                  text: l.text,
                })),
              },
            }),
          ),
        );
      entry.blocks = blocks.map(({ record, ...b }) => ({
        ...b,
        workshop: record.workshop,
        process: record.process,
        excerpt: record.sourceExcerpt,
      }));
      const placements = entry.imagePlacements;
      for (const group of figureGroups(placements))
        try {
          const decoded = [];
          for (const part of group.parts) {
            const objects = part.objectId?.startsWith("g_")
              ? page.commonObjs
              : page.objs;
            const object =
              part.inline ||
              (await new Promise((resolve, reject) => {
                const timer = setTimeout(
                  () => reject(new Error("图片解码超时")),
                  10000,
                );
                objects.get(part.objectId, (value) => {
                  clearTimeout(timer);
                  resolve(value);
                });
              }));
            decoded.push({
              ...part,
              dataUrl: decodedImageURL(object, pdfjs.ImageKind),
            });
          }
          const dataUrl =
              decoded.length === 1
                ? decoded[0].dataUrl
                : await composeFigure(decoded, group.bbox),
            association = associateFigure(group, blocks),
            related = association.record;
          // Label-style PDFs can associate only when exactly one record exists on the page.
          const labeled =
            !blocks.length && entry.extractionMethod !== "ocr"
              ? records.filter(
                  (r) =>
                    r.pageNumber === entry.pageNumber &&
                    r.recordType !== "personnel-summary" &&
                    r.date &&
                    r.workshop &&
                    r.process &&
                    !["date", "workshop", "process"].some((f) =>
                      r.reviewFields?.includes(f),
                    ),
                )
              : [];
          const record = related || (labeled.length === 1 ? labeled[0] : null),
            nearbyText = association.excerpt || record?.sourceExcerpt || "";
          const imageIndex =
            images.filter((im) => im.pageNumber === entry.pageNumber).length +
            1;
          const base = {
            imageId: `pdfjs-${fingerprint}-${entry.pageNumber}-${group.parts.map((p) => `${p.operatorIndex}_${p.occurrence || 0}`).join("-")}`,
            sourceFile,
            pageNumber: entry.pageNumber,
            imageIndex,
            figureNumber: association.figureNumber || imageIndex,
            mimeType: "image/png",
            dataUrl,
            bbox: group.bbox,
            pageWidth: entry.width,
            pageHeight: entry.height,
            components: group.parts.map(({ inline, ...p }) => p),
            nearbyText,
            sourceExcerpt: nearbyText,
            association: {
              ...(related
                ? association
                : record
                  ? {
                      status: "linked-record",
                      method: "explicit-single-activity-label",
                      excerpt: nearbyText,
                      needsReview: true,
                    }
                  : association),
              record: undefined,
            },
            relatedDate: record?.date || date.date,
            relatedWorkshop: record?.workshop || "",
            relatedProcess: association.process || record?.process || "",
            relatedRecordKey: record ? businessKey(record) : "",
            relatedActivities: record?.activities || [],
            reviewRecommended: true,
            manualReviewed: false,
            directEvidence: "PDF 页面嵌入图像（保留组件与布局坐标）",
            evidenceType: "直接证据",
          };
          images.push({ ...base, ...analyzeImageMetadata(base) });
        } catch (error) {
          warnings.push(
            `第 ${entry.pageNumber} 页图片提取失败，需人工核对：${error.message}`,
          );
        }
      page.cleanup?.();
    }
    decorativeImages=markDecorativeImages(pages.map(page=>({...page,imagePlacements:images.filter(image=>image.pageNumber===page.pageNumber)})));
    if(decorativeImages){const retained=images.filter(image=>!image.decorative);images.splice(0,images.length,...retained);}
    const documentLayout = pages.map((p) => ({
      pageNumber: p.pageNumber,
      width: p.width,
      height: p.height,
      extractionMethod: p.extractionMethod,
      text: p.text,
      tokens: p.layout.tokens,
      tables: p.tables,
      graphics: p.graphics,
      images: p.imagePlacements.map(({ inline, ...image }) => image),
      blocks: p.blocks,
    }));
    if (!records.length && images.length)
      images[0].documentLayout = documentLayout;
    if (records.length) {
      records[0].documentLayout = documentLayout;
      records[0].fileFingerprint = fingerprint;
    }
    return {
      records,
      pages,
      images,
      diagnostics: {
        pageCount: pages.length,
        textPages: pages.filter((p) => p.text.trim()).length,
        imageCount: images.length,
        decorativeImages,
        warnings,
        engine: "PDF.js",
        date: date.date,
      },
    };
  } finally {
    await task.destroy?.();
  }
}

export async function imagePlacements(page, pdfjs, viewport) {
  const ops = await page.getOperatorList(),
    images = [],
    graphics = [],
    stack = [];
  let matrix = IDENTITY.slice();
  for (let i = 0; i < ops.fnArray.length; i++) {
    const op = ops.fnArray[i],
      args = ops.argsArray[i],
      name = Object.entries(pdfjs.OPS).find(([, v]) => v === op)?.[0];
    if (name === "save") stack.push(matrix.slice());
    else if (name === "restore") matrix = stack.pop() || IDENTITY.slice();
    else if (name === "transform") matrix = multiply(matrix, args);
    else if (name === "paintFormXObjectBegin") {
      stack.push(matrix.slice());
      if (args?.[0]) matrix = multiply(matrix, args[0]);
    } else if (name === "paintFormXObjectEnd")
      matrix = stack.pop() || IDENTITY.slice();
    const vm = multiply(viewport.transform || IDENTITY, matrix);
    if (
      name === "constructPath" &&
      args?.[2]?.length === 4 &&
      graphics.length < 2000
    )
      graphics.push({
        operatorIndex: i,
        bbox: bounds(vm, Array.from(args[2])),
        kind: "vector-path",
      });
    if (name === "paintImageXObject" || name === "paintInlineImageXObject")
      images.push({
        operatorIndex: i,
        objectId: name === "paintImageXObject" ? args[0] : undefined,
        inline: name === "paintInlineImageXObject" ? args[0] : undefined,
        bbox: bounds(vm),
      });
    if (name === "paintImageXObjectRepeat")
      for (let j = 0; j < args[3].length; j += 2)
        images.push({
          operatorIndex: i,
          occurrence: j / 2,
          objectId: args[0],
          bbox: bounds(
            multiply(vm, [args[1], 0, 0, args[2], args[3][j], args[3][j + 1]]),
          ),
        });
  }
  return { images, graphics };
}
async function composeFigure(parts, bbox) {
  const scale = Math.min(4, 2048 / bbox.width),
    canvas = document.createElement("canvas");
  canvas.width = Math.ceil(bbox.width * scale);
  canvas.height = Math.ceil(bbox.height * scale);
  if (canvas.width * canvas.height > 40_000_000) throw new Error("图组过大");
  const context = canvas.getContext("2d");
  for (const p of parts) {
    const img = new Image();
    img.src = p.dataUrl;
    await img.decode();
    context.drawImage(
      img,
      (p.bbox.x - bbox.x) * scale,
      (p.bbox.y - bbox.y) * scale,
      p.bbox.width * scale,
      p.bbox.height * scale,
    );
  }
  return canvas.toDataURL("image/png");
}

export function decodedImageURL(image, kinds) {
  if (typeof document === "undefined")
    throw new Error("图片提取需要浏览器 Canvas");
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  if (
    !canvas.width ||
    !canvas.height ||
    canvas.width * canvas.height > 40_000_000
  )
    throw new Error("图片尺寸无效或过大");
  const context = canvas.getContext("2d");
  if (image.bitmap) context.drawImage(image.bitmap, 0, 0);
  else {
    const pixels = context.createImageData(canvas.width, canvas.height),
      data = image.data;
    if (image.kind === kinds.RGBA_32BPP) pixels.data.set(data);
    else if (image.kind === kinds.RGB_24BPP) {
      for (let p = 0, q = 0; p < data.length; p += 3, q += 4) {
        pixels.data[q] = data[p];
        pixels.data[q + 1] = data[p + 1];
        pixels.data[q + 2] = data[p + 2];
        pixels.data[q + 3] = 255;
      }
    } else if (image.kind === kinds.GRAYSCALE_1BPP) {
      const stride = Math.ceil(canvas.width / 8);
      for (let y = 0; y < canvas.height; y++)
        for (let x = 0; x < canvas.width; x++) {
          const v = data[y * stride + (x >> 3)] & (128 >> (x & 7)) ? 255 : 0,
            q = (y * canvas.width + x) * 4;
          pixels.data[q] = pixels.data[q + 1] = pixels.data[q + 2] = v;
          pixels.data[q + 3] = 255;
        }
    } else throw new Error("不支持的解码像素格式");
    context.putImageData(pixels, 0, 0);
  }
  return canvas.toDataURL("image/png");
}

export class OCRProvider {
  constructor({ endpoint, consent, accessToken = "", fetchImpl = fetch }) {
    this.endpoint = endpoint;
    this.consent = consent;
    this.accessToken = accessToken;
    this.fetch = (...args) => Reflect.apply(fetchImpl, globalThis, args);
  }
  async recognize(page, context) {
    if (!this.consent) throw new Error("OCR 需要用户明确授权");
    if (!this.endpoint) throw new Error("尚未配置 OCR 服务");
    if (typeof document === "undefined")
      throw new Error("OCR 页面渲染仅能在浏览器执行");
    const viewport = page.getViewport({ scale: 1.8 }),
      canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport })
      .promise;
    const response = await this.fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.accessToken
          ? { Authorization: `Bearer ${this.accessToken}` }
          : {}),
      },
      body: JSON.stringify({
        imageDataUrl: canvas.toDataURL("image/jpeg", 0.88),
        context,
        consent: true,
      }),
    });
    if (!response.ok) throw new Error(`OCR 服务返回 ${response.status}`);
    return response.json();
  }
}
