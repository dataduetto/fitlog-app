// Exporta a ficha do plano como PDF (A4, para imprimir/guardar) ou como imagens PNG
// (uma por treino, no formato da tela do celular). Um único motor de layout desenha
// nos dois destinos. Tudo é síncrono até o compartilhamento — o iPhone só abre a
// folha de compartilhamento se ela for chamada logo após o toque no botão.
import { jsPDF } from "jspdf";
import { repsFor } from "./registroDraft";

const C = {
  text: "#15201E", mid: "#4D5C5A", faint: "#86938F", teal: "#23806F", amber: "#9A5F0C",
  line: "#D6DEDC", band: "#ECF4F2", white: "#FFFFFF",
};

const fmtBR = (iso) => new Date(iso).toLocaleDateString("pt-BR");
const clean = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());

// ---------------------------------------------------------------------------
// Conteúdo
// ---------------------------------------------------------------------------
function prescricao(ex, phaseIdx) {
  const reps = repsFor(ex, phaseIdx);
  return `${ex.series ? `${ex.series} × ` : ""}${reps}`.trim();
}

function exerciseBlock(ex, i, phaseIdx) {
  const details = [];
  if (ex.pegada) details.push({ text: `Pegada: ${clean(ex.pegada)}`, color: C.mid });
  if (ex.tecnica) details.push({ text: `Técnica: ${clean(ex.tecnica)}`, color: C.amber });
  const extra = [ex.carga_sugerida, ex.obs].map(clean).filter(Boolean).join(" · ");
  if (extra) details.push({ text: extra, color: C.mid });
  return {
    t: "ex", first: i === 0, name: `${i + 1}. ${clean(ex.nome)}`, right: prescricao(ex, phaseIdx),
    right2: ex.descanso_s ? `descanso ${ex.descanso_s}s` : "", details,
  };
}

function sessionBlocks(s, phaseIdx) {
  const out = [{ t: "h2", text: `Treino ${s.id} — ${clean(s.foco)}` }];
  const meta = [s.duracao_min && `~${s.duracao_min} min`, s.aquecimento && `Aquecimento: ${clean(s.aquecimento)}`].filter(Boolean).join(" · ");
  if (meta) out.push({ t: "meta", text: meta, tight: true });
  (s.exercicios || []).forEach((ex, i) => out.push(exerciseBlock(ex, i, phaseIdx)));
  return out;
}

function headerMeta(plan, { phaseIdx, status }) {
  const fase = (plan.fases || [])[phaseIdx];
  const l1 = [
    plan.divisao && `Divisão ${plan.divisao}`,
    status ? `Validade: ${status.semanas} semanas (até ${fmtBR(status.expiresAt)})` : null,
  ].filter(Boolean).join("  ·  ");
  const l2 = fase ? `Repetições da fase ${phaseIdx + 1}: ${clean(fase.nome)} (semanas ${fase.semanas})` : "";
  return [l1, l2].filter(Boolean).map((text) => ({ t: "meta", text }));
}

export function buildFullFicha(plan, opts) {
  const { phaseIdx = 0 } = opts;
  const b = [{ t: "title", text: "Ficha de treino" }, ...headerMeta(plan, opts)];
  if (plan.resumoMeta) b.push({ t: "p", text: clean(plan.resumoMeta) });
  if ((plan.fases || []).length) {
    b.push({ t: "h3", text: "Fases" });
    plan.fases.forEach((f, i) => b.push({ t: "item", title: `Fase ${i + 1} · ${clean(f.nome)} (semanas ${f.semanas})${i === phaseIdx ? "  ← repetições desta ficha" : ""}`, text: clean(f.foco) }));
  }
  if ((plan.semanaTipo || []).length) {
    b.push({ t: "h3", text: "Semana tipo" });
    plan.semanaTipo.forEach((d) => b.push({ t: "item", title: clean(d.dia), text: clean(d.atividade), inline: true }));
    if (plan.como_seguir) b.push({ t: "p", text: clean(plan.como_seguir), small: true });
  }
  (plan.sessoes || []).forEach((s) => b.push(...sessionBlocks(s, phaseIdx)));
  if (plan.cardio?.itens?.length) {
    b.push({ t: "h3", text: "Cardio" });
    if (plan.cardio.resumo) b.push({ t: "p", text: clean(plan.cardio.resumo), small: true });
    plan.cardio.itens.forEach((c) => b.push({ t: "item", title: clean(c.tipo), text: [c.frequencia, c.duracao, c.intensidade].map(clean).filter(Boolean).join(" · ") }));
  }
  if (plan.progressao?.itens?.length) {
    b.push({ t: "h3", text: "Progressão de carga" });
    if (plan.progressao.resumo) b.push({ t: "p", text: clean(plan.progressao.resumo), small: true });
    plan.progressao.itens.forEach((it) => b.push({ t: "item", title: clean(it.exercicio), text: clean(it.sugestao) }));
  }
  return b;
}

export function buildSessionFicha(plan, s, opts) {
  return [
    { t: "title", text: `Treino ${s.id}`, small: true },
    ...headerMeta(plan, opts),
    ...sessionBlocks(s, opts.phaseIdx || 0).map((x) => (x.t === "h2" ? { ...x, text: clean(s.foco) } : x)),
  ];
}

// ---------------------------------------------------------------------------
// Layout: transforma blocos em grupos de operações de desenho (texto e retângulos)
// medidos pelo "adapter" do destino (PDF ou canvas).
// ---------------------------------------------------------------------------
function wrap(m, text, size, bold, maxW) {
  const words = String(text).split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const tryLine = cur ? `${cur} ${w}` : w;
    if (m(tryLine, size, bold) <= maxW || !cur) cur = tryLine;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

export function layout(blocks, m, W) {
  const groups = [];
  const LH = 1.32;
  const textLines = (ops, lines, x, y, size, bold, color, align = "left") => {
    lines.forEach((ln, i) => ops.push({ k: "text", x, y: y + i * size * LH, text: ln, size, bold, color, align }));
    return lines.length * size * LH;
  };
  for (const b of blocks) {
    const ops = [];
    let h = 0;
    if (b.t === "title") {
      const size = b.small ? 17 : 19;
      h = textLines(ops, wrap(m, b.text, size, true, W), 0, 0, size, true, C.text) + 4;
    } else if (b.t === "meta") {
      h = textLines(ops, wrap(m, b.text, 8.8, false, W), 0, b.tight ? 2 : 0, 8.8, false, C.mid) + (b.tight ? 6 : 3);
    } else if (b.t === "p") {
      const size = b.small ? 9 : 9.8;
      h = 6 + textLines(ops, wrap(m, b.text, size, false, W), 0, 6, size, false, b.small ? C.mid : C.text) + 2;
    } else if (b.t === "h3") {
      ops.push({ k: "rect", x: 0, y: 14, w: W, h: 0.8, color: C.line });
      h = 20 + textLines(ops, [b.text], 0, 20, 11.5, true, C.text) + 4;
      groups.push({ ops, h, keep: true });
      continue;
    } else if (b.t === "h2") {
      const size = 12.5;
      const lines = wrap(m, b.text, size, true, W - 18);
      const bandH = lines.length * size * LH + 10;
      ops.push({ k: "rect", x: 0, y: 16, w: W, h: bandH, color: C.band });
      ops.push({ k: "rect", x: 0, y: 16, w: 3, h: bandH, color: C.teal });
      textLines(ops, lines, 11, 16 + 5.5, size, true, C.teal);
      h = 16 + bandH + 4;
      groups.push({ ops, h, keep: true });
      continue;
    } else if (b.t === "item") {
      const size = 9.6;
      if (b.inline) {
        const tw = Math.min(W * 0.28, Math.max(...[b.title].map((t) => m(t, size, true))) + 10);
        const lt = textLines(ops, wrap(m, b.title, size, true, tw - 6), 0, 4, size, true, C.text);
        const lr = textLines(ops, wrap(m, b.text, size, false, W - tw), tw, 4, size, false, b.text && /descanso/i.test(b.text) ? C.mid : C.text);
        h = 4 + Math.max(lt, lr);
      } else {
        const lt = textLines(ops, wrap(m, b.title, size, true, W - 10), 10, 5, size, true, C.text);
        const lr = b.text ? textLines(ops, wrap(m, b.text, 9, false, W - 10), 10, 5 + lt + 1, 9, false, C.mid) : 0;
        ops.push({ k: "rect", x: 0, y: 6, w: 2.5, h: lt + lr - 2, color: C.teal });
        h = 5 + lt + lr + 3;
      }
    } else if (b.t === "ex") {
      const top = 7;
      if (!b.first) ops.push({ k: "rect", x: 0, y: 0, w: W, h: 0.6, color: C.line });
      const rSize = 11, r2Size = 8.6, nSize = 10.6;
      const rw = Math.max(m(b.right, rSize, true), b.right2 ? m(b.right2, r2Size, false) : 0);
      const nameW = W - rw - 12;
      const ln = textLines(ops, wrap(m, b.name, nSize, true, nameW), 0, top, nSize, true, C.text);
      let rh = textLines(ops, [b.right], W, top, rSize, true, C.text, "right");
      if (b.right2) rh += textLines(ops, [b.right2], W, top + rh, r2Size, false, C.mid, "right");
      let y = top + Math.max(ln, rh) + 1;
      for (const d of b.details) y += textLines(ops, wrap(m, d.text, 9, false, W - 14), 14, y, 9, false, d.color) + 1;
      h = y + 6;
    }
    groups.push({ ops, h });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// PDF (A4)
// ---------------------------------------------------------------------------
// As fontes padrão do PDF só cobrem o alfabeto latino básico (acentos do português incluídos).
const latin1 = (t) => String(t)
  .replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...")
  .replace(/≥/g, ">=").replace(/≤/g, "<=").replace(/[→⟶]/g, "->").replace(/←/g, "<-").replace(/[•●]/g, "·")
  .replace(/[^\x20-\xFF]/g, "");

function sanitizeBlocks(blocks) {
  return blocks.map((b) => {
    const o = { ...b };
    for (const k of ["text", "title", "name", "right", "right2"]) if (o[k] != null) o[k] = latin1(o[k]);
    if (o.details) o.details = o.details.map((d) => ({ ...d, text: latin1(d.text) }));
    return o;
  });
}

export function renderPDF(blocks, footer) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const M = 40, W = PW - 2 * M, top = M, bottom = PH - M - 14;
  const m = (t, size, bold) => { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); return doc.getTextWidth(t); };
  const groups = layout(sanitizeBlocks(blocks), m, W);
  let y = top;
  groups.forEach((g, i) => {
    // títulos ficam presos ao primeiro item que vem depois deles
    const need = g.h + (g.keep && groups[i + 1] ? groups[i + 1].h : 0);
    if (y + need > bottom && y > top) { doc.addPage(); y = top; }
    for (const op of g.ops) {
      if (op.k === "rect") { doc.setFillColor(op.color); doc.rect(M + op.x, y + op.y, op.w, op.h, "F"); }
      else {
        doc.setFont("helvetica", op.bold ? "bold" : "normal"); doc.setFontSize(op.size); doc.setTextColor(op.color);
        doc.text(op.text, M + op.x, y + op.y, { baseline: "top", align: op.align });
      }
    }
    y += g.h;
  });
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(C.faint);
    doc.text(latin1(footer), M, PH - M + 4, { baseline: "top" });
    doc.text(`Página ${p} de ${pages}`, PW - M, PH - M + 4, { baseline: "top", align: "right" });
  }
  return doc.output("blob");
}

// ---------------------------------------------------------------------------
// PNG (formato de tela de celular)
// ---------------------------------------------------------------------------
const FONT = '-apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif';
const cssFont = (size, bold) => `${bold ? "600 " : ""}${size}px ${FONT}`;

export function renderPNGDataURL(blocks, footer, { W = 340, M = 20 } = {}) {
  const mctx = document.createElement("canvas").getContext("2d");
  const m = (t, size, bold) => { mctx.font = cssFont(size, bold); return mctx.measureText(t).width; };
  const groups = layout(blocks, m, W);
  const H = M + groups.reduce((a, g) => a + g.h, 0) + 26 + M;
  let S = 3;
  while ((W + 2 * M) * S * H * S > 16e6 && S > 1) S -= 0.5; // limite de tamanho de canvas do iPhone
  const canvas = document.createElement("canvas");
  canvas.width = Math.round((W + 2 * M) * S);
  canvas.height = Math.round(H * S);
  const ctx = canvas.getContext("2d");
  ctx.scale(S, S);
  ctx.fillStyle = C.white; ctx.fillRect(0, 0, W + 2 * M, H);
  ctx.textBaseline = "top";
  let y = M;
  for (const g of groups) {
    for (const op of g.ops) {
      if (op.k === "rect") { ctx.fillStyle = op.color; ctx.fillRect(M + op.x, y + op.y, op.w, op.h); }
      else { ctx.font = cssFont(op.size, op.bold); ctx.fillStyle = op.color; ctx.textAlign = op.align; ctx.fillText(op.text, M + op.x, y + op.y); }
    }
    y += g.h;
  }
  ctx.textAlign = "left"; ctx.font = cssFont(8, false); ctx.fillStyle = C.faint;
  ctx.fillText(footer, M, H - M - 8);
  return canvas.toDataURL("image/png");
}

function dataURLToFile(dataURL, name) {
  const [head, b64] = dataURL.split(",");
  const mime = head.match(/:(.*?);/)[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

// ---------------------------------------------------------------------------
// Entrega: folha de compartilhamento no celular (Salvar em Arquivos / Salvar imagem /
// Imprimir), download no computador.
// ---------------------------------------------------------------------------
async function deliver(files, title) {
  const touch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  if (touch && navigator.canShare?.({ files })) {
    try { await navigator.share({ files, title }); return "shared"; }
    catch (e) { if (e?.name === "AbortError") return "cancelled"; /* cai para o download */ }
  }
  files.forEach((f, i) => {
    const url = URL.createObjectURL(f);
    setTimeout(() => {
      const a = document.createElement("a");
      a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }, i * 300);
  });
  return "downloaded";
}

const stamp = () => {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};
const footerText = (plan) => `FitLog · ficha gerada em ${fmtBR(plan.generatedAt || Date.now())} · exportada em ${new Date().toLocaleDateString("pt-BR")}`;

export function exportFichaPDF(plan, opts) {
  const blob = renderPDF(buildFullFicha(plan, opts), footerText(plan));
  const file = new File([blob], `ficha-treino-${stamp()}.pdf`, { type: "application/pdf" });
  return deliver([file], "Ficha de treino");
}

export function exportFichaImages(plan, opts) {
  const files = (plan.sessoes || []).map((s) =>
    dataURLToFile(renderPNGDataURL(buildSessionFicha(plan, s, opts), footerText(plan)), `treino-${String(s.id).toLowerCase()}-${stamp()}.png`));
  return deliver(files, "Ficha de treino");
}
