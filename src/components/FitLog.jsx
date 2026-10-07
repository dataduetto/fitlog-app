import { useState, useEffect, useMemo, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from "recharts";
import {
  Dumbbell, HeartPulse, UtensilsCrossed, LineChart as LineChartIcon,
  Sparkles, Trash2, Plus, CalendarDays, Loader2, RefreshCw, Ruler, Target, LogOut, AlertTriangle, History
} from "lucide-react";
import { loadState, persistState, emptyState } from "../lib/storage";
import { classifyExercise, generatePlanFromContext } from "../lib/claude";
import { estimateMacros, macroInputFrom } from "../lib/nutrition";
import { planStatus, currentPhaseIndex } from "../lib/planStatus";
import {
  GOALS, GOAL_INFO, SEXO_OPCOES, ATIVIDADE_DIARIA_OPCOES, EXPERIENCIA_OPCOES, LOCAL_OPCOES, DIVISAO_OPCOES,
  TECNICAS_OPCOES, CICLO_OPCOES, CARDIO_OPCOES, PRIORIDADES_OPCOES, TEMPO_SESSAO_OPCOES,
} from "../lib/goals";
import { debounce } from "../lib/debounce";
import {
  MEDIDAS, DEFAULT_SETS, periodStart, buildBodySeries, withMovingAverage, filterFrom,
  firstLastDelta, buildMeasureSeries, latestMeasures, measureHistoryForPlan, buildLoadSeries,
  buildMuscleVolume, buildConsistency, buildWeeklyMinutes,
} from "../lib/analytics";

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------
const COLORS = {
  bg: "#10161A",
  surface: "#182024",
  surfaceRaised: "#1E2A2E",
  line: "#26332F",
  lineStrong: "#324340",
  textHi: "#F2F5F4",
  textMid: "#9FB0AF",
  textFaint: "#647675",
  teal: "#3FA796",
  tealSoft: "#2A4A44",
  amber: "#E3A857",
  amberSoft: "#4A3A22",
  red: "#D9695B",
  redSoft: "#241A18",
};

const EXERCICIOS_COMUNS = [
  "Supino reto", "Supino inclinado", "Puxada pronada", "Puxada supinada", "Remada baixa",
  "Rosca alternada com halteres", "Rosca direta", "Tríceps testa", "Tríceps corda",
  "Desenvolvimento com halteres", "Elevação lateral", "Agachamento livre", "Leg press",
  "Cadeira extensora", "Mesa flexora", "Stiff", "Abdominal supra", "Prancha",
];

const ESQUEMAS_COMUNS = [
  "3x10-12", "3x8-10", "4x6-8", "3x12-15", "Pirâmide crescente",
  "3x8 com queda de carga na última série até a falha", "Drop set", "Bi-set",
];

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
function fmtDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}`;
}
function uid() {
  return Math.random().toString(36).slice(2, 10);
}
function emptyDay(date) {
  return {
    date, weight: "", leanMassPct: "", bodyFatPct: "", medidas: {},
    strengthWorkouts: [], cardioWorkouts: [],
  };
}
function n(v) {
  return v === "" || v == null ? null : Number(v);
}

// ---------------------------------------------------------------------------
// Small UI atoms
// ---------------------------------------------------------------------------
function Field({ label, children, hint }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 13, color: COLORS.textMid, fontFamily: "'IBM Plex Sans', sans-serif" }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11.5, color: COLORS.textFaint }}>{hint}</span>}
    </label>
  );
}
const inputStyle = {
  background: COLORS.bg, border: `1px solid ${COLORS.line}`, borderRadius: 4,
  color: COLORS.textHi, padding: "9px 10px", fontSize: 14,
  fontFamily: "'IBM Plex Sans', sans-serif", outline: "none",
};
function TextInput(props) { return <input {...props} style={{ ...inputStyle, ...(props.style || {}) }} />; }
function Select(props) { return <select {...props} style={{ ...inputStyle, ...(props.style || {}) }} />; }
function TextArea(props) { return <textarea {...props} style={{ ...inputStyle, resize: "vertical", ...(props.style || {}) }} />; }

function IconButton({ onClick, children, title, danger }) {
  return (
    <button onClick={onClick} title={title} style={{
      background: "transparent", border: `1px solid ${danger ? "#5C332E" : COLORS.line}`,
      color: danger ? COLORS.red : COLORS.textMid, borderRadius: 4, width: 30, height: 30,
      display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0,
    }}>{children}</button>
  );
}
function PrimaryButton({ onClick, children, disabled, full }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: disabled ? COLORS.tealSoft : COLORS.teal, color: disabled ? COLORS.textFaint : "#0B1614",
      border: "none", borderRadius: 4, padding: "10px 16px", fontSize: 14, fontWeight: 600,
      fontFamily: "'Space Grotesk', sans-serif", cursor: disabled ? "default" : "pointer",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: full ? "100%" : "auto",
    }}>{children}</button>
  );
}
function GhostButton({ onClick, children, full }) {
  return (
    <button onClick={onClick} style={{
      background: "transparent", color: COLORS.textHi, border: `1px solid ${COLORS.lineStrong}`,
      borderRadius: 4, padding: "9px 14px", fontSize: 13.5, fontFamily: "'IBM Plex Sans', sans-serif",
      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: full ? "100%" : "auto",
    }}>{children}</button>
  );
}
function StatReadout({ label, value, unit, delta, sub }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 100 }}>
      <span style={{ fontSize: 12, color: COLORS.textMid, fontFamily: "'IBM Plex Sans', sans-serif" }}>{label}</span>
      <span style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
        <span style={{ fontSize: 24, fontWeight: 600, color: COLORS.textHi, fontFamily: "'Space Grotesk', sans-serif", fontVariantNumeric: "tabular-nums" }}>{value}</span>
        {unit && <span style={{ fontSize: 12.5, color: COLORS.textMid }}>{unit}</span>}
      </span>
      {delta != null && (
        <span style={{ fontSize: 11.5, color: delta <= 0 ? COLORS.teal : COLORS.amber, fontFamily: "'Space Grotesk', sans-serif" }}>
          {delta > 0 ? "+" : ""}{delta.toFixed(1)} desde o último registro
        </span>
      )}
      {sub && <span style={{ fontSize: 11.5, color: COLORS.textFaint }}>{sub}</span>}
    </div>
  );
}
function SectionTitle({ icon: Icon, title }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Icon size={16} color={COLORS.teal} />
      <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600 }}>{title}</span>
    </div>
  );
}
function EmptyState({ text }) {
  return (
    <div style={{ border: `1px dashed ${COLORS.lineStrong}`, borderRadius: 4, padding: 24, fontSize: 13.5, color: COLORS.textMid, textAlign: "center" }}>
      {text}
    </div>
  );
}
// ---------------------------------------------------------------------------
// Sugestão de macronutrientes (calculada no app, sem IA)
// ---------------------------------------------------------------------------
const fmtKg = (x) => Number(x).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
function MacroCard({ result, weightDate, onGoToAssessment }) {
  const [open, setOpen] = useState(false);
  if (!result || !result.ok) {
    const msg = result?.motivo === "menor_de_idade"
      ? "A sugestão automática de macronutrientes não é calculada para menores de 18 anos. Procure um nutricionista."
      : "Informe o peso acima para ver a sugestão diária de calorias e macronutrientes.";
    return (
      <div style={{ background: COLORS.surface, border: `1px dashed ${COLORS.lineStrong}`, borderRadius: 4, padding: "12px 14px", fontSize: 13, color: COLORS.textMid }}>{msg}</div>
    );
  }
  const d = result.detalhes;
  const falta = [];
  if (d.aproximado || d.suposicoes.length) falta.push(true);
  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.line}`, borderRadius: 4, padding: "14px 14px 12px" }}>
      <SectionTitle icon={UtensilsCrossed} title="Sugestão diária de macronutrientes" />
      <div style={{ fontSize: 12, color: COLORS.textMid, marginTop: 4 }}>
        Atualizada com o último peso lançado ({d.pesoKg} kg{weightDate ? `, ${fmtDate(weightDate)}` : ""}). Use como meta na sua ferramenta de contagem.
      </div>
      <div style={{ display: "flex", gap: 24, marginTop: 12, flexWrap: "wrap" }}>
        <StatReadout label="Proteínas" value={result.proteinas_g} unit="g" sub={`${fmtKg(result.porKg.proteina)} g/kg`} />
        <StatReadout label="Carboidratos" value={result.carboidratos_g} unit="g" sub={`${fmtKg(result.porKg.carboidrato)} g/kg`} />
        <StatReadout label="Gorduras" value={result.gorduras_g} unit="g" sub={`${fmtKg(result.porKg.gordura)} g/kg`} />
        <StatReadout label="Calorias" value={result.calorias_kcal} unit="kcal" sub={d.ajustePct === 0 ? "manutenção" : `${d.ajustePct > 0 ? "+" : "−"}${Math.abs(d.ajustePct)}% sobre o gasto`} />
      </div>
      {[...d.avisos, ...d.suposicoes].length > 0 && (
        <ul style={{ margin: "10px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3 }}>
          {[...d.avisos, ...d.suposicoes].map((t, i) => <li key={i} style={{ fontSize: 11.5, color: COLORS.amber, lineHeight: 1.45 }}>{t}</li>)}
        </ul>
      )}
      <div style={{ display: "flex", gap: 14, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => setOpen(!open)} style={{ background: "none", border: "none", color: COLORS.teal, fontSize: 12, cursor: "pointer", padding: 0 }}>
          {open ? "Ocultar como é calculado" : "Como é calculado"}
        </button>
        {onGoToAssessment && (
          <button onClick={onGoToAssessment} style={{ background: "none", border: "none", color: COLORS.textMid, fontSize: 12, cursor: "pointer", padding: 0, textDecoration: "underline" }}>
            Melhorar a precisão (altura, idade, sexo — opcionais)
          </button>
        )}
      </div>
      {open && (
        <div style={{ marginTop: 10, fontSize: 12, color: COLORS.textMid, lineHeight: 1.6, borderTop: `1px solid ${COLORS.line}`, paddingTop: 10 }}>
          <div>Metabolismo basal: <b style={{ color: COLORS.textHi }}>{d.bmr} kcal</b> ({d.metodoBmr}).</div>
          <div>Gasto diário estimado: {d.bmr} × {String(d.fatorAtividade).replace(".", ",")} (atividade do dia a dia + dias de treino) = <b style={{ color: COLORS.textHi }}>{d.tdee} kcal</b>.</div>
          <div>Meta ({GOALS[d.meta]}): {d.ajustePct === 0 ? "calorias na manutenção" : `${d.ajustePct > 0 ? "+" : "−"}${Math.abs(d.ajustePct)}% sobre o gasto`}.</div>
          <div>Proteína: {String(d.protGPorKgRef).replace(".", ",")} g por kg{d.pesoAjustado ? ` sobre um peso de referência ajustado de ${d.pesoReferenciaKg} kg (peso ideal + 40% do excesso)` : ""}. Gordura: pelo menos 0,6 g/kg e cerca de 25% das calorias. Carboidratos: o restante.</div>
          <div style={{ marginTop: 6, color: COLORS.textFaint }}>É uma estimativa para começar; ajuste pelo resultado de 2 a 3 semanas (peso e medidas). Não substitui acompanhamento de nutricionista.</div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------
export default function FitLog({ userId, onLogout, userEmail }) {
  const [state, setState] = useState(emptyState);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("registro");
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await loadState(userId);
      if (!cancelled) {
        setState(s);
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Grava no Supabase com debounce — evita uma escrita a cada tecla digitada.
  const debouncedPersist = useMemo(() => debounce((s) => persistState(userId, s), 600), [userId]);

  const commit = useCallback((next) => { setState(next); debouncedPersist(next); }, [debouncedPersist]);
  // Versão "funcional": parte do estado mais recente, não do que existia quando a função foi criada.
  // Necessária depois de operações demoradas (ex.: gerar o plano leva segundos).
  const commitWith = useCallback((fn) => {
    setState((prev) => {
      const next = fn(prev);
      debouncedPersist(next);
      return next;
    });
  }, [debouncedPersist]);
  const { logs, assessments, currentPlan, exerciseCatalog } = state;
  const day = logs[selectedDate] || emptyDay(selectedDate);
  const latestAssessment = assessments.length ? assessments[assessments.length - 1] : null;

  const ensureExerciseClassified = useCallback((nome) => {
    const key = nome.trim().toLowerCase();
    if (!key || (state.exerciseCatalog || {})[key]) return;
    classifyExercise(nome).then((res) => {
      setState((prev) => {
        if ((prev.exerciseCatalog || {})[key]) return prev;
        const next = { ...prev, exerciseCatalog: { ...(prev.exerciseCatalog || {}), [key]: { nomeOriginal: nome, ...res } } };
        debouncedPersist(next);
        return next;
      });
    }).catch(() => {});
  }, [state.exerciseCatalog, debouncedPersist]);

  const updateDay = useCallback((patch) => {
    const nextDay = { ...(logs[selectedDate] || emptyDay(selectedDate)), ...patch };
    commit({ ...state, logs: { ...logs, [selectedDate]: nextDay } });
  }, [state, logs, selectedDate, commit]);

  const sortedDates = useMemo(() => Object.keys(logs).sort(), [logs]);

  const streak = useMemo(() => {
    let count = 0;
    let cursor = new Date(todayISO());
    while (true) {
      const iso = cursor.toISOString().slice(0, 10);
      const e = logs[iso];
      const hasData = e && ((e.strengthWorkouts || []).length || (e.cardioWorkouts || []).length || e.weight);
      if (hasData) { count += 1; cursor.setDate(cursor.getDate() - 1); } else break;
    }
    return count;
  }, [logs]);

  const weightSeries = useMemo(() => sortedDates
    .filter((d) => logs[d].weight !== "" && logs[d].weight != null)
    .map((d) => ({ date: d, label: fmtDate(d), peso: Number(logs[d].weight), massaMagra: logs[d].leanMassPct !== "" ? Number(logs[d].leanMassPct) : null })),
    [sortedDates, logs]);
  const latestWeight = weightSeries.length ? weightSeries[weightSeries.length - 1] : null;
  const prevWeight = weightSeries.length > 1 ? weightSeries[weightSeries.length - 2] : null;

  // Séries para gráficos, plano e pré-preenchimento da avaliação
  const bodySeries = useMemo(() => buildBodySeries(logs, sortedDates), [logs, sortedDates]);
  const measureSeries = useMemo(() => buildMeasureSeries(logs, sortedDates, assessments), [logs, sortedDates, assessments]);
  const latestMedidas = useMemo(() => latestMeasures(measureSeries), [measureSeries]);
  const latestBodyFat = useMemo(() => {
    const p = [...bodySeries].reverse().find((x) => x.gordura != null);
    return p ? p.gordura : "";
  }, [bodySeries]);

  // Sugestão de macros: recalculada sozinha sempre que o peso mais recente (ou a avaliação) muda.
  const macroResult = useMemo(
    () => estimateMacros(macroInputFrom({ latestWeight, latestBodyFat, assessment: latestAssessment })),
    [latestWeight, latestBodyFat, latestAssessment]
  );
  const pStatus = useMemo(() => planStatus(currentPlan, logs), [currentPlan, logs]);

  // -------- plan generation --------
  const buildContext = useCallback((assessment) => {
    const recentDates = sortedDates.slice(-14);
    const prevAssessment = assessments.length > 1 ? assessments[assessments.length - 2] : null;
    return {
      avaliacaoAtual: assessment,
      avaliacaoAnterior: prevAssessment,
      // peso, % de massa magra e % de gordura dos últimos 30 registros
      historicoPeso: bodySeries.slice(-30).map(({ date, peso, massaMagra, gordura }) => ({ date, peso, massaMagra, gordura })),
      // medidas lançadas no registro diário (podem ser mais recentes que a última avaliação)
      historicoMedidas: measureHistoryForPlan(measureSeries),
      treinosForcaRecentes: recentDates.flatMap((d) => (logs[d].strengthWorkouts || []).map((s) => ({ data: d, ...s }))),
      treinosCardioRecentes: recentDates.flatMap((d) => (logs[d].cardioWorkouts || []).map((c) => ({ data: d, ...c }))),
      catalogoExercicios: exerciseCatalog || {},
      metasMacro: macroResult.ok
        ? { calorias_kcal: macroResult.calorias_kcal, proteinas_g: macroResult.proteinas_g, carboidratos_g: macroResult.carboidratos_g, gorduras_g: macroResult.gorduras_g }
        : null,
      planoAnterior: currentPlan?.sessoes ? {
        divisao: currentPlan.divisao, validade: currentPlan.validade, geradoEm: currentPlan.generatedAt,
        sessoes: currentPlan.sessoes.map((x) => ({ id: x.id, foco: x.foco, exercicios: x.exercicios.map((e) => `${e.nome} ${e.series}x${e.reps?.[0] ?? ""}`) })),
      } : null,
    };
  }, [sortedDates, assessments, bodySeries, measureSeries, logs, exerciseCatalog, macroResult, currentPlan]);

  const generatePlan = async (assessment) => {
    const useAssessment = assessment || latestAssessment;
    if (!useAssessment) { setPlanError("Preencha a avaliação física antes de gerar um plano."); return; }
    setPlanLoading(true); setPlanError("");
    try {
      const context = buildContext(cleanAssessment(useAssessment));
      const parsed = await generatePlanFromContext(context);
      const nextPlan = { ...parsed, generatedAt: new Date().toISOString(), assessmentId: useAssessment.id };
      // Funcional de propósito: durante a geração você pode ter salvo uma avaliação ou lançado
      // dados; gravar a partir do estado antigo apagaria isso.
      commitWith((prev) => ({ ...prev, currentPlan: nextPlan }));
      setTab("plano");
    } catch (e) {
      setPlanError(`Não foi possível gerar o plano: ${e?.message || "erro desconhecido"}`);
    } finally {
      setPlanLoading(false);
    }
  };

  // Remove campos vazios (o plano trata ausência como "sem preferência").
  const cleanAssessment = (a) => Object.fromEntries(
    Object.entries(a).filter(([, v]) => v !== "" && v != null && !(Array.isArray(v) && v.length === 0))
  );

  const saveAssessment = (draft) => {
    const date = todayISO();
    const assessment = { id: uid(), date, ...cleanAssessment(draft) };
    // Os valores que você digitou ou alterou na avaliação também entram no registro de hoje,
    // para alimentar os gráficos do Painel. Os campos que vieram pré-preenchidos e não foram
    // mexidos NÃO entram: seriam medidas antigas aparecendo como se fossem de hoje.
    const baseline = {
      weight: latestWeight?.peso ?? "", leanMassPct: latestWeight?.massaMagra ?? "", bodyFatPct: latestBodyFat ?? "",
      ...latestMedidas,
    };
    const changed = (k) => draft[k] !== "" && draft[k] != null && String(draft[k]) !== String(baseline[k] ?? "");
    commitWith((prev) => {
      const base = prev.logs[date] || emptyDay(date);
      const dayPatch = {};
      for (const k of ["weight", "leanMassPct", "bodyFatPct"]) if (changed(k)) dayPatch[k] = draft[k];
      const medidas = { ...(base.medidas || {}) };
      for (const { key } of MEDIDAS) if (changed(key)) medidas[key] = draft[key];
      return {
        ...prev,
        assessments: [...prev.assessments, assessment],
        logs: { ...prev.logs, [date]: { ...base, ...dayPatch, medidas } },
      };
    });
    generatePlan(assessment);
  };

  const fontImport = (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap');
      * { box-sizing: border-box; }
      ::placeholder { color: ${COLORS.textFaint}; }
      input:focus, select:focus, textarea:focus { border-color: ${COLORS.teal} !important; }
      .fitlog-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
      .fitlog-scroll::-webkit-scrollbar-thumb { background: ${COLORS.lineStrong}; border-radius: 3px; }
      @keyframes spin { to { transform: rotate(360deg); } }
      /* celular: o menu lateral vira uma barra horizontal no topo */
      @media (max-width: 720px) {
        .fitlog-body { flex-direction: column !important; }
        .fitlog-nav { width: auto !important; flex-direction: row !important; overflow-x: auto; border-right: none !important; border-bottom: 1px solid ${COLORS.line}; padding: 8px 10px !important; }
        .fitlog-nav button { white-space: nowrap; flex-shrink: 0; }
        .fitlog-content { padding: 14px !important; }
      }
      body { margin: 0; background: ${COLORS.bg}; }
    `}</style>
  );

  if (!loaded) {
    return (
      <div style={{ background: COLORS.bg, color: COLORS.textMid, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'IBM Plex Sans', sans-serif" }}>
        {fontImport}<Loader2 size={18} style={{ marginRight: 8, animation: "spin 1s linear infinite" }} />Carregando registros…
      </div>
    );
  }

  const NAV = [
    { id: "registro", label: "Registro", icon: CalendarDays },
    { id: "avaliacao", label: "Avaliação", icon: Ruler },
    { id: "plano", label: "Plano", icon: Target },
    { id: "painel", label: "Painel", icon: LineChartIcon },
    { id: "historico", label: "Histórico", icon: History },
  ];

  return (
    <div style={{ background: COLORS.bg, color: COLORS.textHi, minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "'IBM Plex Sans', sans-serif" }}>
      {fontImport}
      <div style={{ borderBottom: `1px solid ${COLORS.line}`, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 19, fontWeight: 600 }}>Diário de treino</div>
          <div style={{ fontSize: 12.5, color: COLORS.textMid, marginTop: 2 }}>
            {latestAssessment ? `Meta atual: ${GOALS[latestAssessment.meta]}` : "Preencha a avaliação física para definir uma meta"}
            {streak > 0 ? ` · Sequência: ${streak} dia${streak > 1 ? "s" : ""}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {latestWeight && <StatReadout label="Peso atual" value={latestWeight.peso} unit="kg" delta={prevWeight ? latestWeight.peso - prevWeight.peso : null} />}
          {latestWeight && latestWeight.massaMagra != null && <StatReadout label="Massa magra" value={latestWeight.massaMagra} unit="%" />}
          <IconButton onClick={onLogout} title={userEmail ? `Sair (${userEmail})` : "Sair"}><LogOut size={14} /></IconButton>
        </div>
      </div>

      <div className="fitlog-body" style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div className="fitlog-nav" style={{ width: 168, borderRight: `1px solid ${COLORS.line}`, padding: "14px 10px", display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
          {NAV.map((it) => {
            const Icon = it.icon; const active = tab === it.id;
            return (
              <button key={it.id} onClick={() => setTab(it.id)} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 4, border: "none",
                background: active ? COLORS.tealSoft : "transparent", color: active ? COLORS.teal : COLORS.textMid,
                fontSize: 13.5, fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: active ? 600 : 400,
                cursor: "pointer", textAlign: "left",
              }}><Icon size={16} />{it.label}</button>
            );
          })}
        </div>

        <div className="fitlog-scroll fitlog-content" style={{ flex: 1, padding: 20, overflowY: "auto", minWidth: 0 }}>
          <PlanExpiryBanner
            status={pStatus} loading={planLoading}
            primaryLabel={pStatus?.expired ? "Gerar nova ficha" : "Ver ficha"}
            onPrimary={() => (pStatus?.expired && latestAssessment ? (setTab("plano"), generatePlan(latestAssessment)) : setTab("plano"))}
          />
          {tab === "registro" && (
            <RegistroTab
              selectedDate={selectedDate} setSelectedDate={setSelectedDate}
              day={day} updateDay={updateDay}
              onClassifyExercise={ensureExerciseClassified}
              macroResult={macroResult} weightDate={latestWeight?.date}
              onGoToAssessment={() => setTab("avaliacao")}
            />
          )}
          {tab === "avaliacao" && (
            <AvaliacaoTab
              latestAssessment={latestAssessment} assessments={assessments}
              latestWeight={latestWeight} latestMedidas={latestMedidas} latestBodyFat={latestBodyFat} onSave={saveAssessment}
              planLoading={planLoading} planError={planError}
            />
          )}
          {tab === "plano" && (
            <PlanoTab plan={currentPlan} loading={planLoading} error={planError}
              onRegenerate={() => generatePlan(latestAssessment)} hasAssessment={!!latestAssessment}
              onGoToAssessment={() => setTab("avaliacao")}
              status={pStatus} macroResult={macroResult} weightDate={latestWeight?.date} />
          )}
          {tab === "painel" && (
            <PainelTab logs={logs} sortedDates={sortedDates} bodySeries={bodySeries} measureSeries={measureSeries}
              exerciseCatalog={exerciseCatalog} latestAssessment={latestAssessment} />
          )}
          {tab === "historico" && (
            <HistoricoTab sortedDates={sortedDates} logs={logs}
              onSelect={(d) => { setSelectedDate(d); setTab("registro"); }}
              onDelete={(d) => { const next = { ...logs }; delete next[d]; commit({ ...state, logs: next }); }} />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------
function RegistroTab({ selectedDate, setSelectedDate, day, updateDay, onClassifyExercise, macroResult, weightDate, onGoToAssessment }) {
  const [exerciseList, setExerciseList] = useState([]);
  const [exerciseDraft, setExerciseDraft] = useState({ nome: "", carga_kg: "", esquema: "" });
  const [sessionDraft, setSessionDraft] = useState({ duracao: "", hr_avg: "", hr_max: "", calorias: "", rpe: "7" });
  const [cardioDraft, setCardioDraft] = useState({ tipo: "corrida", duracao: "", hr_avg: "", hr_max: "", pace: "", calorias: "", rpe: "6" });
  const [showMedidas, setShowMedidas] = useState(false);
  // a seção abre sozinha quando o dia selecionado já tem alguma medida lançada
  const medidasAbertas = showMedidas || Object.values(day.medidas || {}).some((v) => v !== "" && v != null);

  const addExercise = () => {
    if (!exerciseDraft.nome.trim()) return;
    setExerciseList([...exerciseList, { id: uid(), ...exerciseDraft }]);
    onClassifyExercise?.(exerciseDraft.nome.trim());
    setExerciseDraft({ nome: "", carga_kg: "", esquema: exerciseDraft.esquema });
  };
  const removeExercise = (id) => setExerciseList(exerciseList.filter((e) => e.id !== id));
  const saveStrengthSession = () => {
    if (exerciseList.length === 0) return;
    const session = { id: uid(), exercicios: exerciseList, duracao: n(sessionDraft.duracao), hr_avg: n(sessionDraft.hr_avg), hr_max: n(sessionDraft.hr_max), calorias: n(sessionDraft.calorias), rpe: n(sessionDraft.rpe) };
    updateDay({ strengthWorkouts: [...(day.strengthWorkouts || []), session] });
    setExerciseList([]);
    setSessionDraft({ duracao: "", hr_avg: "", hr_max: "", calorias: "", rpe: "7" });
  };
  const removeStrengthSession = (id) => updateDay({ strengthWorkouts: (day.strengthWorkouts || []).filter((s) => s.id !== id) });

  const saveCardioSession = () => {
    if (!cardioDraft.duracao) return;
    const session = { id: uid(), tipo: cardioDraft.tipo, duracao: n(cardioDraft.duracao), hr_avg: n(cardioDraft.hr_avg), hr_max: n(cardioDraft.hr_max), pace: cardioDraft.pace, calorias: n(cardioDraft.calorias), rpe: n(cardioDraft.rpe) };
    updateDay({ cardioWorkouts: [...(day.cardioWorkouts || []), session] });
    setCardioDraft({ tipo: cardioDraft.tipo, duracao: "", hr_avg: "", hr_max: "", pace: "", calorias: "", rpe: "6" });
  };
  const removeCardioSession = (id) => updateDay({ cardioWorkouts: (day.cardioWorkouts || []).filter((c) => c.id !== id) });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26, maxWidth: 680 }}>
      <datalist id="exercicios-comuns">{EXERCICIOS_COMUNS.map((e) => <option key={e} value={e} />)}</datalist>
      <datalist id="esquemas-comuns">{ESQUEMAS_COMUNS.map((e) => <option key={e} value={e} />)}</datalist>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <TextInput type="date" value={selectedDate} max={todayISO()} onChange={(e) => setSelectedDate(e.target.value)} style={{ width: 170 }} />
        <span style={{ fontSize: 12.5, color: COLORS.textMid }}>Selecione o dia para registrar ou editar</span>
      </div>

      <section style={{ borderTop: `1px solid ${COLORS.line}`, paddingTop: 16 }}>
        <SectionTitle icon={LineChartIcon} title="Composição corporal" />
        <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
          <Field label="Peso (kg)"><TextInput type="number" step="0.1" placeholder="72.4" value={day.weight} onChange={(e) => updateDay({ weight: e.target.value })} style={{ width: 130 }} /></Field>
          <Field label="Percentual de massa magra (%)" hint="deixe em branco se não souber">
            <TextInput type="number" step="0.1" placeholder="78.5" value={day.leanMassPct} onChange={(e) => updateDay({ leanMassPct: e.target.value })} style={{ width: 130 }} />
          </Field>
          <Field label="Percentual de gordura (%)" hint="deixe em branco se não souber">
            <TextInput type="number" step="0.1" placeholder="21.5" value={day.bodyFatPct} onChange={(e) => updateDay({ bodyFatPct: e.target.value })} style={{ width: 130 }} />
          </Field>
        </div>
        <div style={{ fontSize: 11.5, color: COLORS.textFaint, marginTop: 8 }}>Nenhum campo aqui é obrigatório — registre só o que fizer sentido para o dia.</div>

        <div style={{ marginTop: 14 }}>
          {medidasAbertas ? (
            <div>
              <div style={{ fontSize: 13, color: COLORS.textMid, marginBottom: 10 }}>
                Medidas corporais (cm) <span style={{ color: COLORS.textFaint }}>— opcional, lance quando medir</span>
              </div>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                {MEDIDAS.map((m) => (
                  <Field key={m.key} label={m.label}>
                    <TextInput type="number" step="0.5" value={(day.medidas || {})[m.key] ?? ""}
                      onChange={(e) => updateDay({ medidas: { ...(day.medidas || {}), [m.key]: e.target.value } })}
                      style={{ width: 90 }} />
                  </Field>
                ))}
              </div>
            </div>
          ) : (
            <GhostButton onClick={() => setShowMedidas(true)}><Ruler size={14} />Registrar medidas corporais</GhostButton>
          )}
        </div>

        <div style={{ marginTop: 16 }}>
          <MacroCard result={macroResult} weightDate={weightDate} onGoToAssessment={onGoToAssessment} />
        </div>
      </section>

      {/* Força */}
      <section style={{ borderTop: `1px solid ${COLORS.line}`, paddingTop: 16 }}>
        <SectionTitle icon={Dumbbell} title="Treino de força" />
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
          {(day.strengthWorkouts || []).map((s) => (
            <div key={s.id} style={{ background: COLORS.surface, border: `1px solid ${COLORS.line}`, borderRadius: 4, padding: "10px 12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ fontSize: 11.5, color: COLORS.textMid }}>
                  {s.duracao ? `${s.duracao} min` : ""}{s.hr_avg ? ` · FC média ${s.hr_avg} bpm` : ""}{s.hr_max ? ` · FC máx ${s.hr_max} bpm` : ""}{s.calorias ? ` · ${s.calorias} kcal` : ""}{s.rpe ? ` · RPE ${s.rpe}/10` : ""}
                </div>
                <IconButton onClick={() => removeStrengthSession(s.id)} danger title="Remover sessão"><Trash2 size={14} /></IconButton>
              </div>
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                {s.exercicios.map((ex) => (
                  <div key={ex.id} style={{ fontSize: 13, display: "flex", gap: 8 }}>
                    <span style={{ color: COLORS.textHi }}>{ex.nome}</span>
                    <span style={{ color: COLORS.textMid }}>{ex.carga_kg ? `${ex.carga_kg} kg` : ""}{ex.esquema ? ` · ${ex.esquema}` : ""}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div style={{ background: COLORS.bg, border: `1px dashed ${COLORS.lineStrong}`, borderRadius: 4, padding: 12 }}>
            <div style={{ fontSize: 12.5, color: COLORS.textMid, marginBottom: 8 }}>Adicionar exercícios à sessão</div>
            {exerciseList.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                {exerciseList.map((ex) => (
                  <div key={ex.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <span style={{ flex: 1 }}>{ex.nome} — {ex.carga_kg ? `${ex.carga_kg} kg` : "peso corporal"}{ex.esquema ? ` · ${ex.esquema}` : ""}</span>
                    <IconButton onClick={() => removeExercise(ex.id)} danger title="Remover"><Trash2 size={13} /></IconButton>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <Field label="Exercício" hint="digite livremente — o sistema identifica o grupo muscular sozinho">
                <TextInput list="exercicios-comuns" placeholder="Nome do aparelho ou exercício…" value={exerciseDraft.nome} onChange={(e) => setExerciseDraft({ ...exerciseDraft, nome: e.target.value })} style={{ width: 190 }} />
              </Field>
              <Field label="Carga (kg)"><TextInput type="number" step="0.5" placeholder="30" value={exerciseDraft.carga_kg} onChange={(e) => setExerciseDraft({ ...exerciseDraft, carga_kg: e.target.value })} style={{ width: 90 }} /></Field>
              <Field label="Esquema de séries">
                <TextInput list="esquemas-comuns" placeholder="3x10-12" value={exerciseDraft.esquema} onChange={(e) => setExerciseDraft({ ...exerciseDraft, esquema: e.target.value })} style={{ width: 190 }} />
              </Field>
              <GhostButton onClick={addExercise}><Plus size={14} /> Add. exercício</GhostButton>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 12, borderTop: `1px solid ${COLORS.line}`, paddingTop: 12 }}>
              <Field label="Duração (min)"><TextInput type="number" placeholder="50" value={sessionDraft.duracao} onChange={(e) => setSessionDraft({ ...sessionDraft, duracao: e.target.value })} style={{ width: 90 }} /></Field>
              <Field label="FC média (bpm)" hint="do relógio"><TextInput type="number" placeholder="120" value={sessionDraft.hr_avg} onChange={(e) => setSessionDraft({ ...sessionDraft, hr_avg: e.target.value })} style={{ width: 100 }} /></Field>
              <Field label="FC máxima (bpm)"><TextInput type="number" placeholder="150" value={sessionDraft.hr_max} onChange={(e) => setSessionDraft({ ...sessionDraft, hr_max: e.target.value })} style={{ width: 100 }} /></Field>
              <Field label="Calorias" hint="do relógio"><TextInput type="number" placeholder="350" value={sessionDraft.calorias} onChange={(e) => setSessionDraft({ ...sessionDraft, calorias: e.target.value })} style={{ width: 90 }} /></Field>
              <Field label="RPE (1-10)">
                <Select value={sessionDraft.rpe} onChange={(e) => setSessionDraft({ ...sessionDraft, rpe: e.target.value })} style={{ width: 80 }}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => <option key={v} value={v}>{v}</option>)}
                </Select>
              </Field>
              <PrimaryButton onClick={saveStrengthSession} disabled={exerciseList.length === 0}><Plus size={15} /> Salvar sessão</PrimaryButton>
            </div>
          </div>
        </div>
      </section>

      {/* Cardio */}
      <section style={{ borderTop: `1px solid ${COLORS.line}`, paddingTop: 16 }}>
        <SectionTitle icon={HeartPulse} title="Treino cardiovascular" />
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          {(day.cardioWorkouts || []).map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, background: COLORS.surface, border: `1px solid ${COLORS.line}`, borderRadius: 4, padding: "8px 10px" }}>
              <HeartPulse size={15} color={COLORS.amber} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, textTransform: "capitalize" }}>{c.tipo}</div>
                <div style={{ fontSize: 11.5, color: COLORS.textMid }}>
                  {c.duracao} min{c.pace ? ` · pace ${c.pace}/km` : ""}{c.hr_avg ? ` · FC média ${c.hr_avg} bpm` : ""}{c.hr_max ? ` · FC máx ${c.hr_max} bpm` : ""}{c.calorias ? ` · ${c.calorias} kcal` : ""}{c.rpe ? ` · RPE ${c.rpe}/10` : ""}
                </div>
              </div>
              <IconButton onClick={() => removeCardioSession(c.id)} danger title="Remover"><Trash2 size={14} /></IconButton>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <Field label="Tipo">
              <Select value={cardioDraft.tipo} onChange={(e) => setCardioDraft({ ...cardioDraft, tipo: e.target.value })} style={{ width: 120 }}>
                <option value="corrida">Corrida</option><option value="caminhada">Caminhada</option>
                <option value="spinning">Spinning</option><option value="bicicleta">Bicicleta</option>
                <option value="eliptico">Elíptico</option><option value="outro">Outro</option>
              </Select>
            </Field>
            <Field label="Duração (min)"><TextInput type="number" placeholder="30" value={cardioDraft.duracao} onChange={(e) => setCardioDraft({ ...cardioDraft, duracao: e.target.value })} style={{ width: 90 }} /></Field>
            <Field label="Pace médio" hint="min/km"><TextInput placeholder="5:30" value={cardioDraft.pace} onChange={(e) => setCardioDraft({ ...cardioDraft, pace: e.target.value })} style={{ width: 90 }} /></Field>
            <Field label="FC média (bpm)"><TextInput type="number" placeholder="145" value={cardioDraft.hr_avg} onChange={(e) => setCardioDraft({ ...cardioDraft, hr_avg: e.target.value })} style={{ width: 100 }} /></Field>
            <Field label="FC máxima (bpm)"><TextInput type="number" placeholder="170" value={cardioDraft.hr_max} onChange={(e) => setCardioDraft({ ...cardioDraft, hr_max: e.target.value })} style={{ width: 100 }} /></Field>
            <Field label="Calorias"><TextInput type="number" placeholder="280" value={cardioDraft.calorias} onChange={(e) => setCardioDraft({ ...cardioDraft, calorias: e.target.value })} style={{ width: 90 }} /></Field>
            <Field label="RPE (1-10)">
              <Select value={cardioDraft.rpe} onChange={(e) => setCardioDraft({ ...cardioDraft, rpe: e.target.value })} style={{ width: 80 }}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => <option key={v} value={v}>{v}</option>)}
              </Select>
            </Field>
            <PrimaryButton onClick={saveCardioSession} disabled={!cardioDraft.duracao}><Plus size={15} /> Salvar</PrimaryButton>
          </div>
        </div>
      </section>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Avaliação
// ---------------------------------------------------------------------------
function QuestionGroup({ title, hint, children, defaultOpen }) {
  return (
    <details open={defaultOpen} style={{ border: `1px solid ${COLORS.line}`, borderRadius: 4, background: COLORS.surface }}>
      <summary style={{ cursor: "pointer", padding: "11px 14px", fontSize: 13.5, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", listStyle: "none" }}>
        {title} <span style={{ fontWeight: 400, color: COLORS.textFaint, fontSize: 12 }}>— {hint}</span>
      </summary>
      <div style={{ padding: "4px 14px 14px", display: "flex", flexDirection: "column", gap: 14 }}>{children}</div>
    </details>
  );
}

function OptionSelect({ value, onChange, options, width = 280, emptyLabel = "Não informar" }) {
  return (
    <Select value={value} onChange={onChange} style={{ width, maxWidth: "100%" }}>
      {!options.some((o) => o.id === "") && <option value="">{emptyLabel}</option>}
      {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </Select>
  );
}

const PROFILE_KEYS = [
  "sexo", "idade", "alturaCm", "atividadeDiaria", "experiencia", "local", "tempoSessaoMin", "divisao",
  "tecnicas", "cicloSemanas", "cardioPref", "pesoAlvo", "lesoes",
];

function AvaliacaoTab({ latestAssessment, assessments, latestWeight, latestMedidas, latestBodyFat, onSave, planLoading, planError }) {
  // Os valores vêm pré-preenchidos com o último lançamento do registro diário (editáveis).
  // Meta, frequência e o questionário partem da última avaliação, se houver. Nada é obrigatório.
  const prev = latestAssessment || {};
  const [draft, setDraft] = useState({
    weight: latestWeight?.peso ?? "", leanMassPct: latestWeight?.massaMagra ?? "", bodyFatPct: latestBodyFat ?? "",
    biceps: latestMedidas?.biceps ?? "", peito: latestMedidas?.peito ?? "", cintura: latestMedidas?.cintura ?? "",
    quadril: latestMedidas?.quadril ?? "", coxa: latestMedidas?.coxa ?? "", panturrilha: latestMedidas?.panturrilha ?? "",
    meta: prev.meta ?? "hipertrofia", metaObs: prev.metaObs ?? "",
    frequenciaSemanal: prev.frequenciaSemanal ?? "4",
    prioridades: prev.prioridades ?? [],
    ...Object.fromEntries(PROFILE_KEYS.map((k) => [k, prev[k] ?? ""])),
  });

  const set = (k) => (e) => setDraft({ ...draft, [k]: e.target.value });
  const togglePrioridade = (id) => setDraft({
    ...draft,
    prioridades: draft.prioridades.includes(id) ? draft.prioridades.filter((x) => x !== id) : [...draft.prioridades, id],
  });
  const filled = PROFILE_KEYS.filter((k) => draft[k] !== "" && draft[k] != null).length + (draft.prioridades.length ? 1 : 0) + (draft.metaObs.trim() ? 1 : 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 620 }}>
      <div>
        <SectionTitle icon={Ruler} title="Avaliação física e meta" />
        <div style={{ fontSize: 12.5, color: COLORS.textMid, marginTop: 4, lineHeight: 1.55 }}>
          Use ao mudar de meta ou de fase. A cada envio, a ficha de treino é refeita. Para acompanhar peso e medidas no dia a dia sem gerar plano, lance-os na aba Registro. Os campos abaixo vêm preenchidos com o seu último lançamento; só o que você alterar vira um novo ponto nos gráficos. <b style={{ color: COLORS.textHi }}>Nenhum campo é obrigatório</b>: quanto mais você informar, mais a ficha se parece com a de um professor que conhece você.
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <Field label="Peso (kg)"><TextInput type="number" step="0.1" value={draft.weight} onChange={set("weight")} style={{ width: 120 }} /></Field>
        <Field label="Massa magra (%)"><TextInput type="number" step="0.1" value={draft.leanMassPct} onChange={set("leanMassPct")} style={{ width: 120 }} /></Field>
        <Field label="Gordura corporal (%)"><TextInput type="number" step="0.1" value={draft.bodyFatPct} onChange={set("bodyFatPct")} style={{ width: 120 }} /></Field>
      </div>

      <div>
        <div style={{ fontSize: 13, color: COLORS.textMid, marginBottom: 10 }}>Medidas corporais (cm)</div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {MEDIDAS.map((m) => (
            <Field key={m.key} label={m.label}><TextInput type="number" step="0.5" value={draft[m.key]} onChange={set(m.key)} style={{ width: 90 }} /></Field>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <Field label="Meta atual">
            <Select value={draft.meta} onChange={set("meta")} style={{ width: 240 }}>
              {Object.entries(GOALS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Dias de treino disponíveis por semana">
            <Select value={draft.frequenciaSemanal} onChange={set("frequenciaSemanal")} style={{ width: 100 }}>
              {[2, 3, 4, 5, 6, 7].map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </Field>
        </div>
        <div style={{ borderLeft: `3px solid ${COLORS.teal}`, background: COLORS.surface, borderRadius: 4, padding: "9px 12px", fontSize: 12.5, color: COLORS.textMid, lineHeight: 1.6 }}>
          <b style={{ color: COLORS.textHi }}>{GOALS[draft.meta]}:</b> {GOAL_INFO[draft.meta]}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 12.5, color: COLORS.textMid }}>
          Questionário opcional {filled > 0 ? <span style={{ color: COLORS.teal }}>({filled} resposta{filled > 1 ? "s" : ""})</span> : null} — o que ficar em branco, o plano decide por você.
        </div>

        <QuestionGroup title="Sobre você" hint="usado também para calcular suas calorias e macros" defaultOpen={!!(draft.sexo || draft.idade || draft.alturaCm)}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <Field label="Sexo"><OptionSelect value={draft.sexo} onChange={set("sexo")} options={SEXO_OPCOES} width={150} /></Field>
            <Field label="Idade"><TextInput type="number" min="18" placeholder="35" value={draft.idade} onChange={set("idade")} style={{ width: 90 }} /></Field>
            <Field label="Altura (cm)"><TextInput type="number" placeholder="175" value={draft.alturaCm} onChange={set("alturaCm")} style={{ width: 100 }} /></Field>
            <Field label="Peso desejado (kg)"><TextInput type="number" step="0.5" value={draft.pesoAlvo} onChange={set("pesoAlvo")} style={{ width: 120 }} /></Field>
          </div>
          <Field label="Como é o seu dia a dia fora do treino?"><OptionSelect value={draft.atividadeDiaria} onChange={set("atividadeDiaria")} options={ATIVIDADE_DIARIA_OPCOES} width={400} /></Field>
        </QuestionGroup>

        <QuestionGroup title="Seu treino" hint="experiência, local e preferências" defaultOpen={!!(draft.experiencia || draft.local || draft.divisao)}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <Field label="Experiência com musculação"><OptionSelect value={draft.experiencia} onChange={set("experiencia")} options={EXPERIENCIA_OPCOES} width={290} /></Field>
            <Field label="Onde você treina"><OptionSelect value={draft.local} onChange={set("local")} options={LOCAL_OPCOES} width={290} /></Field>
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <Field label="Tempo por sessão (min)">
              <Select value={draft.tempoSessaoMin} onChange={set("tempoSessaoMin")} style={{ width: 130 }}>
                <option value="">Não informar</option>
                {TEMPO_SESSAO_OPCOES.map((v) => <option key={v} value={v}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Divisão do treino"><OptionSelect value={draft.divisao} onChange={set("divisao")} options={DIVISAO_OPCOES} width={290} /></Field>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, color: COLORS.textMid }}>Grupos musculares que quer priorizar <span style={{ color: COLORS.textFaint, fontSize: 11.5 }}>(opcional — toque para marcar)</span></span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {PRIORIDADES_OPCOES.map((o) => {
                const on = draft.prioridades.includes(o.id);
                return (
                  <button key={o.id} type="button" onClick={() => togglePrioridade(o.id)} style={{
                    background: on ? COLORS.tealSoft : "transparent", color: on ? COLORS.teal : COLORS.textMid,
                    border: `1px solid ${on ? COLORS.teal : COLORS.line}`, borderRadius: 14, padding: "5px 12px", fontSize: 12.5, cursor: "pointer",
                  }}>{o.label}</button>
                );
              })}
            </div>
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <Field label="Técnicas avançadas (drop set, bi-set…)"><OptionSelect value={draft.tecnicas} onChange={set("tecnicas")} options={TECNICAS_OPCOES} width={290} /></Field>
            <Field label="Validade da ficha"><OptionSelect value={draft.cicloSemanas} onChange={set("cicloSemanas")} options={CICLO_OPCOES} width={220} /></Field>
          </div>
          <Field label="Cardio preferido"><OptionSelect value={draft.cardioPref} onChange={set("cardioPref")} options={CARDIO_OPCOES} width={290} /></Field>
        </QuestionGroup>

        <QuestionGroup title="Lesões e limitações" hint="para o plano evitar exercícios problemáticos" defaultOpen={!!draft.lesoes}>
          <Field label="Dores, lesões ou restrições médicas" hint="ex.: dor no ombro direito, hérnia de disco. Não substitui orientação médica.">
            <TextArea rows={2} value={draft.lesoes} onChange={set("lesoes")} />
          </Field>
        </QuestionGroup>
      </div>

      <Field label="Observações" hint="opcional — qualquer outra informação que ajude a montar a ficha">
        <TextArea rows={3} value={draft.metaObs} onChange={set("metaObs")} />
      </Field>

      {planError && (
        <div style={{ border: `1px solid #5C332E`, background: COLORS.redSoft, borderRadius: 4, padding: "10px 12px", fontSize: 13, color: "#E8A79A" }}>{planError}</div>
      )}

      <PrimaryButton onClick={() => onSave(draft)} disabled={planLoading}>
        {planLoading ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Target size={15} />}
        {planLoading ? "Montando a ficha…" : "Salvar avaliação e gerar ficha"}
      </PrimaryButton>
      {planLoading && <div style={{ fontSize: 12, color: COLORS.textMid, marginTop: -12 }}>A ficha completa leva de 1 a 3 minutos. Mantenha o app aberto; você pode usar as outras abas enquanto isso.</div>}

      {assessments.length > 0 && (
        <div style={{ borderTop: `1px solid ${COLORS.line}`, paddingTop: 16 }}>
          <div style={{ fontSize: 13, color: COLORS.textMid, marginBottom: 10 }}>Avaliações anteriores</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[...assessments].reverse().map((a) => (
              <div key={a.id} style={{ fontSize: 12.5, color: COLORS.textMid, display: "flex", gap: 12 }}>
                <span style={{ fontFamily: "'Space Grotesk', sans-serif", color: COLORS.textHi }}>{fmtDate(a.date)}</span>
                <span>{GOALS[a.meta]}</span>
                <span>{a.weight} kg</span>
                {a.leanMassPct && <span>{a.leanMassPct}% massa magra</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plano
// ---------------------------------------------------------------------------
function PlanExpiryBanner({ status, onPrimary, primaryLabel, loading }) {
  if (!status || (!status.expired && !status.soon)) return null;
  const expired = status.expired;
  const motivo = expired
    ? (status.bySessions && !status.byDate
      ? `Você cumpriu as ${status.previstas} sessões de força previstas para esta ficha.`
      : `A validade de ${status.semanas} semanas desta ficha terminou.`)
    : (status.daysLeft <= 7
      ? `Faltam ${Math.max(status.daysLeft, 0)} dia${status.daysLeft === 1 ? "" : "s"} para a validade da ficha.`
      : `Você já fez ${status.done} das ${status.previstas} sessões previstas.`);
  const color = expired ? COLORS.red : COLORS.amber;
  return (
    <div role="alert" style={{
      display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 18,
      border: `1px solid ${color}`, background: expired ? COLORS.redSoft : COLORS.amberSoft, borderRadius: 4, padding: "11px 14px",
    }}>
      <AlertTriangle size={18} color={color} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 220, fontSize: 13.5, lineHeight: 1.5 }}>
        <b style={{ color: COLORS.textHi }}>{expired ? "Seu treino venceu." : "Seu treino está perto de vencer."}</b>{" "}
        <span style={{ color: COLORS.textMid }}>{motivo} {expired ? "Hora de renovar a ficha para continuar evoluindo." : "Vá pensando na renovação."}</span>
      </div>
      <button onClick={onPrimary} disabled={loading} style={{
        background: expired ? COLORS.red : "transparent", color: expired ? "#fff" : COLORS.amber,
        border: expired ? "none" : `1px solid ${COLORS.amber}`, borderRadius: 4, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: loading ? "default" : "pointer",
      }}>{loading ? "Gerando…" : primaryLabel}</button>
    </div>
  );
}

function PlanoTab({ plan, loading, error, onRegenerate, hasAssessment, onGoToAssessment, status, macroResult, weightDate }) {
  const phases = plan?.fases || [];
  const currentIdx = status ? currentPhaseIndex(phases, status.semanaAtual) : 0;
  const [phaseSel, setPhaseSel] = useState(null);
  const phaseIdx = Math.min(phaseSel ?? currentIdx, Math.max(phases.length - 1, 0));

  if (!hasAssessment && !plan) {
    return (
      <div style={{ maxWidth: 620, display: "flex", flexDirection: "column", gap: 16 }}>
        <SectionTitle icon={Target} title="Plano atual" />
        <EmptyState text="Nenhuma avaliação física registrada ainda." />
        <div><GhostButton onClick={onGoToAssessment}>Preencher avaliação física</GhostButton></div>
        <MacroCard result={macroResult} weightDate={weightDate} onGoToAssessment={onGoToAssessment} />
      </div>
    );
  }

  const legacy = plan && !plan.sessoes;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 680 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <SectionTitle icon={Target} title="Plano atual" />
        <PrimaryButton onClick={onRegenerate} disabled={loading}>
          {loading ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <RefreshCw size={15} />}
          {loading ? "Montando a ficha…" : "Gerar nova ficha"}
        </PrimaryButton>
      </div>
      {loading && <div style={{ fontSize: 12, color: COLORS.textMid, marginTop: -12 }}>A ficha completa leva de 1 a 3 minutos. Mantenha o app aberto.</div>}

      {error && <div style={{ border: `1px solid #5C332E`, background: COLORS.redSoft, borderRadius: 4, padding: "10px 12px", fontSize: 13, color: "#E8A79A" }}>{error}</div>}

      {!plan && !loading && !error && <EmptyState text="Gere a ficha a partir da avaliação física preenchida." />}

      <MacroCard result={macroResult} weightDate={weightDate} onGoToAssessment={onGoToAssessment} />

      {legacy && (
        <div style={{ border: `1px solid ${COLORS.amber}`, background: COLORS.amberSoft, borderRadius: 4, padding: "11px 14px", fontSize: 13.5, lineHeight: 1.5 }}>
          Este plano foi criado no formato antigo (sem divisão A/B/C, descanso, técnicas e validade). Clique em <b>Gerar nova ficha</b> para receber a versão completa.
        </div>
      )}

      {plan && !legacy && (
        <>
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.line}`, borderRadius: 4, padding: 14, fontSize: 13.5, lineHeight: 1.6 }}>{plan.resumoMeta}</div>

          <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "flex-start" }}>
            <StatReadout label="Divisão" value={plan.divisao} />
            {status && <StatReadout label="Validade" value={`${status.semanas}`} unit="semanas" sub={`até ${new Date(status.expiresAt).toLocaleDateString("pt-BR")}`} />}
            {status && <StatReadout label="Sessões de força" value={`${status.done}/${status.previstas}`} sub={status.expired ? "ficha vencida" : `semana ${status.semanaAtual} de ${status.semanas}`} />}
          </div>
          {plan.validade?.motivo && <div style={{ fontSize: 12, color: COLORS.textMid, marginTop: -12 }}>{plan.validade.motivo}</div>}

          {phases.length > 0 && (
            <div>
              <SectionTitle icon={LineChartIcon} title="Fases da ficha" />
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                {phases.map((f, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, background: COLORS.surface, border: `1px solid ${i === currentIdx && status && !status.expired ? COLORS.teal : COLORS.line}`, borderRadius: 4, padding: "10px 12px" }}>
                    <div style={{ width: 3, background: i === currentIdx ? COLORS.teal : COLORS.lineStrong, borderRadius: 2, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif" }}>
                        Fase {i + 1} · {f.nome} <span style={{ color: COLORS.textMid, fontWeight: 400 }}>(semanas {f.semanas})</span>
                        {i === currentIdx && status && !status.expired ? <span style={{ color: COLORS.teal, fontSize: 11.5, marginLeft: 8 }}>você está aqui</span> : null}
                      </div>
                      <div style={{ fontSize: 12.5, color: COLORS.textMid, marginTop: 2, lineHeight: 1.5 }}>{f.foco}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(plan.semanaTipo || []).length > 0 && (
            <div>
              <SectionTitle icon={CalendarDays} title="Semana tipo" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 6, marginTop: 10 }}>
                {plan.semanaTipo.map((d, i) => (
                  <div key={i} style={{ border: `1px solid ${COLORS.line}`, borderRadius: 4, padding: "7px 10px", background: COLORS.surface }}>
                    <div style={{ fontSize: 11.5, color: COLORS.textFaint }}>{d.dia}</div>
                    <div style={{ fontSize: 12.5, color: /descanso/i.test(d.atividade) ? COLORS.textMid : COLORS.textHi, lineHeight: 1.4 }}>{d.atividade}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <SectionTitle icon={Dumbbell} title="Treinos" />
              {phases.length > 1 && (
                <Segmented value={phaseIdx} onChange={setPhaseSel} options={phases.map((f, i) => ({ id: i, label: `Fase ${i + 1}` }))} />
              )}
            </div>
            {phases.length > 1 && <div style={{ fontSize: 12, color: COLORS.textMid, marginTop: 6 }}>Repetições da fase {phaseIdx + 1}: {phases[phaseIdx]?.nome}. Troque a fase acima para ver como elas mudam.</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
              {plan.sessoes.map((s, i) => (
                <div key={i} style={{ background: COLORS.surface, border: `1px solid ${COLORS.line}`, borderRadius: 4, padding: "12px 14px" }}>
                  <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", color: COLORS.teal }}>
                    Treino {s.id} — {s.foco}
                  </div>
                  <div style={{ fontSize: 11.5, color: COLORS.textFaint, marginTop: 2 }}>
                    {s.duracao_min ? `~${s.duracao_min} min` : ""}{s.aquecimento ? `${s.duracao_min ? " · " : ""}Aquecimento: ${s.aquecimento}` : ""}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
                    {s.exercicios.map((ex, j) => (
                      <div key={j} style={{ padding: "8px 0", borderTop: j ? `1px solid ${COLORS.line}` : "none" }}>
                        <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
                          <span style={{ fontSize: 13.5, color: COLORS.textHi }}>{j + 1}. {ex.nome}</span>
                          <span style={{ fontSize: 13, fontFamily: "'Space Grotesk', sans-serif", color: COLORS.textHi }}>
                            {ex.series} × {ex.reps[Math.min(phaseIdx, ex.reps.length - 1)]}
                            {ex.descanso_s ? <span style={{ color: COLORS.textMid, fontWeight: 400 }}> · descanso {ex.descanso_s}s</span> : null}
                          </span>
                        </div>
                        {ex.tecnica && (
                          <div style={{ fontSize: 12, color: COLORS.amber, marginTop: 3, lineHeight: 1.45 }}>Técnica: {ex.tecnica}</div>
                        )}
                        {(ex.carga_sugerida || ex.obs) && (
                          <div style={{ fontSize: 12, color: COLORS.textMid, marginTop: 3, lineHeight: 1.45 }}>{[ex.carga_sugerida, ex.obs].filter(Boolean).join(" · ")}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {plan.cardio?.itens?.length > 0 && (
            <div>
              <SectionTitle icon={HeartPulse} title="Cardio" />
              <div style={{ fontSize: 13, color: COLORS.textMid, marginTop: 6, marginBottom: 10 }}>{plan.cardio.resumo}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {plan.cardio.itens.map((c, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, background: COLORS.surface, border: `1px solid ${COLORS.line}`, borderRadius: 4, padding: "10px 12px" }}>
                    <div style={{ width: 3, background: COLORS.amber, borderRadius: 2, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif" }}>{c.tipo}</div>
                      <div style={{ fontSize: 12.5, color: COLORS.textMid, marginTop: 2, lineHeight: 1.5 }}>{[c.frequencia, c.duracao, c.intensidade].filter(Boolean).join(" · ")}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <PlanBlock icon={LineChartIcon} title="Progressão de carga" data={plan.progressao} itemKeyA="exercicio" itemKeyB="sugestao" />

          {plan.suposicoes?.length > 0 && (
            <div>
              <SectionTitle icon={Ruler} title="O que o plano assumiu" />
              <ul style={{ marginTop: 10, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
                {plan.suposicoes.map((t, i) => <li key={i} style={{ fontSize: 12.5, color: COLORS.textMid, lineHeight: 1.5 }}>{t}</li>)}
              </ul>
              <div style={{ fontSize: 11.5, color: COLORS.textFaint, marginTop: 6 }}>Preencha o questionário na Avaliação para trocar suposições por dados reais.</div>
            </div>
          )}

          {plan.insights?.length > 0 && (
            <div>
              <SectionTitle icon={Sparkles} title="Observações" />
              <ul style={{ marginTop: 10, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
                {plan.insights.map((ins, i) => <li key={i} style={{ fontSize: 13, color: COLORS.textMid, lineHeight: 1.5 }}>{ins}</li>)}
              </ul>
            </div>
          )}
          <div style={{ fontSize: 11, color: COLORS.textFaint }}>Gerado em {new Date(plan.generatedAt).toLocaleString("pt-BR")}</div>
        </>
      )}
    </div>
  );
}

function PlanBlock({ icon, title, data, itemKeyA = "foco", itemKeyB = "detalhe" }) {
  if (!data) return null;
  return (
    <div>
      <SectionTitle icon={icon} title={title} />
      <div style={{ fontSize: 13, color: COLORS.textMid, marginTop: 6, marginBottom: 10 }}>{data.resumo}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {(data.itens || []).map((item, i) => (
          <div key={i} style={{ display: "flex", gap: 10, background: COLORS.surface, border: `1px solid ${COLORS.line}`, borderRadius: 4, padding: "10px 12px" }}>
            <div style={{ width: 3, background: COLORS.teal, borderRadius: 2, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif" }}>{item[itemKeyA]}</div>
              <div style={{ fontSize: 12.5, color: COLORS.textMid, marginTop: 2, lineHeight: 1.5 }}>{item[itemKeyB]}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------
const PERIODS = [
  { id: 30, label: "30 dias" },
  { id: 90, label: "90 dias" },
  { id: 365, label: "1 ano" },
  { id: "all", label: "Tudo" },
];

const TOOLTIP = {
  contentStyle: { background: COLORS.surfaceRaised, border: `1px solid ${COLORS.line}`, borderRadius: 4, fontSize: 12.5 },
  labelStyle: { color: COLORS.textHi },
};

const GROUP_META = {
  peito: { label: "Peito", color: "#3FA796" },
  costas: { label: "Costas", color: "#E3A857" },
  ombro: { label: "Ombro", color: "#7FB3D5" },
  biceps: { label: "Bíceps", color: "#C58BD6" },
  triceps: { label: "Tríceps", color: "#D9695B" },
  perna: { label: "Perna", color: "#8FCB6B" },
  gluteos: { label: "Glúteos", color: "#E58FB0" },
  panturrilha: { label: "Panturrilha", color: "#B9A27A" },
  core: { label: "Core", color: "#5AA5E3" },
  corpo_inteiro: { label: "Corpo inteiro", color: "#A0A7AD" },
  outro: { label: "Outro", color: "#6F7F7E" },
  sem_classificacao: { label: "Sem classificação", color: "#4A5557" },
};

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const DIAS_SEMANA = ["S", "T", "Q", "Q", "S", "S", "D"];

const fmtNum = (x, digits = 1) => (x == null ? "–" : Number(x).toLocaleString("pt-BR", { maximumFractionDigits: digits }));
const signed = (x, unit) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${fmtNum(Math.abs(x))}${unit ? ` ${unit}` : ""}`;
// Eixo Y com marcações em passos regulares (ex.: 76, 78, 80, 82), calculado a partir dos dados.
function niceAxis(data, keys) {
  const vals = data.flatMap((d) => keys.map((k) => d[k])).filter((v) => v != null && Number.isFinite(v));
  if (vals.length === 0) return { domain: ["auto", "auto"], ticks: undefined };
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const range = max - min;
  const step = range <= 4 ? 0.5 : range <= 8 ? 1 : range <= 16 ? 2 : range <= 40 ? 5 : 10;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let t = lo; t <= hi + 1e-9; t += step) ticks.push(Math.round(t * 100) / 100);
  return { domain: [lo, hi], ticks };
}

function Segmented({ options, value, onChange }) {
  return (
    <div style={{ display: "inline-flex", border: `1px solid ${COLORS.line}`, borderRadius: 4, overflow: "hidden", flexShrink: 0 }}>
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button key={String(o.id)} onClick={() => onChange(o.id)} style={{
            background: active ? COLORS.tealSoft : "transparent", color: active ? COLORS.teal : COLORS.textMid,
            border: "none", padding: "6px 11px", fontSize: 12.5, cursor: "pointer",
            fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: active ? 600 : 400,
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

function PanelSection({ icon, title, right, note, children }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <SectionTitle icon={icon} title={title} />
        {right}
      </div>
      {note && <div style={{ fontSize: 12, color: COLORS.textMid, marginTop: 6, lineHeight: 1.5 }}>{note}</div>}
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>
  );
}

function PainelTab({ logs, sortedDates, bodySeries, measureSeries, exerciseCatalog, latestAssessment }) {
  const today = todayISO();
  const [period, setPeriod] = useState(90);
  const [compMode, setCompMode] = useState("pct");
  const [medidaSel, setMedidaSel] = useState("cintura");
  const [exSel, setExSel] = useState("");

  const start = periodStart(today, period);
  const weeks = period === "all" ? 26 : Math.min(26, Math.max(4, Math.ceil(period / 7)));

  // ---- composição corporal (a média móvel é calculada antes de recortar o período)
  const bodyAll = useMemo(() => withMovingAverage(bodySeries, "peso", 7), [bodySeries]);
  const body = useMemo(() => filterFrom(bodyAll, start), [bodyAll, start]);
  const pesoDelta = firstLastDelta(body, "peso");
  const pesoMedia = [...body].reverse().find((p) => p.pesoMedia != null)?.pesoMedia ?? null;
  const gorduraDelta = firstLastDelta(body, "gordura");
  const magraDelta = firstLastDelta(body, "massaMagra");
  const hasComp = body.some((p) => p.gordura != null || p.massaMagra != null);

  // ---- medidas
  const medidaData = useMemo(() => filterFrom(measureSeries[medidaSel] || [], start), [measureSeries, medidaSel, start]);
  const medidaDelta = firstLastDelta(medidaData, "valor");
  const hasAnyMeasure = MEDIDAS.some((m) => (measureSeries[m.key] || []).length > 0);

  // ---- carga por exercício
  const loadAll = useMemo(() => buildLoadSeries(logs, sortedDates), [logs, sortedDates]);
  const loadList = useMemo(
    () => loadAll.map((e) => ({ ...e, pontos: filterFrom(e.pontos, start) })).filter((e) => e.pontos.length > 0),
    [loadAll, start]
  );
  const exKey = loadList.some((e) => e.key === exSel) ? exSel : loadList[0]?.key;
  const exCurrent = loadList.find((e) => e.key === exKey);
  const loadDelta = exCurrent ? firstLastDelta(exCurrent.pontos, "carga") : null;

  // ---- volume por grupo muscular e minutos de treino
  const volume = useMemo(
    () => buildMuscleVolume(logs, sortedDates, exerciseCatalog, today, weeks),
    [logs, sortedDates, exerciseCatalog, today, weeks]
  );
  const minutes = useMemo(() => buildWeeklyMinutes(logs, sortedDates, today, weeks), [logs, sortedDates, today, weeks]);
  const hasMinutes = minutes.some((r) => r.forca > 0 || r.cardio > 0);

  // ---- constância
  const metaDias = latestAssessment?.frequenciaSemanal ? Number(latestAssessment.frequenciaSemanal) : null;
  const consistency = useMemo(() => buildConsistency(logs, today, 17, metaDias), [logs, today, metaDias]);

  if (bodySeries.length === 0 && sortedDates.length === 0) {
    return <EmptyState text="Registre peso, treinos e alimentação para ver seu progresso aqui." />;
  }

  const axisPeso = niceAxis(body, ["peso", "pesoMedia"]);
  const axisGordura = niceAxis(body, [compMode === "pct" ? "gordura" : "gorduraKg"]);
  const axisMagra = niceAxis(body, [compMode === "pct" ? "massaMagra" : "massaMagraKg"]);
  const axisMedida = niceAxis(medidaData, ["valor"]);
  const axisCarga = niceAxis(exCurrent ? exCurrent.pontos : [], ["carga"]);

  const monthLabels = consistency.columns.map((col, i) => {
    const m = Number(col.start.slice(5, 7)) - 1;
    const prev = i > 0 ? Number(consistency.columns[i - 1].start.slice(5, 7)) - 1 : -1;
    return m !== prev ? MESES[m] : "";
  });

  const levelBg = (level) => {
    if (level === "forca") return COLORS.teal;
    if (level === "cardio") return COLORS.amber;
    if (level === "ambos") return `linear-gradient(135deg, ${COLORS.teal} 50%, ${COLORS.amber} 50%)`;
    if (level === "futuro") return "transparent";
    return COLORS.surface;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32, maxWidth: 760 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: COLORS.textMid }}>Período</span>
        <Segmented options={PERIODS} value={period} onChange={setPeriod} />
      </div>

      {/* 1. Composição corporal */}
      {body.length > 0 ? (
        <PanelSection
          icon={LineChartIcon} title="Peso"
          note={pesoDelta && (
            <>
              {fmtNum(pesoDelta.last)} kg agora ({signed(pesoDelta.delta, "kg")} no período)
              {pesoMedia != null && <> · média dos últimos 7 dias: {fmtNum(pesoMedia, 2)} kg</>}.
              {" "}A linha forte é a média de 7 dias, que mostra a tendência sem o ruído da balança.
            </>
          )}
        >
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={body}>
                <CartesianGrid stroke={COLORS.line} strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke={COLORS.textFaint} fontSize={11.5} tickLine={false} minTickGap={28} />
                <YAxis stroke={COLORS.textFaint} fontSize={11.5} tickLine={false} width={38} domain={axisPeso.domain} ticks={axisPeso.ticks} />
                <Tooltip {...TOOLTIP} />
                <Legend wrapperStyle={{ fontSize: 12.5 }} />
                <Line type="monotone" dataKey="peso" name="Peso do dia (kg)" stroke={COLORS.textFaint} strokeWidth={1} dot={{ r: 2, fill: COLORS.textFaint }} connectNulls />
                <Line type="monotone" dataKey="pesoMedia" name="Média de 7 dias (kg)" stroke={COLORS.teal} strokeWidth={2.5} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </PanelSection>
      ) : (
        <PanelSection icon={LineChartIcon} title="Peso">
          <EmptyState text="Nenhum registro de peso neste período." />
        </PanelSection>
      )}

      {hasComp && (
        <PanelSection
          icon={LineChartIcon} title="Gordura e massa magra"
          right={<Segmented options={[{ id: "pct", label: "Em %" }, { id: "kg", label: "Em kg" }]} value={compMode} onChange={setCompMode} />}
          note={
            <>
              {gorduraDelta && <>Gordura: {fmtNum(gorduraDelta.last)}% ({signed(gorduraDelta.delta, "p.p.")}). </>}
              {magraDelta && <>Massa magra: {fmtNum(magraDelta.last)}% ({signed(magraDelta.delta, "p.p.")}). </>}
              {compMode === "kg" && "Em kg, só aparecem os dias em que peso e percentual foram lançados juntos. "}
              Cada linha tem o seu próprio eixo (esquerda: gordura, direita: massa magra).
            </>
          }
        >
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={body}>
                <CartesianGrid stroke={COLORS.line} strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke={COLORS.textFaint} fontSize={11.5} tickLine={false} minTickGap={28} />
                <YAxis yAxisId="g" stroke={COLORS.amber} tick={{ fill: COLORS.amber, fontSize: 11.5 }} tickLine={false} width={38} domain={axisGordura.domain} ticks={axisGordura.ticks} />
                <YAxis yAxisId="m" orientation="right" stroke={COLORS.teal} tick={{ fill: COLORS.teal, fontSize: 11.5 }} tickLine={false} width={38} domain={axisMagra.domain} ticks={axisMagra.ticks} />
                <Tooltip {...TOOLTIP} />
                <Legend wrapperStyle={{ fontSize: 12.5 }} />
                <Line yAxisId="g" type="monotone" dataKey={compMode === "pct" ? "gordura" : "gorduraKg"} name={compMode === "pct" ? "Gordura (%)" : "Gordura (kg)"} stroke={COLORS.amber} strokeWidth={2} dot={{ r: 2.5 }} connectNulls />
                <Line yAxisId="m" type="monotone" dataKey={compMode === "pct" ? "massaMagra" : "massaMagraKg"} name={compMode === "pct" ? "Massa magra (%)" : "Massa magra (kg)"} stroke={COLORS.teal} strokeWidth={2} dot={{ r: 2.5 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </PanelSection>
      )}

      {/* 2. Medidas */}
      <PanelSection
        icon={Ruler} title="Medidas corporais"
        right={
          <Select value={medidaSel} onChange={(e) => setMedidaSel(e.target.value)} style={{ width: 150 }}>
            {MEDIDAS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </Select>
        }
        note={medidaDelta && medidaDelta.count > 1
          ? <>{MEDIDAS.find((m) => m.key === medidaSel).label}: {fmtNum(medidaDelta.first)} → {fmtNum(medidaDelta.last)} cm ({signed(medidaDelta.delta, "cm")} desde o primeiro registro do período).</>
          : null}
      >
        {medidaData.length > 0 ? (
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={medidaData}>
                <CartesianGrid stroke={COLORS.line} strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke={COLORS.textFaint} fontSize={11.5} tickLine={false} minTickGap={28} />
                <YAxis stroke={COLORS.textFaint} fontSize={11.5} tickLine={false} width={38} domain={axisMedida.domain} ticks={axisMedida.ticks} />
                <Tooltip {...TOOLTIP} formatter={(v) => [`${fmtNum(v)} cm`, MEDIDAS.find((m) => m.key === medidaSel).label]} />
                <Line type="monotone" dataKey="valor" name="cm" stroke={COLORS.teal} strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState text={hasAnyMeasure
            ? "Sem lançamentos desta medida no período. Lance na aba Registro quando medir."
            : "Ainda não há medidas. Lance na aba Registro (\"Registrar medidas corporais\") quando medir; não precisa gerar avaliação."} />
        )}
      </PanelSection>

      {/* 6. Constância */}
      <PanelSection
        icon={CalendarDays} title="Constância de treino"
        note={
          <>
            {consistency.treinos30} dia{consistency.treinos30 === 1 ? "" : "s"} de treino nos últimos 30 dias (média de {fmtNum(consistency.mediaSemanal)} por semana).
            {consistency.streak != null && (
              <> Semanas seguidas cumprindo a meta de {metaDias} dia{metaDias === 1 ? "" : "s"}/semana: <b style={{ color: COLORS.textHi }}>{consistency.streak}</b>.</>
            )}
          </>
        }
      >
        <div style={{ overflowX: "auto", paddingBottom: 4 }}>
          <div style={{ display: "inline-flex", gap: 6 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingTop: 15 }}>
              {DIAS_SEMANA.map((d, i) => (
                <div key={i} style={{ height: 14, fontSize: 9.5, lineHeight: "14px", color: COLORS.textFaint, width: 10, textAlign: "right" }}>{i % 2 === 0 ? d : ""}</div>
              ))}
            </div>
            {consistency.columns.map((col, ci) => (
              <div key={col.start} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ height: 12, fontSize: 9.5, color: COLORS.textFaint, whiteSpace: "nowrap", width: 14, overflow: "visible" }}>{monthLabels[ci]}</div>
                {col.cells.map((cell) => (
                  <div key={cell.date} title={`${fmtDate(cell.date)}${cell.level === "forca" ? " · força" : cell.level === "cardio" ? " · cardio" : cell.level === "ambos" ? " · força e cardio" : ""}`}
                    style={{
                      width: 14, height: 14, borderRadius: 3, background: levelBg(cell.level),
                      border: cell.level === "futuro" ? "none" : `1px solid ${cell.level === "nenhum" ? COLORS.line : "transparent"}`,
                      boxSizing: "border-box",
                    }} />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, fontSize: 11.5, color: COLORS.textMid }}>
          {[["forca", "Força"], ["cardio", "Cardio"], ["ambos", "Força e cardio"], ["nenhum", "Sem treino"]].map(([lvl, txt]) => (
            <span key={lvl} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 11, height: 11, borderRadius: 2, background: levelBg(lvl), border: lvl === "nenhum" ? `1px solid ${COLORS.line}` : "none", display: "inline-block" }} />{txt}
            </span>
          ))}
        </div>
      </PanelSection>

      {/* 4. Volume por grupo muscular */}
      <PanelSection
        icon={Dumbbell} title="Séries por grupo muscular, por semana"
        note={`Últimas ${weeks} semanas (segunda a domingo). Conta as séries do esquema de cada exercício (ex.: 4x8 = 4); esquemas sem esse formato, como "Drop set", contam como ${DEFAULT_SETS}.`}
      >
        {volume.groups.length > 0 ? (
          <div style={{ height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={volume.rows}>
                <CartesianGrid stroke={COLORS.line} strokeDasharray="3 3" />
                <XAxis dataKey="semana" stroke={COLORS.textFaint} fontSize={11.5} tickLine={false} minTickGap={16} />
                <YAxis stroke={COLORS.textFaint} fontSize={11.5} tickLine={false} width={34} allowDecimals={false} />
                <Tooltip {...TOOLTIP} labelFormatter={(l) => `Semana de ${l}`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {volume.groups.map((g) => (
                  <Bar key={g} dataKey={g} stackId="v" name={(GROUP_META[g] || { label: g }).label} fill={(GROUP_META[g] || { color: "#6F7F7E" }).color} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState text="Registre treinos de força neste período para ver o equilíbrio entre os grupos musculares." />
        )}
        {volume.totals.sem_classificacao > 0 && (
          <div style={{ fontSize: 11.5, color: COLORS.textFaint, marginTop: 6 }}>
            "Sem classificação": exercícios cuja classificação automática ainda não terminou ou falhou. Ela é refeita quando você lança o exercício de novo.
          </div>
        )}
      </PanelSection>

      {hasMinutes && (
        <PanelSection icon={Dumbbell} title="Minutos de treino por semana">
          <div style={{ height: 210 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={minutes}>
                <CartesianGrid stroke={COLORS.line} strokeDasharray="3 3" />
                <XAxis dataKey="semana" stroke={COLORS.textFaint} fontSize={11.5} tickLine={false} minTickGap={16} />
                <YAxis stroke={COLORS.textFaint} fontSize={11.5} tickLine={false} width={38} />
                <Tooltip {...TOOLTIP} labelFormatter={(l) => `Semana de ${l}`} />
                <Legend wrapperStyle={{ fontSize: 12.5 }} />
                <Bar dataKey="forca" name="Força (min)" fill={COLORS.teal} radius={[2, 2, 0, 0]} />
                <Bar dataKey="cardio" name="Cardio (min)" fill={COLORS.amber} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </PanelSection>
      )}

      {/* 3. Carga por exercício */}
      <PanelSection
        icon={LineChartIcon} title="Progressão de carga por exercício"
        right={loadList.length > 0 && (
          <Select value={exKey} onChange={(e) => setExSel(e.target.value)} style={{ maxWidth: 230 }}>
            {loadList.map((e) => <option key={e.key} value={e.key}>{e.nome} ({e.pontos.length})</option>)}
          </Select>
        )}
        note={loadDelta && loadDelta.count > 1
          ? <>{exCurrent.nome}: {fmtNum(loadDelta.first)} → {fmtNum(loadDelta.last)} kg ({signed(loadDelta.delta, "kg")}). Mostra a maior carga lançada em cada dia.</>
          : loadList.length > 0 ? "Mostra a maior carga lançada em cada dia. Com mais um treino do mesmo exercício a linha de progressão aparece." : null}
      >
        {exCurrent ? (
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={exCurrent.pontos}>
                <CartesianGrid stroke={COLORS.line} strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke={COLORS.textFaint} fontSize={11.5} tickLine={false} minTickGap={28} />
                <YAxis stroke={COLORS.textFaint} fontSize={11.5} tickLine={false} width={38} domain={axisCarga.domain} ticks={axisCarga.ticks} />
                <Tooltip {...TOOLTIP} formatter={(v) => [`${fmtNum(v)} kg`, "Carga"]} />
                <Line type="monotone" dataKey="carga" name="kg" stroke={COLORS.teal} strokeWidth={2} dot={{ r: 3.5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState text="Nenhuma carga em kg registrada neste período. Exercícios sem carga (peso corporal) não entram neste gráfico." />
        )}
      </PanelSection>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------------
function HistoricoTab({ sortedDates, logs, onSelect, onDelete }) {
  const desc = [...sortedDates].reverse();
  if (desc.length === 0) return <EmptyState text="Nenhum registro ainda. Adicione seu primeiro dia na aba Registro." />;
  return (
    <div style={{ maxWidth: 760 }}>
      <SectionTitle icon={CalendarDays} title="Histórico de registros" />
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
        {desc.map((d) => {
          const e = logs[d];
          return (
            <div key={d} style={{ display: "flex", alignItems: "center", gap: 14, border: `1px solid ${COLORS.line}`, borderRadius: 4, padding: "10px 12px" }}>
              <div style={{ width: 70, fontFamily: "'Space Grotesk', sans-serif", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }} onClick={() => onSelect(d)}>{fmtDate(d)}</div>
              <div style={{ flex: 1, display: "flex", gap: 16, fontSize: 12.5, color: COLORS.textMid, cursor: "pointer", flexWrap: "wrap" }} onClick={() => onSelect(d)}>
                {e.weight && <span>{e.weight} kg</span>}
                {e.leanMassPct && <span>{e.leanMassPct}% massa magra</span>}
                {e.bodyFatPct && <span>{e.bodyFatPct}% gordura</span>}
                {Object.values(e.medidas || {}).some((v) => v !== "" && v != null) && <span>medidas</span>}
                <span>{(e.strengthWorkouts || []).length} treino(s) de força</span>
                <span>{(e.cardioWorkouts || []).length} cardio</span>
              </div>
              <IconButton onClick={() => onDelete(d)} danger title="Excluir dia"><Trash2 size={14} /></IconButton>
            </div>
          );
        })}
      </div>
    </div>
  );
}
