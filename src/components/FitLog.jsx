import { useState, useEffect, useMemo, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine
} from "recharts";
import {
  Dumbbell, HeartPulse, UtensilsCrossed, LineChart as LineChartIcon,
  Sparkles, Trash2, Plus, CalendarDays, Loader2, RefreshCw, Ruler, Target, LogOut
} from "lucide-react";
import { loadState, persistState, emptyState } from "../lib/storage";
import { lookupMacros, classifyExercise, generatePlanFromContext } from "../lib/claude";
import { debounce } from "../lib/debounce";
import {
  MEDIDAS, DEFAULT_SETS, periodStart, buildBodySeries, withMovingAverage, filterFrom,
  firstLastDelta, buildMeasureSeries, latestMeasures, measureHistoryForPlan, buildLoadSeries,
  buildMuscleVolume, buildCalorieSeries, buildConsistency, buildWeeklyMinutes,
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

const GOALS = {
  hipertrofia: "Hipertrofia",
  emagrecimento: "Emagrecimento",
  recomposicao: "Recomposição corporal",
  resistencia: "Resistência / condicionamento",
  manutencao: "Manutenção",
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
    strengthWorkouts: [], cardioWorkouts: [], meals: [],
    dietMode: "detalhado", estimatedCalories: "", cheatDay: false, cheatDayNote: "",
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
function MacroBar({ label, value, target, unit }) {
  const pct = target ? Math.min(100, Math.round((value / target) * 100)) : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: COLORS.textMid }}>
        <span>{label}</span>
        <span style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          {Math.round(value)}{unit}{target ? ` / ${Math.round(target)}${unit}` : ""}
        </span>
      </div>
      <div style={{ height: 6, background: COLORS.surface, borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct ?? (value > 0 ? 100 : 0)}%`, background: COLORS.teal }} />
      </div>
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

  const updateMealInDay = useCallback((date, mealId, patch) => {
    setState((prev) => {
      const d = prev.logs[date];
      if (!d) return prev;
      const meals = (d.meals || []).map((m) => (m.id === mealId ? { ...m, ...patch } : m));
      const next = { ...prev, logs: { ...prev.logs, [date]: { ...d, meals } } };
      debouncedPersist(next);
      return next;
    });
  }, [debouncedPersist]);

  const sortedDates = useMemo(() => Object.keys(logs).sort(), [logs]);

  const streak = useMemo(() => {
    let count = 0;
    let cursor = new Date(todayISO());
    while (true) {
      const iso = cursor.toISOString().slice(0, 10);
      const e = logs[iso];
      const hasData = e && ((e.strengthWorkouts || []).length || (e.cardioWorkouts || []).length || (e.meals || []).length || e.weight);
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

  const todayMacros = useMemo(() => {
    if (day.dietMode === "estimado") {
      return { carboidratos_g: 0, proteinas_g: 0, gorduras_g: 0, calorias_kcal: Number(day.estimatedCalories) || 0, estimadoSemMacros: true };
    }
    const meals = day.meals || [];
    return meals.reduce((acc, m) => ({
      carboidratos_g: acc.carboidratos_g + (m.carboidratos_g || 0),
      proteinas_g: acc.proteinas_g + (m.proteinas_g || 0),
      gorduras_g: acc.gorduras_g + (m.gorduras_g || 0),
      calorias_kcal: acc.calorias_kcal + (m.calorias_kcal || 0),
    }), { carboidratos_g: 0, proteinas_g: 0, gorduras_g: 0, calorias_kcal: 0 });
  }, [day.meals, day.dietMode, day.estimatedCalories]);

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
      alimentacaoRecente: recentDates.map((d) => {
        const entry = logs[d];
        if (entry.dietMode === "estimado") {
          return { data: d, modo: "estimativa_total", calorias_kcal: Number(entry.estimatedCalories) || null, diaDoLixo: !!entry.cheatDay };
        }
        const meals = entry.meals || [];
        const totals = meals.reduce((acc, m) => ({
          carboidratos_g: acc.carboidratos_g + (m.carboidratos_g || 0),
          proteinas_g: acc.proteinas_g + (m.proteinas_g || 0),
          gorduras_g: acc.gorduras_g + (m.gorduras_g || 0),
          calorias_kcal: acc.calorias_kcal + (m.calorias_kcal || 0),
        }), { carboidratos_g: 0, proteinas_g: 0, gorduras_g: 0, calorias_kcal: 0 });
        return { data: d, modo: "detalhado", diaDoLixo: !!entry.cheatDay, ...totals };
      }),
    };
  }, [sortedDates, assessments, bodySeries, measureSeries, logs, exerciseCatalog]);

  const generatePlan = async (assessment) => {
    const useAssessment = assessment || latestAssessment;
    if (!useAssessment) { setPlanError("Preencha a avaliação física antes de gerar um plano."); return; }
    setPlanLoading(true); setPlanError("");
    try {
      const context = buildContext(useAssessment);
      const parsed = await generatePlanFromContext(context);
      const nextPlan = { ...parsed, generatedAt: new Date().toISOString(), assessmentId: useAssessment.id };
      // Funcional de propósito: durante a geração você pode ter salvo uma avaliação ou lançado
      // dados; gravar a partir do estado antigo apagaria isso.
      commitWith((prev) => ({ ...prev, currentPlan: nextPlan }));
      setTab("plano");
    } catch (e) {
      setPlanError("Não foi possível gerar o plano agora. Tente novamente em instantes.");
    } finally {
      setPlanLoading(false);
    }
  };

  const saveAssessment = (draft) => {
    const date = todayISO();
    const assessment = { id: uid(), date, ...draft };
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
    { id: "historico", label: "Histórico", icon: UtensilsCrossed },
  ];

  return (
    <div style={{ background: COLORS.bg, color: COLORS.textHi, minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "'IBM Plex Sans', sans-serif" }}>
      {fontImport}
      <div style={{ borderBottom: `1px solid ${COLORS.line}`, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 19, fontWeight: 600 }}>Diário de treino e alimentação</div>
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
          {tab === "registro" && (
            <RegistroTab
              selectedDate={selectedDate} setSelectedDate={setSelectedDate}
              day={day} updateDay={updateDay}
              onClassifyExercise={ensureExerciseClassified}
              onAddMeal={async (descricao) => {
                const id = uid();
                const date = selectedDate;
                const optimistic = { id, descricao, status: "estimando", carboidratos_g: null, proteinas_g: null, gorduras_g: null, calorias_kcal: null };
                const currentDay = logs[date] || emptyDay(date);
                commit({ ...state, logs: { ...logs, [date]: { ...currentDay, meals: [...(currentDay.meals || []), optimistic] } } });
                try {
                  const macros = await lookupMacros(descricao);
                  updateMealInDay(date, id, { ...macros, status: "ok" });
                } catch (e) {
                  updateMealInDay(date, id, { status: "erro" });
                }
              }}
              onRemoveMeal={(id) => updateDay({ meals: (day.meals || []).filter((m) => m.id !== id) })}
              onEditMeal={(id, patch) => updateMealInDay(selectedDate, id, patch)}
              todayMacros={todayMacros}
              macroTargets={currentPlan?.metasMacro}
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
              onGoToAssessment={() => setTab("avaliacao")} />
          )}
          {tab === "painel" && (
            <PainelTab logs={logs} sortedDates={sortedDates} bodySeries={bodySeries} measureSeries={measureSeries}
              exerciseCatalog={exerciseCatalog} latestAssessment={latestAssessment}
              todayMacros={todayMacros} macroTargets={currentPlan?.metasMacro} />
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
function RegistroTab({ selectedDate, setSelectedDate, day, updateDay, onClassifyExercise, onAddMeal, onRemoveMeal, onEditMeal, todayMacros, macroTargets }) {
  const [exerciseList, setExerciseList] = useState([]);
  const [exerciseDraft, setExerciseDraft] = useState({ nome: "", carga_kg: "", esquema: "" });
  const [sessionDraft, setSessionDraft] = useState({ duracao: "", hr_avg: "", hr_max: "", calorias: "", rpe: "7" });
  const [cardioDraft, setCardioDraft] = useState({ tipo: "corrida", duracao: "", hr_avg: "", hr_max: "", pace: "", calorias: "", rpe: "6" });
  const [mealText, setMealText] = useState("");
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

      {/* Alimentação */}
      <section style={{ borderTop: `1px solid ${COLORS.line}`, paddingTop: 16 }}>
        <SectionTitle icon={UtensilsCrossed} title="Alimentação do dia" />
        <div style={{ fontSize: 12, color: COLORS.textMid, marginTop: 4 }}>Opcional todos os dias — registre por refeição quando der, ou só o total quando não der.</div>

        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: COLORS.textHi, cursor: "pointer" }}>
            <input type="checkbox" checked={day.dietMode === "estimado"}
              onChange={(e) => updateDay({ dietMode: e.target.checked ? "estimado" : "detalhado" })} />
            Hoje não vou detalhar — só informar o total de calorias
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: COLORS.amber, cursor: "pointer" }}>
            <input type="checkbox" checked={!!day.cheatDay} onChange={(e) => updateDay({ cheatDay: e.target.checked })} />
            Dia do lixo (alta caloria / álcool)
          </label>
        </div>

        {day.dietMode === "estimado" ? (
          <div style={{ marginTop: 12 }}>
            <Field label="Calorias totais estimadas do dia">
              <TextInput type="number" placeholder="2200" value={day.estimatedCalories} onChange={(e) => updateDay({ estimatedCalories: e.target.value })} style={{ width: 130 }} />
            </Field>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            {(day.meals || []).map((m) => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, background: COLORS.surface, border: `1px solid ${COLORS.line}`, borderRadius: 4, padding: "8px 10px" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5 }}>{m.descricao}</div>
                  {m.status === "estimando" && (
                    <div style={{ fontSize: 11.5, color: COLORS.textMid, display: "flex", alignItems: "center", gap: 6 }}>
                      <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> estimando macronutrientes…
                    </div>
                  )}
                  {m.status === "erro" && <div style={{ fontSize: 11.5, color: COLORS.red }}>não foi possível estimar — edite manualmente abaixo</div>}
                  {(m.status === "ok" || m.status === "erro") && (
                    <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
                      <MiniMacroInput label="carb" value={m.carboidratos_g} onChange={(v) => onEditMeal(m.id, { carboidratos_g: v })} />
                      <MiniMacroInput label="prot" value={m.proteinas_g} onChange={(v) => onEditMeal(m.id, { proteinas_g: v })} />
                      <MiniMacroInput label="gord" value={m.gorduras_g} onChange={(v) => onEditMeal(m.id, { gorduras_g: v })} />
                      <MiniMacroInput label="kcal" value={m.calorias_kcal} onChange={(v) => onEditMeal(m.id, { calorias_kcal: v })} />
                    </div>
                  )}
                </div>
                <IconButton onClick={() => onRemoveMeal(m.id)} danger title="Remover"><Trash2 size={14} /></IconButton>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8 }}>
              <TextInput placeholder="ex.: 200g de peito de frango grelhado" value={mealText} onChange={(e) => setMealText(e.target.value)} style={{ flex: 1 }}
                onKeyDown={(e) => { if (e.key === "Enter" && mealText.trim()) { onAddMeal(mealText.trim()); setMealText(""); } }} />
              <PrimaryButton onClick={() => { if (mealText.trim()) { onAddMeal(mealText.trim()); setMealText(""); } }}><Plus size={15} /> Adicionar</PrimaryButton>
            </div>
          </div>
        )}

        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <MacroBar label="Calorias" value={todayMacros.calorias_kcal} target={macroTargets?.calorias_kcal} unit=" kcal" />
          {!todayMacros.estimadoSemMacros && (
            <>
              <MacroBar label="Carboidratos" value={todayMacros.carboidratos_g} target={macroTargets?.carboidratos_g} unit="g" />
              <MacroBar label="Proteínas" value={todayMacros.proteinas_g} target={macroTargets?.proteinas_g} unit="g" />
              <MacroBar label="Gorduras" value={todayMacros.gorduras_g} target={macroTargets?.gorduras_g} unit="g" />
            </>
          )}
          {todayMacros.estimadoSemMacros && <div style={{ fontSize: 11.5, color: COLORS.textFaint }}>Modo estimativa: só o total de calorias é considerado hoje, sem detalhamento de macros.</div>}
          {!macroTargets && <div style={{ fontSize: 11.5, color: COLORS.textFaint }}>Preencha a avaliação física para definir metas de macronutrientes.</div>}
        </div>
      </section>
    </div>
  );
}

function MiniMacroInput({ label, value, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, color: COLORS.textMid }}>
      {label}
      <input type="number" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        style={{ width: 52, background: COLORS.bg, border: `1px solid ${COLORS.line}`, borderRadius: 3, color: COLORS.textHi, padding: "2px 4px", fontSize: 11.5 }} />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Avaliação
// ---------------------------------------------------------------------------
function AvaliacaoTab({ latestAssessment, assessments, latestWeight, latestMedidas, latestBodyFat, onSave, planLoading, planError }) {
  // Os valores vêm pré-preenchidos com o último lançamento do registro diário (editáveis).
  // Meta e frequência partem da última avaliação, se houver.
  const [draft, setDraft] = useState({
    weight: latestWeight?.peso ?? "", leanMassPct: latestWeight?.massaMagra ?? "", bodyFatPct: latestBodyFat ?? "",
    biceps: latestMedidas?.biceps ?? "", peito: latestMedidas?.peito ?? "", cintura: latestMedidas?.cintura ?? "",
    quadril: latestMedidas?.quadril ?? "", coxa: latestMedidas?.coxa ?? "", panturrilha: latestMedidas?.panturrilha ?? "",
    meta: latestAssessment?.meta ?? "hipertrofia", metaObs: latestAssessment?.metaObs ?? "",
    frequenciaSemanal: latestAssessment?.frequenciaSemanal ?? "4",
  });

  const set = (k) => (e) => setDraft({ ...draft, [k]: e.target.value });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 620 }}>
      <div>
        <SectionTitle icon={Ruler} title="Avaliação física e meta" />
        <div style={{ fontSize: 12.5, color: COLORS.textMid, marginTop: 4 }}>
          Use ao mudar de meta ou de fase. A cada envio, o plano de treino e as metas de alimentação são recalculados. Para acompanhar peso e medidas no dia a dia sem gerar plano, lance-os na aba Registro. Os campos abaixo vêm preenchidos com o seu último lançamento; só o que você alterar vira um novo ponto nos gráficos.
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
          <Field label="Bíceps"><TextInput type="number" step="0.5" value={draft.biceps} onChange={set("biceps")} style={{ width: 90 }} /></Field>
          <Field label="Peito"><TextInput type="number" step="0.5" value={draft.peito} onChange={set("peito")} style={{ width: 90 }} /></Field>
          <Field label="Cintura"><TextInput type="number" step="0.5" value={draft.cintura} onChange={set("cintura")} style={{ width: 90 }} /></Field>
          <Field label="Quadril"><TextInput type="number" step="0.5" value={draft.quadril} onChange={set("quadril")} style={{ width: 90 }} /></Field>
          <Field label="Coxa"><TextInput type="number" step="0.5" value={draft.coxa} onChange={set("coxa")} style={{ width: 90 }} /></Field>
          <Field label="Panturrilha"><TextInput type="number" step="0.5" value={draft.panturrilha} onChange={set("panturrilha")} style={{ width: 90 }} /></Field>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <Field label="Meta atual">
          <Select value={draft.meta} onChange={set("meta")} style={{ width: 220 }}>
            {Object.entries(GOALS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Dias de treino disponíveis por semana">
          <Select value={draft.frequenciaSemanal} onChange={set("frequenciaSemanal")} style={{ width: 100 }}>
            {[2, 3, 4, 5, 6, 7].map((v) => <option key={v} value={v}>{v}</option>)}
          </Select>
        </Field>
      </div>

      <Field label="Observações" hint="opcional — lesões, preferências, restrições alimentares, etc.">
        <TextArea rows={3} value={draft.metaObs} onChange={set("metaObs")} />
      </Field>

      {planError && (
        <div style={{ border: `1px solid #5C332E`, background: COLORS.redSoft, borderRadius: 4, padding: "10px 12px", fontSize: 13, color: "#E8A79A" }}>{planError}</div>
      )}

      <PrimaryButton onClick={() => onSave(draft)} disabled={planLoading}>
        {planLoading ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Target size={15} />}
        {planLoading ? "Atualizando plano…" : "Salvar avaliação e atualizar plano"}
      </PrimaryButton>

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
function PlanoTab({ plan, loading, error, onRegenerate, hasAssessment, onGoToAssessment }) {
  if (!hasAssessment && !plan) {
    return (
      <div style={{ maxWidth: 620 }}>
        <SectionTitle icon={Target} title="Plano atual" />
        <div style={{ marginTop: 12 }}>
          <EmptyState text="Nenhuma avaliação física registrada ainda." />
          <div style={{ marginTop: 12 }}><GhostButton onClick={onGoToAssessment}>Preencher avaliação física</GhostButton></div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 640 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <SectionTitle icon={Target} title="Plano atual" />
        <PrimaryButton onClick={onRegenerate} disabled={loading}>
          {loading ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <RefreshCw size={15} />}
          {loading ? "Atualizando…" : "Atualizar com dados recentes"}
        </PrimaryButton>
      </div>

      {error && <div style={{ border: `1px solid #5C332E`, background: COLORS.redSoft, borderRadius: 4, padding: "10px 12px", fontSize: 13, color: "#E8A79A" }}>{error}</div>}

      {!plan && !loading && !error && <EmptyState text="Gere o plano a partir da avaliação física preenchida." />}

      {plan && (
        <>
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.line}`, borderRadius: 4, padding: 14, fontSize: 13.5, lineHeight: 1.6 }}>{plan.resumoMeta}</div>

          <div>
            <SectionTitle icon={UtensilsCrossed} title="Metas diárias de macronutrientes" />
            <div style={{ display: "flex", gap: 22, marginTop: 12, flexWrap: "wrap" }}>
              <StatReadout label="Calorias" value={plan.metasMacro?.calorias_kcal} unit="kcal" />
              <StatReadout label="Carboidratos" value={plan.metasMacro?.carboidratos_g} unit="g" />
              <StatReadout label="Proteínas" value={plan.metasMacro?.proteinas_g} unit="g" />
              <StatReadout label="Gorduras" value={plan.metasMacro?.gorduras_g} unit="g" />
            </div>
          </div>

          {plan.proximoTreino && (
            <div>
              <SectionTitle icon={Dumbbell} title="Treino de força sugerido" />
              <div style={{ fontSize: 13, color: COLORS.textMid, marginTop: 6, marginBottom: 10 }}>{plan.proximoTreino.resumo}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(plan.proximoTreino.sessoes || []).map((sessao, i) => (
                  <div key={i} style={{ background: COLORS.surface, border: `1px solid ${COLORS.line}`, borderRadius: 4, padding: "10px 12px" }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", color: COLORS.teal, marginBottom: 6 }}>{sessao.foco}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {(sessao.exercicios || []).map((ex, j) => (
                        <div key={j} style={{ fontSize: 13, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ color: COLORS.textHi }}>{ex.nome}</span>
                          <span style={{ color: COLORS.textMid }}>{ex.alvo}{ex.carga_sugerida ? ` · ${ex.carga_sugerida}` : ""}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <PlanBlock icon={Dumbbell} title="Orientações gerais de treino" data={plan.treino} />
          <PlanBlock icon={LineChartIcon} title="Progressão de carga por exercício" data={plan.progressao} itemKeyA="exercicio" itemKeyB="sugestao" />
          <PlanBlock icon={UtensilsCrossed} title="Alimentação" data={plan.alimentacao} />

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

function PainelTab({ logs, sortedDates, bodySeries, measureSeries, exerciseCatalog, latestAssessment, todayMacros, macroTargets }) {
  const today = todayISO();
  const [period, setPeriod] = useState(90);
  const [compMode, setCompMode] = useState("pct");
  const [medidaSel, setMedidaSel] = useState("cintura");
  const [exSel, setExSel] = useState("");

  const start = periodStart(today, period);
  const weeks = period === "all" ? 26 : Math.min(26, Math.max(4, Math.ceil(period / 7)));
  const kcalDays = period === "all" ? 90 : Math.min(period, 90);

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

  // ---- calorias
  const calories = useMemo(() => buildCalorieSeries(logs, sortedDates, today, kcalDays), [logs, sortedDates, today, kcalDays]);
  const kcalTarget = macroTargets?.calorias_kcal;

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

      {/* 5. Calorias */}
      <PanelSection
        icon={UtensilsCrossed} title="Calorias por dia"
        note={
          <>
            {calories.mediaKcal != null
              ? <>Média dos dias normais: <b style={{ color: COLORS.textHi }}>{fmtNum(calories.mediaKcal, 0)} kcal</b> ({calories.diasMedia} dia{calories.diasMedia === 1 ? "" : "s"}, sem contar dias do lixo){kcalTarget ? <>; meta do plano: {fmtNum(kcalTarget, 0)} kcal</> : null}. </>
              : null}
            {calories.mediaProteina7d != null && (
              <>Proteína, média dos últimos 7 dias: <b style={{ color: COLORS.textHi }}>{fmtNum(calories.mediaProteina7d, 0)} g</b>{macroTargets?.proteinas_g ? <> (meta {fmtNum(macroTargets.proteinas_g, 0)} g)</> : null}. </>
            )}
            {(period === "all" || period > 90) && "Mostrando os últimos 90 dias."}
          </>
        }
      >
        {calories.rows.length > 0 ? (
          <div style={{ height: 230 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={calories.rows} margin={{ right: 30 }}>
                <CartesianGrid stroke={COLORS.line} strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke={COLORS.textFaint} fontSize={11.5} tickLine={false} minTickGap={20} />
                <YAxis stroke={COLORS.textFaint} fontSize={11.5} tickLine={false} width={42}
                  domain={[0, (dataMax) => Math.ceil((Math.max(dataMax, kcalTarget || 0) * 1.1) / 100) * 100]} />
                <Tooltip {...TOOLTIP} formatter={(v, name) => [`${fmtNum(v, 0)} kcal`, name]} />
                <Legend wrapperStyle={{ fontSize: 12.5 }} />
                {kcalTarget ? <ReferenceLine y={kcalTarget} stroke={COLORS.textHi} strokeDasharray="5 4" label={{ value: "Meta", fill: COLORS.textMid, fontSize: 11, position: "right" }} /> : null}
                <Bar dataKey="normal" stackId="k" name="Dia normal" fill={COLORS.teal} />
                <Bar dataKey="estimado" stackId="k" name="Só calorias (estimado)" fill="#6D8CB0" />
                <Bar dataKey="lixo" stackId="k" name="Dia do lixo" fill={COLORS.amber} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState text="Nenhuma caloria registrada neste período." />
        )}
      </PanelSection>

      <div>
        <SectionTitle icon={UtensilsCrossed} title="Macronutrientes de hoje" />
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12, maxWidth: 340 }}>
          <MacroBar label="Calorias" value={todayMacros.calorias_kcal} target={macroTargets?.calorias_kcal} unit=" kcal" />
          <MacroBar label="Carboidratos" value={todayMacros.carboidratos_g} target={macroTargets?.carboidratos_g} unit="g" />
          <MacroBar label="Proteínas" value={todayMacros.proteinas_g} target={macroTargets?.proteinas_g} unit="g" />
          <MacroBar label="Gorduras" value={todayMacros.gorduras_g} target={macroTargets?.gorduras_g} unit="g" />
        </div>
      </div>
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
                <span>{(e.meals || []).length} refeição(ões)</span>
              </div>
              <IconButton onClick={() => onDelete(d)} danger title="Excluir dia"><Trash2 size={14} /></IconButton>
            </div>
          );
        })}
      </div>
    </div>
  );
}
