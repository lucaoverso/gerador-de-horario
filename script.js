// ===================================================
// CONFIGURAÇÕES GERAIS
// ===================================================
const diasSemana = ["Seg", "Ter", "Qua", "Qui", "Sex"];
const turnos = { M: 5, V: 5, I: 8, EMR: 6 };

// ===================================================
// MAPA DE FAIXA GLOBAL DE HORÁRIO
// ===================================================
function faixaGlobal(turno, aula) {
  if (turno === "M") return aula; // 1–5 manhã

  if (turno === "I") {
    // Integral sincronizado:
    // I1..I5 = M1..M5
    // I6..I8 = V2..V4 (faixas 7..9)
    if (aula <= 5) return aula;
    return aula + 1;
  }

  if (turno === "V") return 5 + aula;   // 6–10
  if (turno === "EMR") {
    // EMR1..EMR5 = V1..V5 (faixas 6..10)
    // EMR6 = faixa exclusiva final
    if (aula <= 5) return 5 + aula;
    return 11;
  }

  return null;
}


// ===================================================
// GERADOR ALEATÓRIO COM SEED
// ===================================================
let seedAtual = Date.now();

function setSeed(valor) {
  seedAtual = valor;
}

function random() {
  seedAtual = (seedAtual * 9301 + 49297) % 233280;
  return seedAtual / 233280;
}

// ===================================================
// BANCO DE DADOS
// ===================================================
let banco = {
  professores: [],
  turmas: [],
  horarios: {},
  seedBase: null
};

let relatorioGeracao = {
  nivelUsado: null,
  ajustes: []
};

// ===================================================
// PERSISTÊNCIA
// ===================================================
const STORAGE_KEY = "horarioEscolar";
const STORAGE_VERSAO = 2;

function criarSlotPadrao(turno, dia, aula) {
  return {
    dia,
    aula,
    turno,
    faixa: faixaGlobal(turno, aula),
    disciplina: null,
    professor: null,
    fixo: false,
    conflito: false,
    conflitos: [],
    ajusteManual: false
  };
}

function serializarProfessoresCompacto(professores) {
  return (professores || []).map(p => ({
    n: p.nome || "",
    d: Array.isArray(p.dias) ? p.dias : [],
    r: {
      M: p.restricoes?.aulasProibidas?.M || [],
      V: p.restricoes?.aulasProibidas?.V || [],
      I: p.restricoes?.aulasProibidas?.I || [],
      E: p.restricoes?.aulasProibidas?.EMR || []
    },
    f: {
      a: p.preferencias?.aulasPreferidas || [],
      p: p.preferencias?.pesoPreferencia || 2
    }
  }));
}

function desserializarProfessoresCompacto(professoresCompactos) {
  return (professoresCompactos || []).map(p => ({
    nome: p.n || "",
    dias: Array.isArray(p.d) ? p.d : [],
    restricoes: {
      aulasProibidas: {
        M: p.r?.M || [],
        V: p.r?.V || [],
        I: p.r?.I || [],
        EMR: p.r?.E || []
      }
    },
    preferencias: {
      aulasPreferidas: p.f?.a || [],
      pesoPreferencia: p.f?.p || 2
    }
  }));
}

function serializarTurmasCompacto(turmas) {
  return (turmas || []).map(turma => ([
    turma.nome || "",
    turma.turno || "M",
    (turma.disciplinas || []).map(d => ([
      d.nome || "",
      Number(d.aulas) || 0,
      d.professor || "",
      Number(d.agrupamento || 1),
      d.permiteSequencia ? 1 : 0
    ]))
  ]));
}

function desserializarTurmasCompacto(turmasCompactas) {
  return (turmasCompactas || []).map(item => {
    const [nome, turno, disciplinasCompactas] = Array.isArray(item) ? item : [];
    return {
      nome: nome || "",
      turno: turno || "M",
      disciplinas: (disciplinasCompactas || []).map(d => ({
        nome: d[0] || "",
        aulas: Number(d[1]) || 0,
        professor: d[2] || null,
        agrupamento: Math.max(1, Number(d[3] || 1)),
        permiteSequencia: Boolean(d[4])
      }))
    };
  });
}

function serializarHorariosCompacto(horarios) {
  const resultado = {};

  Object.entries(horarios || {}).forEach(([turmaNome, slots]) => {
    const disciplinas = [];
    const professores = [];
    const idxDisc = new Map();
    const idxProf = new Map();
    const entradas = [];

    (slots || []).forEach(slot => {
      const precisaSalvar =
        Boolean(slot.disciplina) ||
        Boolean(slot.professor) ||
        Boolean(slot.fixo) ||
        Boolean(slot.conflito) ||
        Boolean(slot.ajusteManual);

      if (!precisaSalvar) return;

      const diaIdx = diasSemana.indexOf(slot.dia);
      if (diaIdx < 0) return;

      let d = -1;
      if (slot.disciplina) {
        if (!idxDisc.has(slot.disciplina)) {
          idxDisc.set(slot.disciplina, disciplinas.length);
          disciplinas.push(slot.disciplina);
        }
        d = idxDisc.get(slot.disciplina);
      }

      let p = -1;
      if (slot.professor) {
        if (!idxProf.has(slot.professor)) {
          idxProf.set(slot.professor, professores.length);
          professores.push(slot.professor);
        }
        p = idxProf.get(slot.professor);
      }

      const flags =
        (slot.fixo ? 1 : 0) +
        (slot.conflito ? 2 : 0) +
        (slot.ajusteManual ? 4 : 0);

      const entrada = [diaIdx, slot.aula, d, p, flags];

      if (Array.isArray(slot.conflitos) && slot.conflitos.length > 0) {
        entrada.push(slot.conflitos);
      }

      entradas.push(entrada);
    });

    if (entradas.length > 0) {
      resultado[turmaNome] = {
        d: disciplinas,
        p: professores,
        e: entradas
      };
    }
  });

  return resultado;
}

function desserializarHorariosCompacto(horariosCompactos, turmas) {
  const horarios = {};

  (turmas || []).forEach(turma => {
    const slots = [];
    diasSemana.forEach(dia => {
      for (let aula = 1; aula <= turnos[turma.turno]; aula++) {
        slots.push(criarSlotPadrao(turma.turno, dia, aula));
      }
    });

    const slotMap = new Map(
      slots.map(s => [`${s.dia}|${s.aula}`, s])
    );

    const compacto = horariosCompactos?.[turma.nome];
    if (compacto?.e?.length) {
      const disciplinas = compacto.d || [];
      const professores = compacto.p || [];

      compacto.e.forEach(item => {
        if (!Array.isArray(item) || item.length < 5) return;

        const [diaIdx, aula, d, p, flags, conflitos] = item;
        const dia = diasSemana[diaIdx];
        const slot = slotMap.get(`${dia}|${aula}`);
        if (!slot) return;

        slot.disciplina = d >= 0 ? (disciplinas[d] || null) : null;
        slot.professor = p >= 0 ? (professores[p] || null) : null;
        slot.fixo = Boolean(flags & 1);
        slot.conflito = Boolean(flags & 2);
        slot.ajusteManual = Boolean(flags & 4);
        slot.conflitos = Array.isArray(conflitos) ? conflitos : [];
      });
    }

    horarios[turma.nome] = slots;
  });

  return horarios;
}

function serializarBancoCompacto() {
  return {
    _versao: STORAGE_VERSAO,
    s: banco.seedBase || null,
    p: serializarProfessoresCompacto(banco.professores),
    t: serializarTurmasCompacto(banco.turmas),
    h: serializarHorariosCompacto(banco.horarios)
  };
}

function desserializarBancoCompacto(dadosCompactos) {
  const turmas = desserializarTurmasCompacto(dadosCompactos?.t || []);
  return {
    professores: desserializarProfessoresCompacto(dadosCompactos?.p || []),
    turmas,
    horarios: desserializarHorariosCompacto(dadosCompactos?.h || {}, turmas),
    seedBase: dadosCompactos?.s || null
  };
}

function salvar() {
  const payload = serializarBancoCompacto();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function carregar() {
  const bruto = localStorage.getItem(STORAGE_KEY);
  if (!bruto) return;

  const dados = JSON.parse(bruto);

  if (dados?._versao === STORAGE_VERSAO) {
    banco = desserializarBancoCompacto(dados);
    return;
  }

  // Compatibilidade com formato antigo
  banco = dados;
}

// ===================================================
// UTILITÁRIOS
// ===================================================
let aulasNaoAlocadas = [];
let relatorioFalhas = [];
let logsMovimento = [];
let ordenacaoNaoAlocadas = {
  campo: "turma",
  direcao: "asc"
};

function registrarFalha({ turma, disciplina, professor, motivo }) {
  relatorioFalhas.push({
    turma,
    disciplina,
    professor,
    motivo
  });
}

function logMovimento(tipo, mensagem, contexto = {}) {
  logsMovimento.push({
    tipo, // "ERRO", "INFO", "OK"
    mensagem,
    contexto,
    timestamp: new Date().toISOString()
  });
}



function el(id) {
  return document.getElementById(id);
}

function compararTextoNatural(a, b) {
  return String(a || "")
    .localeCompare(String(b || ""), "pt-BR", {
      numeric: true,
      sensitivity: "base"
    });
}

function clamp(valor, min, max) {
  return Math.min(max, Math.max(min, valor));
}

function formatarNumeroBR(valor) {
  return Number(valor || 0).toLocaleString("pt-BR");
}

function formatarPercentual(valor) {
  return `${(Number(valor || 0) * 100).toFixed(1)}%`;
}

function aplicarOrdenacaoAulasNaoAlocadas() {
  const { campo, direcao } = ordenacaoNaoAlocadas;
  const fator = direcao === "asc" ? 1 : -1;
  const desempates = ["turma", "professor", "disciplina"]
    .filter(c => c !== campo);

  aulasNaoAlocadas.sort((a, b) => {
    const principal = compararTextoNatural(a[campo], b[campo]);
    if (principal !== 0) return principal * fator;

    for (const chave of desempates) {
      const cmp = compararTextoNatural(a[chave], b[chave]);
      if (cmp !== 0) return cmp;
    }

    return 0;
  });
}

function atualizarBotoesOrdenacaoNaoAlocadas() {
  const botoes = [
    { id: "ord-naoalocadas-turma", campo: "turma", rotulo: "Turma" },
    { id: "ord-naoalocadas-professor", campo: "professor", rotulo: "Professor" },
    { id: "ord-naoalocadas-disciplina", campo: "disciplina", rotulo: "Disciplina" }
  ];

  botoes.forEach(item => {
    const btn = el(item.id);
    if (!btn) return;

    const ativo = ordenacaoNaoAlocadas.campo === item.campo;
    const sufixo = ativo
      ? (ordenacaoNaoAlocadas.direcao === "asc" ? " ↑" : " ↓")
      : "";

    btn.classList.toggle("ativo", ativo);
    btn.textContent = `${item.rotulo}${sufixo}`;
  });
}

function ordenarAulasNaoAlocadasPor(campo) {
  if (!["turma", "professor", "disciplina"].includes(campo)) return;

  if (ordenacaoNaoAlocadas.campo === campo) {
    ordenacaoNaoAlocadas.direcao =
      ordenacaoNaoAlocadas.direcao === "asc" ? "desc" : "asc";
  } else {
    ordenacaoNaoAlocadas.campo = campo;
    ordenacaoNaoAlocadas.direcao = "asc";
  }

  renderizarAulasNaoAlocadas();
}

function embaralhar(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function chaveCanonicaTexto(valor) {
  return String(valor || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function parseCSVTexto(texto) {
  const linhas = String(texto || "")
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (linhas.length === 0) return [];

  const cabecalho = linhas[0].split(",").map(c => c.trim());

  return linhas.slice(1).map(linha => {
    const valores = linha.split(",").map(v => v.trim());
    const obj = {};
    cabecalho.forEach((c, i) => {
      obj[c] = valores[i] || "";
    });
    return obj;
  });
}

function lerCSV(file, callback) {
  const reader = new FileReader();
  reader.onload = e => {
    callback(parseCSVTexto(e.target.result));
  };
  reader.readAsText(file);
}

function lerCSVComoPromise(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(parseCSVTexto(e.target.result));
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function aplicarTurmasImportadas(dados, substituir = true) {
  const turmasBase = substituir ? [] : [...banco.turmas];
  const mapa = new Map(
    turmasBase.map(t => [chaveCanonicaTexto(t.nome), t])
  );

  (dados || []).forEach(l => {
    const nome = String(l.turma || "").trim();
    const turno = String(l.turno || "").trim();
    if (!nome || !turnos[turno]) return;

    const chave = chaveCanonicaTexto(nome);
    const existente = mapa.get(chave);

    if (existente) {
      existente.nome = nome;
      existente.turno = turno;
      if (!Array.isArray(existente.disciplinas)) existente.disciplinas = [];
      return;
    }

    mapa.set(chave, {
      nome,
      turno,
      disciplinas: []
    });
  });

  banco.turmas = [...mapa.values()];
}

function aplicarProfessoresImportados(dados, substituir = true) {
  const base = substituir ? [] : [...banco.professores];
  const mapa = new Map(
    base.map(p => [chaveCanonicaTexto(p.nome), p])
  );

  (dados || []).forEach(l => {
    const nome = String(l.nome || "").trim();
    if (!nome) return;

    const professor = {
      nome,
      dias: String(l.dias || "")
        .split(";")
        .map(d => d.trim())
        .filter(d => d.length > 0),
      restricoes: {
        aulasProibidas: {
          M: l.proibidas_M ? l.proibidas_M.split(";").map(Number).filter(n => !isNaN(n)) : [],
          V: l.proibidas_V ? l.proibidas_V.split(";").map(Number).filter(n => !isNaN(n)) : [],
          I: l.proibidas_I ? l.proibidas_I.split(";").map(Number).filter(n => !isNaN(n)) : [],
          EMR: l.proibidas_EMR ? l.proibidas_EMR.split(";").map(Number).filter(n => !isNaN(n)) : []
        }
      },
      preferencias: {
        aulasPreferidas: l.preferencias
          ? l.preferencias
            .split(";")
            .map(p => Number(p.trim()))
            .filter(n => !isNaN(n))
          : [],
        pesoPreferencia: 10
      }
    };

    mapa.set(chaveCanonicaTexto(nome), professor);
  });

  banco.professores = [...mapa.values()];
}

function aplicarDisciplinasImportadas(dados, limparExistentes = true) {
  if (limparExistentes) {
    banco.turmas.forEach(t => {
      t.disciplinas = [];
    });
  }

  (dados || []).forEach(l => {
    const turma = banco.turmas.find(
      t => chaveCanonicaTexto(t.nome) === chaveCanonicaTexto(l.turma)
    );
    if (!turma) return;

    const nomeDisc = String(l.disciplina || "").trim();
    if (!nomeDisc) return;

    const permiteSequencia = String(l.permite_sequencia || "")
      .toLowerCase()
      .trim()
      .match(/^(true|1|sim|yes)$/) !== null;

    const existente = turma.disciplinas.find(d =>
      chaveCanonicaTexto(d.nome) === chaveCanonicaTexto(nomeDisc)
    );

    if (existente) {
      existente.nome = nomeDisc;
      existente.aulas = Number(l.aulas) || 0;
      existente.agrupamento = Math.max(1, Number(l.agrupamento || 1));
      existente.permiteSequencia = permiteSequencia;
      return;
    }

    turma.disciplinas.push({
      nome: nomeDisc,
      aulas: Number(l.aulas) || 0,
      professor: null,
      agrupamento: Math.max(1, Number(l.agrupamento || 1)),
      permiteSequencia
    });
  });
}

function aplicarVinculosImportados(dados) {
  (dados || []).forEach(l => {
    const turma = banco.turmas.find(
      t => chaveCanonicaTexto(t.nome) === chaveCanonicaTexto(l.turma)
    );
    if (!turma) return;

    const professorEntrada = String(l.professor || "").trim();
    if (!professorEntrada) return;

    const professor = banco.professores.find(
      p => chaveCanonicaTexto(p.nome) === chaveCanonicaTexto(professorEntrada)
    );

    const nomeProfessor = professor ? professor.nome : professorEntrada;

    const disciplinas = String(l.disciplina || "")
      .split(";")
      .map(d => d.trim())
      .filter(d => d.length > 0);

    disciplinas.forEach(nomeDisc => {
      const disc = turma.disciplinas.find(d =>
        chaveCanonicaTexto(d.nome) === chaveCanonicaTexto(nomeDisc)
      );
      if (!disc) return;

      disc.professor = nomeProfessor;
    });
  });
}

function importarTurmasCSV(file) {
  lerCSV(file, dados => {
    aplicarTurmasImportadas(dados, true);

    salvar();
    atualizarSelects();
    alert("Turmas importadas com sucesso.");
  });
}

function importarProfessoresCSV(file) {
  lerCSV(file, dados => {
    aplicarProfessoresImportados(dados, true);

    salvar();
    atualizarSelects();
    atualizarMedidor();
    alert("Professores importados com sucesso.");
  });
}

function importarDisciplinasCSV(file) {
  lerCSV(file, dados => {
    aplicarDisciplinasImportadas(dados, true);

    salvar();
    alert("Disciplinas importadas.");
  });
}

function importarVinculosCSV(file) {
  lerCSV(file, dados => {
    aplicarVinculosImportados(dados);

    salvar();
    alert("Vínculos aplicados com sucesso.");
  });
}


function importarCSV(tipo, input) {
  const file = input.files[0];
  if (!file) return;

  if (tipo === "turmas") importarTurmasCSV(file);
  if (tipo === "professores") importarProfessoresCSV(file);
  if (tipo === "disciplinas") importarDisciplinasCSV(file);
  if (tipo === "vinculos") importarVinculosCSV(file);

  input.value = "";
}

function identificarTipoCSV(dados) {
  const primeiraLinha = dados?.[0];
  if (!primeiraLinha) return null;

  const colunas = Object.keys(primeiraLinha).map(c => chaveCanonicaTexto(c));
  const tem = nome => colunas.includes(chaveCanonicaTexto(nome));

  if (tem("turma") && tem("turno") && !tem("disciplina")) {
    return "turmas";
  }

  if (tem("nome") && tem("dias")) {
    return "professores";
  }

  if (tem("turma") && tem("disciplina") && tem("aulas")) {
    return "disciplinas";
  }

  if (tem("professor") && tem("turma") && tem("disciplina")) {
    return "vinculos";
  }

  return null;
}

async function importarPacoteCSV(input) {
  const files = Array.from(input.files || []);
  if (files.length === 0) return;

  const grupos = {
    turmas: [],
    professores: [],
    disciplinas: [],
    vinculos: []
  };

  const ignorados = [];

  for (const file of files) {
    const dados = await lerCSVComoPromise(file);
    const tipo = identificarTipoCSV(dados);

    if (!tipo) {
      ignorados.push(file.name);
      continue;
    }

    grupos[tipo].push(...dados);
  }

  if (
    grupos.turmas.length === 0 &&
    grupos.professores.length === 0 &&
    grupos.disciplinas.length === 0 &&
    grupos.vinculos.length === 0
  ) {
    alert("Nenhum CSV reconhecido no pacote.");
    input.value = "";
    return;
  }

  if (grupos.turmas.length > 0) aplicarTurmasImportadas(grupos.turmas, true);
  if (grupos.professores.length > 0) aplicarProfessoresImportados(grupos.professores, true);
  if (grupos.disciplinas.length > 0) aplicarDisciplinasImportadas(grupos.disciplinas, true);
  if (grupos.vinculos.length > 0) aplicarVinculosImportados(grupos.vinculos);

  normalizarRestricoes();
  inicializarHorariosIncremental();
  normalizarSlotsHorario();
  atualizarSelects();
  atualizarMedidor();
  recalcularAulasNaoAlocadas();
  salvar();
  mostrarTodosHorarios();
  renderizarAulasNaoAlocadas();

  const resumo = [
    `Turmas: ${grupos.turmas.length}`,
    `Professores: ${grupos.professores.length}`,
    `Disciplinas: ${grupos.disciplinas.length}`,
    `Vínculos: ${grupos.vinculos.length}`
  ];

  if (ignorados.length > 0) {
    resumo.push(`Ignorados: ${ignorados.join(", ")}`);
  }

  alert(`Pacote importado com sucesso.\n\n${resumo.join("\n")}`);
  input.value = "";
}

function validarCargaTurma(turma) {
  const total = turma.disciplinas.reduce(
    (s, d) => s + d.aulas,
    0
  );

  const capacidade = diasSemana.length * turnos[turma.turno];

  return {
    total,
    capacidade,
    ok: total <= capacidade
  };
}

// ===================================================
// CADASTRO DE PROFESSORES
// ===================================================

let professorEmEdicao = null;
let turmaEditorAtual = null;

function limparSlotAlocacao(slot) {
  slot.disciplina = null;
  slot.professor = null;
  slot.fixo = false;
  slot.conflito = false;
  slot.conflitos = [];
  slot.ajusteManual = false;
}

function limparAlocacoesInvalidasDaTurma(turma) {
  const mapaDisciplinas = new Map();
  (turma.disciplinas || []).forEach(d =>
    mapaDisciplinas.set(chaveCanonicaTexto(d.nome), d)
  );

  const slotsTurma = banco.horarios?.[turma.nome] || [];
  slotsTurma.forEach(slot => {
    if (!slot.disciplina) return;

    const disciplina = mapaDisciplinas.get(
      chaveCanonicaTexto(slot.disciplina)
    );

    if (!disciplina) {
      limparSlotAlocacao(slot);
      return;
    }

    // normaliza nome atual da disciplina (caso tenha sido editado)
    slot.disciplina = disciplina.nome;

    if (!disciplina.professor || slot.professor !== disciplina.professor) {
      limparSlotAlocacao(slot);
    }
  });
}

function carregarEditorTurma() {
  const select = el("editor-turma");
  const container = el("editor-disciplinas");
  if (!select || !container) return;

  turmaEditorAtual = banco.turmas.find(t => t.nome === select.value) || null;
  renderizarEditorTurma();
}

function renderizarEditorTurma() {
  const container = el("editor-disciplinas");
  if (!container) return;

  container.innerHTML = "";

  if (!turmaEditorAtual) {
    container.innerHTML = `<p class="nota-curta">Selecione uma turma para editar.</p>`;
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "editor-scroll";

  const table = document.createElement("table");
  table.className = "editor-table";

  const thead = document.createElement("thead");
  const trHead = document.createElement("tr");
  ["Disciplina", "Aulas", "Agrup.", "Professor (vínculo)", "Sequência", "Ações"]
    .forEach(titulo => {
      const th = document.createElement("th");
      th.textContent = titulo;
      trHead.appendChild(th);
    });
  thead.appendChild(trHead);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  if (!turmaEditorAtual.disciplinas || turmaEditorAtual.disciplinas.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "Nenhuma disciplina cadastrada nessa turma.";
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    turmaEditorAtual.disciplinas.forEach((disc, idx) => {
      const tr = document.createElement("tr");
      tr.dataset.editorIdx = idx;

      // Disciplina
      const tdNome = document.createElement("td");
      const inputNome = document.createElement("input");
      inputNome.type = "text";
      inputNome.value = disc.nome || "";
      inputNome.dataset.campo = "nome";
      tdNome.appendChild(inputNome);
      tr.appendChild(tdNome);

      // Aulas
      const tdAulas = document.createElement("td");
      const inputAulas = document.createElement("input");
      inputAulas.type = "number";
      inputAulas.min = "1";
      inputAulas.value = Number(disc.aulas || 1);
      inputAulas.dataset.campo = "aulas";
      tdAulas.appendChild(inputAulas);
      tr.appendChild(tdAulas);

      // Agrupamento
      const tdAgr = document.createElement("td");
      const inputAgr = document.createElement("input");
      inputAgr.type = "number";
      inputAgr.min = "1";
      inputAgr.value = Number(disc.agrupamento || 1);
      inputAgr.dataset.campo = "agrupamento";
      tdAgr.appendChild(inputAgr);
      tr.appendChild(tdAgr);

      // Professor
      const tdProf = document.createElement("td");
      const selectProf = document.createElement("select");
      selectProf.dataset.campo = "professor";

      const optSem = document.createElement("option");
      optSem.value = "";
      optSem.textContent = "-- Sem vínculo --";
      selectProf.appendChild(optSem);

      banco.professores.forEach(prof => {
        const opt = document.createElement("option");
        opt.value = prof.nome;
        opt.textContent = prof.nome;
        selectProf.appendChild(opt);
      });

      selectProf.value = disc.professor || "";
      if (selectProf.value !== (disc.professor || "")) {
        selectProf.value = "";
      }
      tdProf.appendChild(selectProf);
      tr.appendChild(tdProf);

      // Permite sequência
      const tdSeq = document.createElement("td");
      const inputSeq = document.createElement("input");
      inputSeq.type = "checkbox";
      inputSeq.checked = Boolean(disc.permiteSequencia);
      inputSeq.dataset.campo = "permite";
      tdSeq.className = "editor-centro";
      tdSeq.appendChild(inputSeq);
      tr.appendChild(tdSeq);

      // Ações
      const tdAcao = document.createElement("td");
      tdAcao.className = "editor-centro";
      const btnExcluir = document.createElement("button");
      btnExcluir.type = "button";
      btnExcluir.className = "perigo";
      btnExcluir.textContent = "Remover";
      btnExcluir.onclick = () => removerDisciplinaEditor(idx);
      tdAcao.appendChild(btnExcluir);
      tr.appendChild(tdAcao);

      tbody.appendChild(tr);
    });
  }

  table.appendChild(tbody);
  wrapper.appendChild(table);
  container.appendChild(wrapper);
}

function adicionarLinhaEditorDisciplina() {
  if (!turmaEditorAtual) {
    alert("Selecione uma turma para editar.");
    return;
  }

  if (!Array.isArray(turmaEditorAtual.disciplinas)) {
    turmaEditorAtual.disciplinas = [];
  }

  turmaEditorAtual.disciplinas.push({
    nome: "",
    aulas: 1,
    professor: null,
    agrupamento: 1,
    permiteSequencia: false
  });

  renderizarEditorTurma();
}

function removerDisciplinaEditor(index) {
  if (!turmaEditorAtual) return;
  turmaEditorAtual.disciplinas.splice(index, 1);
  renderizarEditorTurma();
}

function salvarEditorTurma() {
  const container = el("editor-disciplinas");
  if (!turmaEditorAtual || !container) {
    alert("Selecione uma turma para editar.");
    return;
  }

  const linhas = [...container.querySelectorAll("tr[data-editor-idx]")];
  const novasDisciplinas = [];

  for (const linha of linhas) {
    const nome = linha.querySelector("[data-campo='nome']")?.value.trim();
    if (!nome) continue;

    const aulas = Number(linha.querySelector("[data-campo='aulas']")?.value);
    const agrupamento = Number(linha.querySelector("[data-campo='agrupamento']")?.value || 1);
    const professor = linha.querySelector("[data-campo='professor']")?.value.trim() || null;
    const permiteSequencia = Boolean(
      linha.querySelector("[data-campo='permite']")?.checked
    );

    if (!Number.isFinite(aulas) || aulas <= 0) {
      alert(`Disciplina "${nome}": informe um número de aulas válido.`);
      return;
    }

    if (!Number.isFinite(agrupamento) || agrupamento <= 0) {
      alert(`Disciplina "${nome}": agrupamento inválido.`);
      return;
    }

    if (aulas % agrupamento !== 0) {
      alert(`Disciplina "${nome}": aulas incompatíveis com agrupamento.`);
      return;
    }

    novasDisciplinas.push({
      nome,
      aulas,
      professor,
      agrupamento,
      permiteSequencia
    });
  }

  turmaEditorAtual.disciplinas = novasDisciplinas;

  inicializarHorariosIncremental();
  normalizarSlotsHorario();
  limparAlocacoesInvalidasDaTurma(turmaEditorAtual);
  reavaliarConflitos();
  recalcularAulasNaoAlocadas();
  atualizarMedidor();
  atualizarSelects();
  salvar();
  mostrarTodosHorarios();
  renderizarAulasNaoAlocadas();

  alert(`Turma ${turmaEditorAtual.nome} atualizada com sucesso.`);
}

function carregarProfessorParaEdicao() {
  const nome = el("prof-editar").value;
  professorEmEdicao = banco.professores.find(p => p.nome === nome);

  if (!professorEmEdicao) {
    limparFormularioProfessor();
    return;
  }

  // nome
  el("prof-nome").value = professorEmEdicao.nome;

  // dias
  document.querySelectorAll("input[name='prof-dias']").forEach(cb => {
    cb.checked = professorEmEdicao.dias.includes(cb.value);
  });

  // restrições por turno
  el("prof-proibidas-m").value =
    professorEmEdicao.restricoes?.aulasProibidas?.M?.join(",") || "";

  el("prof-proibidas-v").value =
    professorEmEdicao.restricoes?.aulasProibidas?.V?.join(",") || "";

  el("prof-proibidas-i").value =
    professorEmEdicao.restricoes?.aulasProibidas?.I?.join(",") || "";

  el("prof-proibidas-emr").value =
    professorEmEdicao.restricoes?.aulasProibidas?.EMR?.join(",") || "";

  el("prof-aulas-preferidas").value =
    professorEmEdicao.preferencias?.aulasPreferidas?.join(",") || "";
}
function limparFormularioProfessor() {
  professorEmEdicao = null;
  el("prof-nome").value = "";
  el("prof-proibidas-m").value = "";
  el("prof-proibidas-v").value = "";
  el("prof-proibidas-i").value = "";
  el("prof-proibidas-emr").value = "";
  el("prof-aulas-preferidas").value = "";

  document.querySelectorAll("input[name='prof-dias']").forEach(cb => {
    cb.checked = false;
  });
}


function parseLista(id) {
  return el(id)?.value
    .split(",")
    .map(n => Number(n.trim()))
    .filter(n => !isNaN(n)) || [];
}

function salvarProfessor() {
  const nome = el("prof-nome").value.trim();
  const dias = [...document.querySelectorAll("input[name='prof-dias']:checked")]
    .map(c => c.value);

  if (!nome || dias.length === 0) {
    alert("Informe nome e dias disponíveis.");
    return;
  }

  const proibidasM = parseLista("prof-proibidas-m");
  const proibidasV = parseLista("prof-proibidas-v");
  const proibidasI = parseLista("prof-proibidas-i");
  const proibidasEMR = parseLista("prof-proibidas-emr");
  const aulasPreferidas = parseLista("prof-aulas-preferidas");

  const dados = {
    nome,
    dias,
    restricoes: {
      aulasProibidas: {
        M: proibidasM,
        V: proibidasV,
        I: proibidasI,
        EMR: proibidasEMR
      }
    },
    preferencias: {
      aulasPreferidas,
      pesoPreferencia: 2
    }
  };

  if (professorEmEdicao) {
    // 🔁 ATUALIZA professor existente
    Object.assign(professorEmEdicao, dados);
  } else {
    // ➕ NOVO professor
    banco.professores.push(dados);
  }

  salvar();
  atualizarSelects();
  atualizarMedidor();
  limparFormularioProfessor();
}


// ===================================================
// CADASTRO DE TURMAS E DISCIPLINAS
// ===================================================
function cadastrarTurma() {
  const nome = el("turma-nome").value.trim();
  const turno = el("turma-turno").value;
  if (!nome) return alert("Informe o nome da turma.");

  banco.turmas.push({ nome, turno, disciplinas: [] });
  salvar();
  atualizarSelects();
}

function adicionarDisciplina() {
  const turmaNome = el("disc-turma").value;
  const nome = el("disc-nome").value.trim();
  const aulas = Number(el("disc-aulas").value);
  const professor = el("disc-professor").value;
  const agrupamento = Number(el("disc-agrupamento").value || 1);

  if (!turmaNome || !nome || !aulas)
    return alert("Dados incompletos.");

  if (aulas % agrupamento !== 0)
    return alert("Aulas incompatíveis com o agrupamento.");

  const turma = banco.turmas.find(t => t.nome === turmaNome);
  turma.disciplinas.push({
    nome,
    aulas,
    professor: professor || null,
    agrupamento,
    permiteSequencia: false
  });

  salvar();
  atualizarSelects();
  atualizarVinculoRapidoDisciplinas();
  if (turmaEditorAtual?.nome === turmaNome) {
    renderizarEditorTurma();
  }
  atualizarMedidor();
}

function atualizarVinculoRapidoDisciplinas() {
  const selTurma = el("vinculo-turma");
  const selDisc = el("vinculo-disciplina");
  const status = el("vinculo-estado");

  if (!selTurma || !selDisc) return;

  const turma = banco.turmas.find(t => t.nome === selTurma.value);
  const valorAnterior = selDisc.value;

  if (!turma || !Array.isArray(turma.disciplinas) || turma.disciplinas.length === 0) {
    selDisc.innerHTML = `<option value="">-- Sem disciplinas --</option>`;
    if (status) status.textContent = "Selecione uma turma com disciplinas para vincular.";
    return;
  }

  selDisc.innerHTML = turma.disciplinas
    .map(d => `<option value="${d.nome}">${d.nome}</option>`)
    .join("");

  if (turma.disciplinas.some(d => d.nome === valorAnterior)) {
    selDisc.value = valorAnterior;
  } else {
    selDisc.value = turma.disciplinas[0].nome;
  }

  atualizarStatusVinculoRapido();
}

function atualizarStatusVinculoRapido() {
  const status = el("vinculo-estado");
  const selTurma = el("vinculo-turma");
  const selDisc = el("vinculo-disciplina");

  if (!status || !selTurma || !selDisc) return;

  const turma = banco.turmas.find(t => t.nome === selTurma.value);
  const disc = turma?.disciplinas?.find(d => d.nome === selDisc.value);

  if (!disc) {
    status.textContent = "Selecione turma e disciplina.";
    return;
  }

  status.textContent = disc.professor
    ? `Vínculo atual: ${disc.professor}`
    : "Vínculo atual: sem professor.";
}

function aplicarVinculoRapido() {
  const selTurma = el("vinculo-turma");
  const selDisc = el("vinculo-disciplina");
  const selProf = el("vinculo-professor");

  if (!selTurma || !selDisc || !selProf) {
    alert("Editor de vínculo não disponível nesta página.");
    return;
  }

  const turma = banco.turmas.find(t => t.nome === selTurma.value);
  if (!turma) {
    alert("Turma não encontrada.");
    return;
  }

  const disc = turma.disciplinas.find(d => d.nome === selDisc.value);
  if (!disc) {
    alert("Disciplina não encontrada na turma selecionada.");
    return;
  }

  disc.professor = selProf.value || null;

  inicializarHorariosIncremental();
  normalizarSlotsHorario();
  limparAlocacoesInvalidasDaTurma(turma);
  reavaliarConflitos();
  recalcularAulasNaoAlocadas();
  atualizarMedidor();
  atualizarStatusVinculoRapido();
  atualizarSelects();
  if (turmaEditorAtual?.nome === turma.nome) {
    renderizarEditorTurma();
  }

  salvar();
  mostrarTodosHorarios();
  renderizarAulasNaoAlocadas();

  alert("Vínculo atualizado.");
}

// ===================================================
// MEDIDOR (DIAGNÓSTICO)
// ===================================================
function calcularCargaProfessor(nome) {
  let total = 0;
  banco.turmas.forEach(t =>
    t.disciplinas.forEach(d => {
      if (d.professor === nome) total += d.aulas;
    })
  );
  return total;
}

function diasMinimosRecomendados(total) {
  if (total >= 32) return 4;
  if (total >= 16) return 3;
  if (total <= 5) return 1;
  return 1
}

function atualizarMedidor() {
  const div = el("medidor");
  if (!div) return;
  div.innerHTML = "";

  banco.professores.forEach(p => {
    const total = calcularCargaProfessor(p.nome);
    const diasDisp = p.dias.length;
    const min = diasMinimosRecomendados(total);

    let classe = "verde";
    let status = "OK";
    if (diasDisp < min) { classe = "vermelho"; status = "Crítico"; }
    else if (diasDisp === min) { classe = "amarelo"; status = "Limite"; }

    div.innerHTML += `
      <div class="medidor-item ${classe}">
        <strong>${p.nome}</strong><br>
        Aulas: ${total} | Dias: ${diasDisp} | Min: ${min} → ${status}
      </div>`;
  });
}

// ===================================================
// INICIALIZAÇÃO DOS HORÁRIOS
// ===================================================
function inicializarHorarios() {
  banco.horarios = {};
  banco.turmas.forEach(turma => {
    banco.horarios[turma.nome] = [];
    diasSemana.forEach(dia => {
      for (let aula = 1; aula <= turnos[turma.turno]; aula++) {
        banco.horarios[turma.nome].push({
          dia,
          aula,
          turno: turma.turno,
          faixa: faixaGlobal(turma.turno, aula),
          disciplina: null,
          professor: null,
          fixo: false,

          // 🚨 CONTROLE DE CONFLITO
          conflito: false,
          conflitos: [],
          ajusteManual: false
        }
        );

      }
    });
  });
}

function prepararHorarioVazio() {
  // 1. cria TODOS os slots vazios
  inicializarHorarios();

  // 2. limpa listas
  aulasNaoAlocadas = [];
  relatorioFalhas = [];

  // 3. transforma disciplinas em aulas pendentes
  banco.turmas.forEach(turma => {
    turma.disciplinas.forEach(disc => {
      if (!disc.professor) return;

      aulasNaoAlocadas.push({
        turma: turma.nome,
        disciplina: disc.nome,
        professor: disc.professor,
        faltam: disc.aulas
      });
    });
  });

  salvar();
  mostrarTodosHorarios();
  renderizarAulasNaoAlocadas();
}

function recalcularAulasNaoAlocadas() {
  aulasNaoAlocadas = [];

  banco.turmas.forEach(turma => {
    turma.disciplinas.forEach(disc => {
      if (!disc.professor) return;

      const alocadas = banco.horarios[turma.nome].filter(s =>
        s.disciplina === disc.nome &&
        s.professor === disc.professor
      ).length;

      const faltam = disc.aulas - alocadas;

      if (faltam > 0) {
        aulasNaoAlocadas.push({
          turma: turma.nome,
          disciplina: disc.nome,
          professor: disc.professor,
          faltam
        });
      }
    });
  });
}



function inicializarHorariosIncremental() {
  // se não existe OU se não tem esta turma, inicializa tudo
  if (
    !banco.horarios ||
    Object.keys(banco.horarios).length === 0
  ) {
    inicializarHorarios();
    return;
  }

  // garante que TODAS as turmas tenham slots
  banco.turmas.forEach(turma => {
    if (!banco.horarios[turma.nome] ||
      banco.horarios[turma.nome].length === 0) {

      banco.horarios[turma.nome] = [];
      diasSemana.forEach(dia => {
        for (let aula = 1; aula <= turnos[turma.turno]; aula++) {
          banco.horarios[turma.nome].push({
            dia,
            aula,
            turno: turma.turno,
            faixa: faixaGlobal(turma.turno, aula),
            disciplina: null,
            professor: null,
            fixo: false,
            conflito: false,
            conflitos: [],
            ajusteManual: false
          });

        }
      });
    }
  });
}

function normalizarSlotsHorario() {
  if (!banco.horarios) return;

  Object.values(banco.horarios).forEach(slots => {
    slots.forEach(slot => {
      if (!Array.isArray(slot.conflitos)) slot.conflitos = [];
      if (typeof slot.conflito !== "boolean") slot.conflito = false;
      if (typeof slot.ajusteManual !== "boolean") slot.ajusteManual = false;
      if (typeof slot.fixo !== "boolean") slot.fixo = false;
    });
  });
}


function slotDisponivel(slot) {
  return !slot.professor && !slot.fixo;
}


// ===================================================
// REGRAS
// ===================================================
function professorLivre(nome, dia, faixa, ignorarSlot = null) {
  return !Object.values(banco.horarios).flat().some(s =>
    s !== ignorarSlot &&
    s.professor === nome &&
    s.dia === dia &&
    s.faixa === faixa
  );
}

function disciplinaJaNoDia(turma, dia, disciplina) {
  return banco.horarios[turma]
    .some(s =>
      s.dia === dia &&
      s.disciplina === disciplina
    );
}



function aulaPermitidaPorNivel(professor, aula, turno, nivel) {
  if (nivel !== 1) return true;

  const restricoes = professor.restricoes?.aulasProibidas;
  if (!restricoes) return true;

  const proibidasNoTurno = restricoes[turno] || [];
  return !proibidasNoTurno.includes(aula);
}

function contarAulasNoDia(nome, turma, dia) {
  return banco.horarios[turma]
    .filter(s => s.professor === nome && s.dia === dia).length;
}

// ===================================================
// HEURÍSTICA
// ===================================================
function distanciaParaProximaAulaProfessor(professorNome, dia, aula) {
  const aulasNoDia = Object.values(banco.horarios)
    .flat()
    .filter(s =>
      s.professor === professorNome &&
      s.dia === dia
    )
    .map(s => s.aula);

  if (aulasNoDia.length === 0) return 0;

  return Math.min(
    ...aulasNoDia.map(a => Math.abs(a - aula))
  );
}



function pesoContinuidadeProfessor(professor) {
  const dias = professor.dias.length;

  if (dias <= 2) return 5;  // professor muito restrito
  if (dias === 3) return 3;
  if (dias === 4) return 2;
  return 1; // bem flexível
}


function pontuacaoSlotPorNivel(slot, professor, turma, nivel, disciplina) {
  let score = 0;

  // ⭐ preferência de aula
  if (
    nivel === 1 &&
    professor.preferencias?.aulasPreferidas?.includes(slot.aula)
  ) {
    score += professor.preferencias.pesoPreferencia || 1;
  }

  // 🔁 penaliza repetir disciplina no mesmo dia
  if (
    !professor.preferencias?.permiteSequencia &&
    disciplinaJaNoDia(turma, slot.dia, disciplina)
  ) {
    score -= 5; // penalidade forte
  }

  // 📉 evita concentrar aulas do mesmo professor no dia
  score -= contarAulasNoDia(professor.nome, turma, slot.dia);

  // 🎲 desempate aleatório leve
  // 🔗 continuidade do professor (evita aulas picadas)
  const distancia = distanciaParaProximaAulaProfessor(
    professor.nome,
    slot.dia,
    slot.aula
  );

  if (distancia > 0) {
    const peso = pesoContinuidadeProfessor(professor);

    // penalidade NÃO linear (cresce rápido)
    score -= Math.pow(distancia, 2) * peso;
  }

  // bônus forte para aulas coladas
  if (distancia === 1) {
    score += 3;
  }


  return score;
}


function filtrarPorPreferencia(candidatos, professor, nivel) {
  const prefs = professor.preferencias?.aulasPreferidas;

  // se não há preferências, retorna tudo
  if (!prefs || prefs.length === 0) return candidatos;

  // nível estrito: preferência é quase obrigatória
  if (nivel === 1) {
    const preferenciais = candidatos.filter(s =>
      prefs.includes(s.aula)
    );

    // se existir pelo menos um slot preferencial, usa SÓ eles
    if (preferenciais.length > 0) {
      return preferenciais;
    }
  }

  // níveis mais flexíveis: retorna tudo
  return candidatos;
}


// ===================================================
// PESO DE RESTRIÇÃO DO PROFESSOR
// ===================================================
function pesoRestricaoProfessor(professor) {
  // 🔒 BLINDAGEM ABSOLUTA
  if (!professor) return 9999;
  // professor inexistente = extremamente restrito

  const dias = professor.dias?.length || 0;

  const proibidasM = professor.restricoes?.aulasProibidas?.M?.length || 0;
  const proibidasV = professor.restricoes?.aulasProibidas?.V?.length || 0;
  const proibidasI = professor.restricoes?.aulasProibidas?.I?.length || 0;
  const proibidasEMR = professor.restricoes?.aulasProibidas?.EMR?.length || 0;

  const totalProibidas =
    proibidasM + proibidasV + proibidasI + proibidasEMR;

  const carga = calcularCargaProfessor(professor.nome);

  // peso maior = MAIS difícil de alocar
  return (
    (10 - dias) * 5 +     // poucos dias pesa muito
    totalProibidas * 3 +  // muitas aulas proibidas
    carga * 0.5           // carga alta
  );
}




// ===================================================
// GERAÇÃO (BUSCA COM MÚLTIPLAS TENTATIVAS)
// ===================================================
function clonarHorarios(horarios) {
  return JSON.parse(JSON.stringify(horarios || {}));
}

function chaveDiaAula(dia, aula) {
  return `${dia}|${aula}`;
}

function chaveProfessorFaixa(nome, dia, faixa) {
  return `${nome}|${dia}|${faixa}`;
}

function chaveProfessorDia(nome, dia) {
  return `${nome}|${dia}`;
}

function chaveProfessorTurmaDia(nome, turma, dia) {
  return `${nome}|${turma}|${dia}`;
}

function chaveDisciplinaDia(turma, disciplina, dia) {
  return `${turma}|${disciplina}|${dia}`;
}

function alterarMapaContador(mapa, chave, delta) {
  const atual = mapa.get(chave) || 0;
  const proximo = atual + delta;

  if (proximo <= 0) {
    mapa.delete(chave);
    return;
  }

  mapa.set(chave, proximo);
}

function registrarSlotNoEstado(estado, turmaNome, slot, delta) {
  if (slot.professor) {
    alterarMapaContador(
      estado.profFaixa,
      chaveProfessorFaixa(slot.professor, slot.dia, slot.faixa),
      delta
    );

    alterarMapaContador(
      estado.profDia,
      chaveProfessorDia(slot.professor, slot.dia),
      delta
    );

    alterarMapaContador(
      estado.profTurmaDia,
      chaveProfessorTurmaDia(slot.professor, turmaNome, slot.dia),
      delta
    );
  }

  if (slot.disciplina) {
    alterarMapaContador(
      estado.discDia,
      chaveDisciplinaDia(turmaNome, slot.disciplina, slot.dia),
      delta
    );
  }
}

function construirEstadoBusca(horariosBase) {
  const horarios = clonarHorarios(horariosBase);

  const estado = {
    horarios,
    slotPorTurma: {},
    profFaixa: new Map(),
    profDia: new Map(),
    profTurmaDia: new Map(),
    discDia: new Map()
  };

  for (const turmaNome of Object.keys(horarios)) {
    const mapa = new Map();
    estado.slotPorTurma[turmaNome] = mapa;

    for (const slot of horarios[turmaNome]) {
      mapa.set(chaveDiaAula(slot.dia, slot.aula), slot);

      if (slot.professor || slot.disciplina) {
        registrarSlotNoEstado(estado, turmaNome, slot, +1);
      }
    }
  }

  return estado;
}

function clonarAlocacoes(alocacoes) {
  return alocacoes.map(a => ({
    taskIndex: a.taskIndex,
    slots: a.slots.map(s => ({ dia: s.dia, aula: s.aula })),
    penalidade: a.penalidade || 0
  }));
}

function encontrarSlot(estado, turmaNome, dia, aula) {
  return estado.slotPorTurma[turmaNome]?.get(chaveDiaAula(dia, aula)) || null;
}

function professorTemAdjacencia(estado, tarefa, dia, aulaInicial) {
  for (let i = 0; i < tarefa.len; i++) {
    const faixa = faixaGlobal(tarefa.turno, aulaInicial + i);
    if (faixa == null) continue;

    const antes = estado.profFaixa.get(
      chaveProfessorFaixa(tarefa.professor, dia, faixa - 1)
    ) || 0;

    const depois = estado.profFaixa.get(
      chaveProfessorFaixa(tarefa.professor, dia, faixa + 1)
    ) || 0;

    if (antes > 0 || depois > 0) {
      return true;
    }
  }

  return false;
}

function calcularScoreCandidato(estado, tarefa, dia, aulaInicial, penalidadeRegras) {
  const professorNome = tarefa.professor;
  const cargaDia = estado.profDia.get(chaveProfessorDia(professorNome, dia)) || 0;
  const cargaTurmaDia = estado.profTurmaDia.get(
    chaveProfessorTurmaDia(professorNome, tarefa.turma, dia)
  ) || 0;

  let score = 0;

  if (tarefa.preferidasSet?.has(aulaInicial)) {
    score += tarefa.pesoPreferencia;
  }

  score -= cargaDia * 1.6;
  score -= cargaTurmaDia * 2.5;

  if (professorTemAdjacencia(estado, tarefa, dia, aulaInicial)) {
    score += 2.5;
  } else if (cargaDia > 0) {
    score -= 1.5;
  }

  score -= penalidadeRegras;
  score += random() * 0.25;

  return score;
}

function gerarCandidatosParaTarefa(estado, tarefa, nivel, limite) {
  const candidatos = [];
  const slotsTurma = estado.horarios[tarefa.turma] || [];
  const maxAulasTurno = turnos[tarefa.turno];

  for (const slotInicial of slotsTurma) {
    if (!slotDisponivel(slotInicial)) continue;
    if (!tarefa.diasDisponiveisSet?.has(slotInicial.dia)) continue;
    if (slotInicial.aula + tarefa.len - 1 > maxAulasTurno) continue;

    const coordenadas = [];
    let valido = true;

    for (let i = 0; i < tarefa.len; i++) {
      const aulaAtual = slotInicial.aula + i;
      const slot = encontrarSlot(estado, tarefa.turma, slotInicial.dia, aulaAtual);

      if (!slot || !slotDisponivel(slot)) {
        valido = false;
        break;
      }

      if (!aulaPermitidaPorNivel(tarefa.professorObj, aulaAtual, tarefa.turno, 1)) {
        valido = false;
        break;
      }

      const faixa = faixaGlobal(tarefa.turno, aulaAtual);
      if (
        (estado.profFaixa.get(
          chaveProfessorFaixa(tarefa.professor, slotInicial.dia, faixa)
        ) || 0) > 0
      ) {
        valido = false;
        break;
      }

      coordenadas.push({ dia: slotInicial.dia, aula: aulaAtual });
    }

    if (!valido) continue;

    const repeticoesNoDia =
      estado.discDia.get(
        chaveDisciplinaDia(tarefa.turma, tarefa.disciplina, slotInicial.dia)
      ) || 0;

    let penalidadeRegras = 0;

    if (!tarefa.permiteSequencia && repeticoesNoDia > 0) {
      if (nivel === 1) continue;
      penalidadeRegras += repeticoesNoDia * (nivel === 2 ? 10 : 4);
    }

    const score = calcularScoreCandidato(
      estado,
      tarefa,
      slotInicial.dia,
      slotInicial.aula,
      penalidadeRegras
    );

    candidatos.push({
      dia: slotInicial.dia,
      aula: slotInicial.aula,
      slots: coordenadas,
      penalidade: penalidadeRegras,
      score
    });
  }

  if (candidatos.length === 0) return candidatos;

  embaralhar(candidatos);
  candidatos.sort((a, b) => b.score - a.score);

  if (limite && candidatos.length > limite) {
    return candidatos.slice(0, limite);
  }

  return candidatos;
}

function aplicarCandidatoNoEstado(estado, tarefa, candidato) {
  for (const pos of candidato.slots) {
    const slot = encontrarSlot(estado, tarefa.turma, pos.dia, pos.aula);
    if (!slot) continue;

    slot.professor = tarefa.professor;
    slot.disciplina = tarefa.disciplina;
    registrarSlotNoEstado(estado, tarefa.turma, slot, +1);
  }
}

function desfazerCandidatoNoEstado(estado, tarefa, candidato) {
  for (const pos of candidato.slots) {
    const slot = encontrarSlot(estado, tarefa.turma, pos.dia, pos.aula);
    if (!slot) continue;

    registrarSlotNoEstado(estado, tarefa.turma, slot, -1);
    slot.professor = null;
    slot.disciplina = null;
  }
}

function reconstruirHorariosComAlocacoes(horariosBase, tarefas, alocacoes) {
  const estado = construirEstadoBusca(horariosBase);

  for (const alocacao of alocacoes) {
    const tarefa = tarefas[alocacao.taskIndex];
    aplicarCandidatoNoEstado(estado, tarefa, {
      slots: alocacao.slots,
      penalidade: alocacao.penalidade || 0
    });
  }

  return estado.horarios;
}

function construirTarefasPendentes(horariosBase) {
  const tarefas = [];
  const falhasBase = [];
  let totalAulasPendentes = 0;
  let contadorTarefa = 0;

  for (const turma of banco.turmas) {
    const slotsTurma = horariosBase[turma.nome] || [];

    const disciplinasOrdenadas = [...turma.disciplinas].sort((a, b) => {
      const pa = banco.professores.find(p => p.nome === a.professor) || null;
      const pb = banco.professores.find(p => p.nome === b.professor) || null;
      return pesoRestricaoProfessor(pb) - pesoRestricaoProfessor(pa);
    });

    for (const disc of disciplinasOrdenadas) {
      if (!disc.professor) {
        falhasBase.push({
          turma: turma.nome,
          disciplina: disc.nome,
          professor: "NÃO DEFINIDO",
          motivo: "Disciplina sem professor vinculado"
        });
        continue;
      }

      const professorObj = banco.professores.find(p => p.nome === disc.professor);
      if (!professorObj) {
        falhasBase.push({
          turma: turma.nome,
          disciplina: disc.nome,
          professor: disc.professor,
          motivo: "Professor não cadastrado no sistema"
        });
        continue;
      }

      const agrupamento = Math.max(1, Number(disc.agrupamento || 1));

      const aulasJaAlocadas = slotsTurma.filter(s =>
        s.disciplina === disc.nome &&
        s.professor === disc.professor
      ).length;

      let faltam = Math.max(0, disc.aulas - aulasJaAlocadas);
      if (faltam === 0) continue;

      if (disc.aulas % agrupamento !== 0) {
        falhasBase.push({
          turma: turma.nome,
          disciplina: disc.nome,
          professor: disc.professor,
          motivo: "Quantidade de aulas incompatível com o agrupamento"
        });
      }

      while (faltam >= agrupamento) {
        tarefas.push({
          id: ++contadorTarefa,
          turma: turma.nome,
          turno: turma.turno,
          disciplina: disc.nome,
          professor: disc.professor,
          professorObj,
          diasDisponiveisSet: new Set(professorObj.dias || []),
          len: agrupamento,
          permiteSequencia: Boolean(disc.permiteSequencia),
          preferidasSet: new Set(professorObj.preferencias?.aulasPreferidas || []),
          pesoPreferencia: professorObj.preferencias?.pesoPreferencia || 1,
          dificuldade:
            pesoRestricaoProfessor(professorObj) +
            agrupamento * 2 +
            (disc.permiteSequencia ? 0 : 4)
        });

        totalAulasPendentes += agrupamento;
        faltam -= agrupamento;
      }

      if (faltam > 0) {
        tarefas.push({
          id: ++contadorTarefa,
          turma: turma.nome,
          turno: turma.turno,
          disciplina: disc.nome,
          professor: disc.professor,
          professorObj,
          diasDisponiveisSet: new Set(professorObj.dias || []),
          len: faltam,
          permiteSequencia: true,
          preferidasSet: new Set(professorObj.preferencias?.aulasPreferidas || []),
          pesoPreferencia: professorObj.preferencias?.pesoPreferencia || 1,
          dificuldade: pesoRestricaoProfessor(professorObj) + faltam
        });

        totalAulasPendentes += faltam;
      }
    }
  }

  tarefas.sort((a, b) => b.dificuldade - a.dificuldade);

  return { tarefas, falhasBase, totalAulasPendentes };
}

function selecionarProximaTarefa({
  pendentes,
  tamanhoPendentes,
  estado,
  tarefas,
  nivel,
  maxCandidatos,
  limiteAnalise
}) {
  let taskPos = -1;
  let candidatosSelecionados = [];
  let menorQtd = Infinity;
  let maiorDificuldade = -Infinity;

  const analisarAte = Math.min(
    tamanhoPendentes,
    Math.max(1, limiteAnalise || tamanhoPendentes)
  );

  for (let pos = 0; pos < analisarAte; pos++) {
    const idx = pendentes[pos];
    const tarefa = tarefas[idx];
    const candidatos = gerarCandidatosParaTarefa(
      estado,
      tarefa,
      nivel,
      maxCandidatos
    );

    const qtd = candidatos.length;

    if (
      qtd < menorQtd ||
      (qtd === menorQtd && tarefa.dificuldade > maiorDificuldade)
    ) {
      taskPos = pos;
      candidatosSelecionados = candidatos;
      menorQtd = qtd;
      maiorDificuldade = tarefa.dificuldade;
    }

    if (menorQtd === 0) break;
  }

  if (taskPos < 0 && tamanhoPendentes > 0) {
    const idx = pendentes[0];
    return {
      taskPos: 0,
      candidatos: gerarCandidatosParaTarefa(
        estado,
        tarefas[idx],
        nivel,
        maxCandidatos
      )
    };
  }

  return {
    taskPos,
    candidatos: candidatosSelecionados
  };
}

function gerarSolucaoInicialGulosa({
  horariosBase,
  tarefas,
  nivel,
  seed,
  config
}) {
  setSeed(seed + 17);

  const estado = construirEstadoBusca(horariosBase);
  const alocacoes = [];
  let aulasAlocadas = 0;
  let penalidade = 0;

  for (let idx = 0; idx < tarefas.length; idx++) {
    const tarefa = tarefas[idx];
    const candidatos = gerarCandidatosParaTarefa(
      estado,
      tarefa,
      nivel,
      config.maxCandidatosPorTarefa
    );

    if (candidatos.length === 0) continue;

    const janela = Math.min(
      candidatos.length,
      Math.max(1, config.janelaAleatoriaGulosa || 1)
    );

    const escolhido = candidatos[Math.floor(random() * janela)];
    aplicarCandidatoNoEstado(estado, tarefa, escolhido);

    alocacoes.push({
      taskIndex: idx,
      slots: escolhido.slots,
      penalidade: escolhido.penalidade
    });

    aulasAlocadas += tarefa.len;
    penalidade += escolhido.penalidade;
  }

  return {
    aulasAlocadas,
    penalidade,
    alocacoes
  };
}

function executarBuscaComBacktracking({
  horariosBase,
  tarefas,
  totalAulasPendentes,
  nivel,
  seed,
  config
}) {
  setSeed(seed);

  const estado = construirEstadoBusca(horariosBase);
  const pendentes = tarefas.map((_, i) => i);
  const alocacoesAtuais = [];

  const melhor = {
    aulasAlocadas: 0,
    penalidade: Number.POSITIVE_INFINITY,
    alocacoes: []
  };

  const inicio = Date.now();
  let nosExplorados = 0;
  let limiteTempoAtingido = false;

  function atualizarMelhor(aulasAlocadas, penalidade, alocacoesBase = alocacoesAtuais) {
    if (
      aulasAlocadas > melhor.aulasAlocadas ||
      (
        aulasAlocadas === melhor.aulasAlocadas &&
        penalidade < melhor.penalidade
      )
    ) {
      melhor.aulasAlocadas = aulasAlocadas;
      melhor.penalidade = penalidade;
      melhor.alocacoes = clonarAlocacoes(alocacoesBase);
    }
  }

  const inicial = gerarSolucaoInicialGulosa({
    horariosBase,
    tarefas,
    nivel,
    seed,
    config
  });

  atualizarMelhor(inicial.aulasAlocadas, inicial.penalidade, inicial.alocacoes);

  function busca(tamanhoPendentes, aulasAlocadas, aulasRestantes, penalidadeAtual) {
    if (nosExplorados >= config.maxNos) return;
    if ((nosExplorados & 63) === 0) {
      if (Date.now() - inicio > config.maxTempoMs) {
        limiteTempoAtingido = true;
        return;
      }
    }

    nosExplorados++;
    atualizarMelhor(aulasAlocadas, penalidadeAtual);

    if (tamanhoPendentes === 0) return;

    if (aulasAlocadas + aulasRestantes <= melhor.aulasAlocadas) {
      return;
    }

    const escolha = selecionarProximaTarefa(
      {
        pendentes,
        tamanhoPendentes,
        estado,
        tarefas,
        nivel,
        maxCandidatos: config.maxCandidatosPorTarefa,
        limiteAnalise: config.limiteAnaliseTarefas
      }
    );

    if (escolha.taskPos < 0) return;

    const taskPos = escolha.taskPos;
    const taskIndex = pendentes[taskPos];
    const tarefa = tarefas[taskIndex];
    const ultimo = tamanhoPendentes - 1;

    [pendentes[taskPos], pendentes[ultimo]] =
      [pendentes[ultimo], pendentes[taskPos]];

    const novoTamanho = tamanhoPendentes - 1;
    const aulasRestantesSemTarefa = aulasRestantes - tarefa.len;

    if (escolha.candidatos.length > 0) {
      const limite = Math.min(config.maxRamificacao, escolha.candidatos.length);

      for (let i = 0; i < limite; i++) {
        const candidato = escolha.candidatos[i];

        aplicarCandidatoNoEstado(estado, tarefa, candidato);
        alocacoesAtuais.push({
          taskIndex,
          slots: candidato.slots,
          penalidade: candidato.penalidade
        });

        busca(
          novoTamanho,
          aulasAlocadas + tarefa.len,
          aulasRestantesSemTarefa,
          penalidadeAtual + candidato.penalidade
        );

        alocacoesAtuais.pop();
        desfazerCandidatoNoEstado(estado, tarefa, candidato);

        if (melhor.aulasAlocadas === totalAulasPendentes && melhor.penalidade === 0) {
          [pendentes[taskPos], pendentes[ultimo]] =
            [pendentes[ultimo], pendentes[taskPos]];
          return;
        }

        if (limiteTempoAtingido) {
          [pendentes[taskPos], pendentes[ultimo]] =
            [pendentes[ultimo], pendentes[taskPos]];
          return;
        }
      }
    }

    busca(
      novoTamanho,
      aulasAlocadas,
      aulasRestantesSemTarefa,
      penalidadeAtual + config.penalidadePorPulo
    );

    [pendentes[taskPos], pendentes[ultimo]] =
      [pendentes[ultimo], pendentes[taskPos]];
  }

  busca(pendentes.length, 0, totalAulasPendentes, 0);

  const horariosFinais = reconstruirHorariosComAlocacoes(
    horariosBase,
    tarefas,
    melhor.alocacoes
  );

  return {
    horarios: horariosFinais,
    aulasAlocadas: melhor.aulasAlocadas,
    totalAulasPendentes,
    penalidade: Number.isFinite(melhor.penalidade) ? melhor.penalidade : 0,
    pendentes: Math.max(0, totalAulasPendentes - melhor.aulasAlocadas),
    nosExplorados,
    limiteTempoAtingido
  };
}

function configBuscaPorNivel(nivel, totalTarefas) {
  const base = {
    1: {
      maxNos: 3200,
      maxTempoMs: 120,
      maxRamificacao: 4,
      maxCandidatosPorTarefa: 8,
      limiteAnaliseTarefas: 14,
      janelaAleatoriaGulosa: 2,
      penalidadePorPulo: 4
    },
    2: {
      maxNos: 4300,
      maxTempoMs: 150,
      maxRamificacao: 5,
      maxCandidatosPorTarefa: 10,
      limiteAnaliseTarefas: 16,
      janelaAleatoriaGulosa: 3,
      penalidadePorPulo: 3
    },
    3: {
      maxNos: 5200,
      maxTempoMs: 180,
      maxRamificacao: 6,
      maxCandidatosPorTarefa: 12,
      limiteAnaliseTarefas: 18,
      janelaAleatoriaGulosa: 4,
      penalidadePorPulo: 2
    }
  };

  const cfg = { ...base[nivel] };
  const fator =
    totalTarefas > 140 ? 0.45 :
      totalTarefas > 100 ? 0.55 :
        totalTarefas > 70 ? 0.7 :
          totalTarefas > 45 ? 0.85 : 1;

  cfg.maxNos = Math.max(1200, Math.floor(cfg.maxNos * fator));
  cfg.maxTempoMs = Math.max(70, Math.floor(cfg.maxTempoMs * fator));
  cfg.limiteAnaliseTarefas = Math.max(
    8,
    Math.floor(cfg.limiteAnaliseTarefas * (fator < 0.7 ? 0.85 : 1))
  );

  return cfg;
}

function planoTentativas(totalTarefas) {
  if (totalTarefas > 140) {
    return [
      { nivel: 1, tentativas: 2 },
      { nivel: 2, tentativas: 2 },
      { nivel: 3, tentativas: 2 }
    ];
  }

  if (totalTarefas > 100) {
    return [
      { nivel: 1, tentativas: 3 },
      { nivel: 2, tentativas: 2 },
      { nivel: 3, tentativas: 2 }
    ];
  }

  if (totalTarefas > 70) {
    return [
      { nivel: 1, tentativas: 4 },
      { nivel: 2, tentativas: 3 },
      { nivel: 3, tentativas: 2 }
    ];
  }

  if (totalTarefas > 45) {
    return [
      { nivel: 1, tentativas: 5 },
      { nivel: 2, tentativas: 3 },
      { nivel: 3, tentativas: 2 }
    ];
  }

  return [
    { nivel: 1, tentativas: 6 },
    { nivel: 2, tentativas: 4 },
    { nivel: 3, tentativas: 3 }
  ];
}

let ultimaEstimativaComplexidade = null;

function descreverEstimativaComplexidade(estimativa) {
  if (!estimativa) {
    return "Estimativa de complexidade ainda não calculada.";
  }

  const linhas = [
    `Complexidade estimada: ${estimativa.nivelComplexidade}`,
    `Nos previstos (total): ~${formatarNumeroBR(estimativa.nosEstimados)}`,
    `Tempo limite teorico: ~${(estimativa.tempoMaxMs / 1000).toFixed(1)}s`,
    `Tarefas pendentes: ${formatarNumeroBR(estimativa.tarefas)} (${formatarNumeroBR(estimativa.totalAulasPendentes)} aulas)`,
    `Carga da grade: ${formatarPercentual(estimativa.cargaRelativa)} da capacidade`,
    `Candidatos por tarefa (amostra): media ${estimativa.mediaCandidatos.toFixed(1)} | min ${estimativa.minCandidatos} | max ${estimativa.maxCandidatos}`,
    `Taxa de bloqueio na amostra: ${formatarPercentual(estimativa.taxaBloqueio)}`
  ];

  if (estimativa.falhasBaseQtd > 0) {
    linhas.push(`Alertas de dados: ${estimativa.falhasBaseQtd}`);
  }

  if (estimativa.turmasInviaveis.length > 0) {
    linhas.push("Turmas com carga acima da capacidade:");
    estimativa.turmasInviaveis.forEach(item => {
      linhas.push(`- ${item.turma}: ${item.total}/${item.capacidade}`);
    });
  }

  return linhas.join("\n");
}

function mostrarRelatorioComplexidade(estimativa = null, exibirAlerta = false) {
  const painel = el("relatorio-complexidade");
  const texto = descreverEstimativaComplexidade(estimativa);

  if (painel) {
    painel.textContent = texto;
    const riscoAlto = Boolean(estimativa) && (
      estimativa.turmasInviaveis.length > 0 ||
      estimativa.taxaBloqueio >= 0.35 ||
      estimativa.cargaRelativa > 1 ||
      estimativa.falhasBaseQtd > 0
    );
    painel.classList.toggle("painel-falhas-ativo", riscoAlto);
  }

  if (exibirAlerta || !painel) {
    alert(texto);
  }
}

function estimarComplexidadeBusca({
  horariosBase,
  tarefas,
  totalAulasPendentes,
  falhasBase = [],
  turmasInviaveis = []
}) {
  const capacidadeTotal = banco.turmas.reduce(
    (soma, turma) => soma + diasSemana.length * turnos[turma.turno],
    0
  );

  const cargaRelativa =
    capacidadeTotal > 0 ? totalAulasPendentes / capacidadeTotal : 0;

  if (turmasInviaveis.length > 0) {
    return {
      nivelComplexidade: "Inviavel",
      nosEstimados: 0,
      tempoMaxMs: 0,
      tarefas: tarefas.length,
      totalAulasPendentes,
      capacidadeTotal,
      cargaRelativa,
      mediaCandidatos: 0,
      minCandidatos: 0,
      maxCandidatos: 0,
      taxaBloqueio: 1,
      falhasBaseQtd: falhasBase.length,
      turmasInviaveis
    };
  }

  if (tarefas.length === 0 || totalAulasPendentes === 0) {
    return {
      nivelComplexidade: falhasBase.length > 0 ? "Bloqueada por dados" : "Sem pendencias",
      nosEstimados: 0,
      tempoMaxMs: 0,
      tarefas: tarefas.length,
      totalAulasPendentes,
      capacidadeTotal,
      cargaRelativa,
      mediaCandidatos: 0,
      minCandidatos: 0,
      maxCandidatos: 0,
      taxaBloqueio: 0,
      falhasBaseQtd: falhasBase.length,
      turmasInviaveis
    };
  }

  const tamanhoAmostra = Math.min(tarefas.length, 36);
  const estado = construirEstadoBusca(horariosBase);
  let somaCandidatos = 0;
  let minCandidatos = Number.POSITIVE_INFINITY;
  let maxCandidatos = 0;
  let bloqueadas = 0;

  for (let i = 0; i < tamanhoAmostra; i++) {
    const tarefa = tarefas[i];
    const qtd = gerarCandidatosParaTarefa(estado, tarefa, 1, 24).length;
    somaCandidatos += qtd;
    if (qtd < minCandidatos) minCandidatos = qtd;
    if (qtd > maxCandidatos) maxCandidatos = qtd;
    if (qtd === 0) bloqueadas++;
  }

  const mediaCandidatos = somaCandidatos / tamanhoAmostra;
  const taxaBloqueio = bloqueadas / tamanhoAmostra;
  const cobertura = clamp(mediaCandidatos / 8, 0, 1);
  const fatorRestricao = clamp(
    (1 - cobertura) * 0.55 + taxaBloqueio * 0.45,
    0,
    1
  );

  const plano = planoTentativas(tarefas.length);
  let nosEstimados = 0;
  let tempoMaxMs = 0;

  plano.forEach(etapa => {
    const cfg = configBuscaPorNivel(etapa.nivel, tarefas.length);
    const pressao = clamp(
      0.18 +
      clamp(cargaRelativa, 0, 1.35) * 0.42 +
      fatorRestricao * 0.40 +
      (etapa.nivel - 1) * 0.08,
      0.12,
      1
    );

    const nosPorTentativa = Math.round(
      cfg.maxNos * (0.35 + pressao * 0.65)
    );

    nosEstimados += nosPorTentativa * etapa.tentativas;
    tempoMaxMs += cfg.maxTempoMs * etapa.tentativas;
  });

  let nivelComplexidade = "Baixa";
  if (nosEstimados >= 42000) nivelComplexidade = "Muito alta";
  else if (nosEstimados >= 26000) nivelComplexidade = "Alta";
  else if (nosEstimados >= 14000) nivelComplexidade = "Media";

  return {
    nivelComplexidade,
    nosEstimados,
    tempoMaxMs,
    tarefas: tarefas.length,
    totalAulasPendentes,
    capacidadeTotal,
    cargaRelativa,
    mediaCandidatos,
    minCandidatos: Number.isFinite(minCandidatos) ? minCandidatos : 0,
    maxCandidatos,
    taxaBloqueio,
    falhasBaseQtd: falhasBase.length,
    turmasInviaveis
  };
}

function estimarComplexidadeGeracao(exibirAlerta = false) {
  inicializarHorariosIncremental();
  normalizarSlotsHorario();

  const turmasInviaveis = [];
  banco.turmas.forEach(turma => {
    const validacao = validarCargaTurma(turma);
    if (!validacao.ok) {
      turmasInviaveis.push({
        turma: turma.nome,
        total: validacao.total,
        capacidade: validacao.capacidade
      });
    }
  });

  const horariosBase = clonarHorarios(banco.horarios);
  const { tarefas, falhasBase, totalAulasPendentes } =
    construirTarefasPendentes(horariosBase);

  const estimativa = estimarComplexidadeBusca({
    horariosBase,
    tarefas,
    totalAulasPendentes,
    falhasBase,
    turmasInviaveis
  });

  ultimaEstimativaComplexidade = estimativa;
  mostrarRelatorioComplexidade(estimativa, exibirAlerta);
  return estimativa;
}

function gerarHorario() {
  relatorioFalhas = [];
  relatorioGeracao = { nivelUsado: null, ajustes: [] };

  const seedInput = Number(el("seed")?.value);
  const seedBase = Number.isFinite(seedInput) && seedInput > 0
    ? seedInput
    : Date.now();

  banco.seedBase = seedBase;

  for (const turma of banco.turmas) {
    const v = validarCargaTurma(turma);
    if (!v.ok) {
      alert(
        `Turma ${turma.nome} inviável:\n` +
        `Aulas: ${v.total} / Capacidade: ${v.capacidade}`
      );
      return;
    }
  }

  inicializarHorariosIncremental();

  const horariosBase = clonarHorarios(banco.horarios);
  const { tarefas, falhasBase, totalAulasPendentes } =
    construirTarefasPendentes(horariosBase);

  for (const falha of falhasBase) {
    registrarFalha(falha);
  }

  const estimativa = estimarComplexidadeBusca({
    horariosBase,
    tarefas,
    totalAulasPendentes,
    falhasBase
  });
  ultimaEstimativaComplexidade = estimativa;
  mostrarRelatorioComplexidade(estimativa, false);
  relatorioGeracao.ajustes.push(
    `Pre-analise: nos previstos ~${formatarNumeroBR(estimativa.nosEstimados)} (${estimativa.nivelComplexidade})`
  );

  if (totalAulasPendentes === 0) {
    relatorioGeracao.nivelUsado = "Sem pendências";
    recalcularAulasNaoAlocadas();
    reavaliarConflitos();
    salvar();
    mostrarTodosHorarios();
    renderizarAulasNaoAlocadas();
    mostrarRelatorioGeracao();
    mostrarRelatorioFalhas();
    return;
  }

  const plano = planoTentativas(tarefas.length);
  let melhorResultado = null;
  let tentativaGlobal = 0;
  const maxSemMelhoraPorEtapa = tarefas.length > 100 ? 1 : tarefas.length > 55 ? 2 : 3;

  for (const etapa of plano) {
    const config = configBuscaPorNivel(etapa.nivel, tarefas.length);
    let semMelhoraEtapa = 0;

    for (let tentativa = 1; tentativa <= etapa.tentativas; tentativa++) {
      tentativaGlobal++;
      const seedTentativa =
        seedBase +
        etapa.nivel * 100003 +
        tentativa * 7919 +
        tentativaGlobal * 3571;

      const resultado = executarBuscaComBacktracking({
        horariosBase,
        tarefas,
        totalAulasPendentes,
        nivel: etapa.nivel,
        seed: seedTentativa,
        config
      });

      relatorioGeracao.ajustes.push(
        `N${etapa.nivel} T${tentativa}: ` +
        `${resultado.totalAulasPendentes - resultado.pendentes}/${resultado.totalAulasPendentes} alocadas ` +
        `(pendentes: ${resultado.pendentes}, nós: ${resultado.nosExplorados}` +
        `${resultado.limiteTempoAtingido ? ", limite tempo" : ""})`
      );

      if (
        !melhorResultado ||
        resultado.pendentes < melhorResultado.pendentes ||
        (
          resultado.pendentes === melhorResultado.pendentes &&
          resultado.penalidade < melhorResultado.penalidade
        )
      ) {
        melhorResultado = {
          ...resultado,
          nivel: etapa.nivel,
          tentativa
        };
        semMelhoraEtapa = 0;
      } else {
        semMelhoraEtapa++;
      }

      if (melhorResultado.pendentes === 0 && melhorResultado.penalidade === 0) {
        break;
      }

      if (semMelhoraEtapa >= maxSemMelhoraPorEtapa) {
        break;
      }

      if (
        resultado.limiteTempoAtingido &&
        tarefas.length > 70 &&
        semMelhoraEtapa >= 1
      ) {
        break;
      }
    }

    if (melhorResultado?.pendentes === 0 && melhorResultado?.penalidade === 0) {
      break;
    }
  }

  if (!melhorResultado) {
    alert("❌ Não foi possível gerar um horário viável.");
    return;
  }

  banco.horarios = melhorResultado.horarios;
  relatorioGeracao.nivelUsado =
    `Nível ${melhorResultado.nivel} (tentativa ${melhorResultado.tentativa})`;

  recalcularAulasNaoAlocadas();
  reavaliarConflitos();

  for (const item of aulasNaoAlocadas) {
    registrarFalha({
      turma: item.turma,
      disciplina: item.disciplina,
      professor: item.professor,
      motivo: `${item.faltam} aula(s) não alocada(s)`
    });
  }

  salvar();
  mostrarTodosHorarios();
  renderizarAulasNaoAlocadas();

  mostrarRelatorioGeracao();
  mostrarRelatorioFalhas();
}

function gerarComNovaSeed() {
  banco.seedBase = Date.now(); // nova seed
  salvar();
  gerarHorario();
}

function gerarHorarioDoZero() {
  inicializarHorarios();
  gerarHorario();
}

// ===================================================
// CONGELAMENTO
// ===================================================
function congelarHorarioAtual() {
  Object.values(banco.horarios).flat().forEach(s => {
    if (s.professor) s.fixo = true;
  });
  salvar();
  alert("Horário congelado.");
}

// ===================================================
// RELATÓRIO
// ===================================================
function mostrarRelatorioGeracao() {
  const painel = el("relatorio-geracao");
  const nivel = relatorioGeracao?.nivelUsado || "Ainda não executado";
  let texto = `Modo: ${nivel}`;

  if (Array.isArray(relatorioGeracao.ajustes) && relatorioGeracao.ajustes.length > 0) {
    const ultimas = relatorioGeracao.ajustes.slice(-10);
    texto += `\n\nTentativas (${ultimas.length} últimas):\n${ultimas.join("\n")}`;
  }

  if (painel) {
    painel.textContent = texto;
    return;
  }

  alert(texto);
}

// ===================================================
// VISUALIZAÇÃO
// ===================================================
function mostrarTodosHorarios() {
  const container = el("horarios");
  if (!container) return;

  container.innerHTML = "";

  banco.turmas.forEach(turma => {

    // 🔹 container da página
    const pagina = document.createElement("div");
    pagina.className = "pagina-turma";

    // 🔹 título
    const titulo = document.createElement("h3");
    titulo.textContent = `Turma ${turma.nome}`;
    pagina.appendChild(titulo);

    // 🔹 tabela
    const table = document.createElement("table");
    table.className = "tabela-horario";

    // 🔹 colgroup (largura fixa – PDF friendly)
    const colgroup = document.createElement("colgroup");

    const colAula = document.createElement("col");
    colAula.style.width = "3cm";
    colgroup.appendChild(colAula);

    diasSemana.forEach(() => {
      const col = document.createElement("col");
      col.style.width = "4.5cm";
      colgroup.appendChild(col);
    });

    table.appendChild(colgroup);

    // 🔹 cabeçalho
    const thead = document.createElement("thead");
    const trHead = document.createElement("tr");

    const thAula = document.createElement("th");
    thAula.textContent = "Aula";
    trHead.appendChild(thAula);

    diasSemana.forEach(dia => {
      const th = document.createElement("th");
      th.textContent = dia;
      trHead.appendChild(th);
    });

    thead.appendChild(trHead);
    table.appendChild(thead);

    // 🔹 corpo
    const tbody = document.createElement("tbody");

    for (let aula = 1; aula <= turnos[turma.turno]; aula++) {
      const tr = document.createElement("tr");

      const tdAula = document.createElement("td");
      tdAula.textContent = `${aula}ª`;
      tr.appendChild(tdAula);

      diasSemana.forEach(dia => {
        const slot = banco.horarios[turma.nome]
          .find(s => s.dia === dia && s.aula === aula);

        const td = document.createElement("td");
        td.dataset.turma = turma.nome;
        td.dataset.dia = dia;
        td.dataset.aula = aula;

        td.classList.add("clicavel");

        td.ondragover = permitirDrop;
        td.ondrop = onDrop;

        if (slot?.disciplina) {
          td.classList.add("alocada");
          td.draggable = true;

          td.dataset.disciplina = slot.disciplina;
          td.dataset.professor = slot.professor;

          td.ondragstart = onDragStartAlocada;
          td.ondragend = onDragEndAlocada;
          td.onclick = onClickCelula;

          if (slot.ajusteManual) {
            td.classList.add("alocacao-manual");
          }

          // 🚨 CONFLITO VISUAL
          if (slot.conflito) {
            td.classList.add("conflito");
            if (slot.ajusteManual) {
              td.classList.add("conflito-manual");
            }

            if (Array.isArray(slot.conflitos) && slot.conflitos.length > 0) {
              td.title = slot.ajusteManual
                ? `Ajuste manual com conflito: ${slot.conflitos.join(" • ")}`
                : slot.conflitos.join(" • ");
            }
          }

          td.innerHTML = `
            ${slot.disciplina}<br>
            <small>${slot.professor}</small>
          `;
        } else {
          td.classList.add("vazio");
        }

        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    pagina.appendChild(table);
    container.appendChild(pagina);
  });
}



// ===================================================
// DESTAQUES (16 CORES)
// ===================================================
const CORES_DESTAQUE = Array.from({ length: 16 }, (_, i) => `destaque-${i}`);
let destaquesAtivos = {};

function destacarProfessor(celula) {
  const prof = celula.dataset.professor;
  if (!prof) return;

  if (destaquesAtivos[prof]) {
    removerDestaque(prof);
    return;
  }

  const cor = CORES_DESTAQUE.find(c => !Object.values(destaquesAtivos).includes(c));
  if (!cor) return alert("Limite de destaques.");

  destaquesAtivos[prof] = cor;
  document.querySelectorAll(`td[data-professor="${prof}"]`)
    .forEach(td => td.classList.add(cor, "destaque-borda"));
}

function removerDestaque(prof) {
  const cor = destaquesAtivos[prof];
  document.querySelectorAll(`td[data-professor="${prof}"]`)
    .forEach(td => td.classList.remove(cor, "destaque-borda"));
  delete destaquesAtivos[prof];
}

// ===================================================
// INTERFACE
// ===================================================
function exportarHorarioPDF() {
  const turmas = document.querySelectorAll(".pagina-turma");

  if (!turmas.length) {
    alert("Nenhum horário para exportar.");
    return;
  }

  const opt = {
    margin: [10, 10, 10, 10], // mm
    filename: "horario-escolar.pdf",
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: {
      scale: 2,
      useCORS: true
    },
    jsPDF: {
      unit: "mm",
      format: "a4",
      orientation: "landscape"
    }
  };

  const pdf = new html2pdf().set(opt);

  turmas.forEach((turma, index) => {
    if (index > 0) pdf.addPage();
    pdf.from(turma).toContainer().toCanvas().toPdf();
  });

  pdf.save();
}



function onDragStartAlocada(e) {
  const td = e.target;

  const payload = {
    tipo: "alocada",
    turma: td.dataset.turma,
    dia: td.dataset.dia,
    aula: Number(td.dataset.aula),
    disciplina: td.dataset.disciplina,
    professor: td.dataset.professor
  };

  e.dataTransfer.setData("application/json", JSON.stringify(payload));
}

function atualizarSelects() {
  // select de disciplinas
  const selDiscTurma = el("disc-turma");
  if (selDiscTurma) {
    selDiscTurma.innerHTML =
      banco.turmas.map(t => `<option>${t.nome}</option>`).join("");
  }

  const selDiscProf = el("disc-professor");
  if (selDiscProf) {
    selDiscProf.innerHTML =
      `<option value="">-- Sem vínculo --</option>` +
      banco.professores.map(p => `<option>${p.nome}</option>`).join("");
  }

  // select de edição de professor
  const selEdit = el("prof-editar");
  if (selEdit) {
    selEdit.innerHTML =
      `<option value="">-- Novo professor --</option>` +
      banco.professores
        .map(p => `<option value="${p.nome}">${p.nome}</option>`)
        .join("");
  }

  // selects de vínculo rápido
  const selVincTurma = el("vinculo-turma");
  if (selVincTurma) {
    const atual = selVincTurma.value;
    selVincTurma.innerHTML =
      banco.turmas.map(t => `<option value="${t.nome}">${t.nome}</option>`).join("");

    if (banco.turmas.some(t => t.nome === atual)) {
      selVincTurma.value = atual;
    } else if (banco.turmas.length > 0) {
      selVincTurma.value = banco.turmas[0].nome;
    }
  }

  const selVincProf = el("vinculo-professor");
  if (selVincProf) {
    const atual = selVincProf.value;
    selVincProf.innerHTML =
      `<option value="">-- Sem vínculo --</option>` +
      banco.professores
        .map(p => `<option value="${p.nome}">${p.nome}</option>`)
        .join("");

    if (banco.professores.some(p => p.nome === atual)) {
      selVincProf.value = atual;
    } else {
      selVincProf.value = "";
    }
  }

  atualizarVinculoRapidoDisciplinas();

  // select do editor de turma
  const selEditorTurma = el("editor-turma");
  if (selEditorTurma) {
    const atual = selEditorTurma.value;
    selEditorTurma.innerHTML =
      banco.turmas.map(t => `<option value="${t.nome}">${t.nome}</option>`).join("");

    if (banco.turmas.length === 0) {
      turmaEditorAtual = null;
      const container = el("editor-disciplinas");
      if (container) {
        container.innerHTML = `<p class="nota-curta">Cadastre uma turma para começar a editar.</p>`;
      }
      return;
    }

    if (banco.turmas.some(t => t.nome === atual)) {
      selEditorTurma.value = atual;
    } else {
      selEditorTurma.value = banco.turmas[0].nome;
    }

    carregarEditorTurma();
  }
}


function limparDados() {
  localStorage.clear();
  location.reload();
}

// ===================================================
// INIT
// ===================================================

function normalizarRestricoes() {
  banco.professores.forEach(p => {
    if (!p.restricoes) p.restricoes = {};
    if (!p.restricoes.aulasProibidas) p.restricoes.aulasProibidas = {};

    const r = p.restricoes.aulasProibidas;

    // formato antigo → novo
    if (Array.isArray(r)) {
      p.restricoes.aulasProibidas = {
        M: [...r],
        V: [...r],
        I: [...r],
        EMR: [...r]
      };
    }

    // formato parcial
    if (!p.restricoes.aulasProibidas.M)
      p.restricoes.aulasProibidas.M = [];

    if (!p.restricoes.aulasProibidas.V)
      p.restricoes.aulasProibidas.V = [];

    if (!p.restricoes.aulasProibidas.I)
      p.restricoes.aulasProibidas.I = [];

    if (!p.restricoes.aulasProibidas.EMR)
      p.restricoes.aulasProibidas.EMR = [];

    if (!p.preferencias) {
      p.preferencias = {
        aulasPreferidas: [],
        pesoPreferencia: 2
      };
    }

    if (!Array.isArray(p.preferencias.aulasPreferidas)) {
      p.preferencias.aulasPreferidas = [];
    }

    if (!p.preferencias.pesoPreferencia) {
      p.preferencias.pesoPreferencia = 2;
    }
  });
}

function mostrarRelatorioFalhas() {
  const painel = el("relatorio-falhas");

  if (relatorioFalhas.length === 0) {
    if (painel) {
      painel.textContent = "Sem pendências de alocação.";
      painel.classList.remove("painel-falhas-ativo");
      return;
    }
    alert("Horario gerado com sucesso, sem falhas.");
    return;
  }

  let texto = "Pendências encontradas:\n\n";

  relatorioFalhas.forEach(f => {
    texto +=
      `Turma: ${f.turma}\n` +
      `Disciplina: ${f.disciplina}\n` +
      `Professor: ${f.professor}\n` +
      `Motivo: ${f.motivo}\n\n`;
  });

  if (painel) {
    painel.textContent = texto.trim();
    painel.classList.add("painel-falhas-ativo");
    return;
  }

  alert(texto);
}

// ===================================================
// INTERFACE
// ===================================================
function avaliarMovimento(aula, turmaDest, diaDest, aulaDest) {
  const conflitos = [];

  const turma = banco.turmas.find(t => t.nome === turmaDest);
  const professor = banco.professores.find(p => p.nome === aula.professor);

  if (!professor.dias.includes(diaDest)) {
    conflitos.push("Professor não trabalha neste dia");
  }

  const faixa = faixaGlobal(turma.turno, aulaDest);
  if (!professorLivre(professor.nome, diaDest, faixa)) {
    conflitos.push("Professor já está alocado nessa faixa");
  }

  if (!aulaPermitidaPorNivel(professor, aulaDest, turma.turno, 1)) {
    conflitos.push("Aula proibida para o professor");
  }

  const disc = turma.disciplinas.find(d => d.nome === aula.disciplina);
  if (
    disc &&
    !disc.permiteSequencia &&
    disciplinaJaNoDia(turmaDest, diaDest, disc.nome)
  ) {
    conflitos.push("Disciplina repetida no mesmo dia");
  }

  return {
    ok: conflitos.length === 0,
    conflitos
  };
}

function reavaliarConflitos() {

  // 🔹 limpa TODOS os conflitos
  Object.values(banco.horarios).flat().forEach(slot => {
    if (typeof slot.ajusteManual !== "boolean") slot.ajusteManual = false;
    slot.conflito = false;
    slot.conflitos = [];
  });

  // 🔹 reavalia slot por slot
  Object.values(banco.horarios).flat().forEach(slot => {

    if (!slot.disciplina || !slot.professor) {
      slot.ajusteManual = false;
      return;
    }

    const turma = banco.turmas.find(t =>
      banco.horarios[t.nome].includes(slot)
    );
    if (!turma) return;

    const professor = banco.professores.find(p =>
      p.nome === slot.professor
    );
    if (!professor) return;

    // ❌ dia inválido
    if (!professor.dias.includes(slot.dia)) {
      slot.conflito = true;
      slot.conflitos.push("Professor não trabalha neste dia");
    }

    // ❌ aula proibida
    if (!aulaPermitidaPorNivel(professor, slot.aula, turma.turno, 1)) {
      slot.conflito = true;
      slot.conflitos.push("Aula proibida para o professor");
    }

    // ❌ professor duplicado na mesma faixa
    if (!professorLivre(professor.nome, slot.dia, slot.faixa, slot)) {
      slot.conflito = true;
      slot.conflitos.push("Professor em duas turmas no mesmo horário");
    }

    // ❌ disciplina duplicada no dia
    const disc = turma.disciplinas.find(d =>
      d.nome === slot.disciplina
    );

    if (
      disc &&
      !disc.permiteSequencia &&
      banco.horarios[turma.nome].filter(s =>
        s !== slot &&
        s.dia === slot.dia &&
        s.disciplina === slot.disciplina
      ).length > 0
    ) {
      slot.conflito = true;
      slot.conflitos.push("Disciplina repetida no mesmo dia");
    }

  });
}



function moverAulaAlocada(origem, turmaDest, diaDest, aulaDest) {

  const turmaOrig = origem.turma;
  const diaOrig = origem.dia;
  const aulaOrig = origem.aula;

  // mesmo lugar → ignora
  if (
    turmaOrig === turmaDest &&
    diaOrig === diaDest &&
    aulaOrig === aulaDest
  ) return;

  const slotOrig = banco.horarios[turmaOrig]
    .find(s => s.dia === diaOrig && s.aula === aulaOrig);

  const slotDest = banco.horarios[turmaDest]
    .find(s => s.dia === diaDest && s.aula === aulaDest);

  // 🔍 avalia (NÃO bloqueia)
  const resultado = avaliarMovimento(origem, turmaDest, diaDest, aulaDest);

  // 🔄 MOVE ou TROCA
  if (slotDest.disciplina) {
    // troca
    const tmp = {
      disciplina: slotDest.disciplina,
      professor: slotDest.professor,
      conflito: slotDest.conflito,
      conflitos: slotDest.conflitos,
      ajusteManual: slotDest.ajusteManual
    };

    slotDest.disciplina = slotOrig.disciplina;
    slotDest.professor = slotOrig.professor;
    slotDest.ajusteManual = Boolean(slotOrig.ajusteManual);

    slotOrig.disciplina = tmp.disciplina;
    slotOrig.professor = tmp.professor;
    slotOrig.ajusteManual = Boolean(tmp.ajusteManual);

    slotOrig.conflito = tmp.conflito || false;
    slotOrig.conflitos = tmp.conflitos || [];
  } else {
    // move simples
    slotDest.disciplina = slotOrig.disciplina;
    slotDest.professor = slotOrig.professor;
    slotDest.ajusteManual = Boolean(slotOrig.ajusteManual);

    slotOrig.disciplina = null;
    slotOrig.professor = null;
    slotOrig.conflito = false;
    slotOrig.conflitos = [];
    slotOrig.ajusteManual = false;
  }

  // 🚨 APLICA STATUS DE CONFLITO NO DESTINO
  slotDest.conflito = !resultado.ok;
  slotDest.conflitos = resultado.conflitos;
  // ✅ AQUI ESTÁ O PONTO-CHAVE
  reavaliarConflitos();
}


function renderizarAulasNaoAlocadas() {
  const painel = el("painel-nao-alocadas");
  if (!painel) return;

  aplicarOrdenacaoAulasNaoAlocadas();
  atualizarBotoesOrdenacaoNaoAlocadas();

  painel.innerHTML = "";

  let indiceGlobal = 0;

  aulasNaoAlocadas.forEach((item) => {

    // 🔁 CRIA UM BLOCO PARA CADA AULA REAL
    for (let i = 0; i < item.faltam; i++) {

      const div = document.createElement("div");
      div.className = "bloco-aula";
      div.draggable = true;

      div.dataset.index = indiceGlobal;

      div.innerHTML = `
        <strong>${item.disciplina}</strong><br>
        <small>${item.turma} • ${item.professor}</small>
      `;

      div.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData(
          "application/json",
          JSON.stringify({
            tipo: "naoAlocada",
            index: indiceGlobal,
            turma: item.turma,
            disciplina: item.disciplina,
            professor: item.professor
          })
        );
      });

      painel.appendChild(div);
      indiceGlobal++;
    }
  });
}


function onDragStart(e) {
  e.dataTransfer.setData(
    "application/json",
    JSON.stringify({
      tipo: "naoAlocada",
      index: Number(e.target.dataset.index),
      ...aulasNaoAlocadas[e.target.dataset.index]
    })
  );
}

function permitirDrop(e) {
  e.preventDefault();
}

function onDrop(e) {
  e.preventDefault();

  const data = JSON.parse(e.dataTransfer.getData("application/json"));
  const celula = e.target.closest ? e.target.closest("td") : e.target;
  if (!celula?.dataset?.turma) return;

  const turmaDestino = celula.dataset.turma;
  const diaDestino = celula.dataset.dia;
  const aulaDestino = Number(celula.dataset.aula);

  if (data.tipo === "naoAlocada") {
    const avaliacao = validarDrop(data, turmaDestino, diaDestino, aulaDestino);
    if (!avaliacao.possivel) {
      alert(`❌ ${avaliacao.motivo}`);
      return;
    }

    aplicarDrop(data, turmaDestino, diaDestino, aulaDestino, avaliacao);
    const item = aulasNaoAlocadas.find(a =>
      a.turma === data.turma &&
      a.disciplina === data.disciplina &&
      a.professor === data.professor
    );

    if (item) {
      item.faltam--;

      if (item.faltam <= 0) {
        aulasNaoAlocadas = aulasNaoAlocadas.filter(a => a !== item);
      }
    }

  }

  if (data.tipo === "alocada") {
    moverAulaAlocada(data, turmaDestino, diaDestino, aulaDestino);
  }

  reavaliarConflitos();
  salvar();
  mostrarTodosHorarios();
  renderizarAulasNaoAlocadas();
}


function validarDrop(aula, turmaNome, dia, aulaNum) {
  const turma = banco.turmas.find(t => t.nome === turmaNome);
  const professor = banco.professores.find(p => p.nome === aula.professor);
  const slot = banco.horarios[turmaNome]
    ?.find(s => s.dia === dia && s.aula === aulaNum);

  if (!turma) {
    return {
      possivel: false,
      motivo: "Turma de destino inválida",
      ok: false,
      conflitos: []
    };
  }

  if (!slot) {
    return {
      possivel: false,
      motivo: "Slot de destino inexistente",
      ok: false,
      conflitos: []
    };
  }

  if (slot.disciplina) {
    return {
      possivel: false,
      motivo: "Escolha um espaço vazio para alocar a aula",
      ok: false,
      conflitos: []
    };
  }

  if (!professor) {
    return {
      possivel: false,
      motivo: "Professor não encontrado",
      ok: false,
      conflitos: []
    };
  }

  const faixa = faixaGlobal(turma.turno, aulaNum);
  const conflitos = [];

  if (!professor.dias.includes(dia)) {
    conflitos.push("Professor não trabalha neste dia");
  }

  if (!professorLivre(professor.nome, dia, faixa)) {
    conflitos.push("Professor já está alocado nessa faixa");
  }

  if (!aulaPermitidaPorNivel(professor, aulaNum, turma.turno, 1)) {
    conflitos.push("Aula proibida para o professor");
  }

  const disc = turma.disciplinas.find(d => d.nome === aula.disciplina);
  if (!disc) {
    return {
      possivel: false,
      motivo: "Disciplina não encontrada na turma",
      ok: false,
      conflitos: []
    };
  }

  if (!disc.permiteSequencia &&
    disciplinaJaNoDia(turmaNome, dia, disc.nome)) {
    conflitos.push("Disciplina repetida no mesmo dia");
  }

  return {
    possivel: true,
    ok: conflitos.length === 0,
    conflitos
  };
}

function aplicarDrop(aula, turma, dia, aulaNum, avaliacao = null) {
  const slot = banco.horarios[turma]
    .find(s => s.dia === dia && s.aula === aulaNum);

  slot.disciplina = aula.disciplina;
  slot.professor = aula.professor;
  slot.fixo = true;
  slot.ajusteManual = true;

  if (avaliacao) {
    slot.conflito = !avaliacao.ok;
    slot.conflitos = [...avaliacao.conflitos];
  } else {
    slot.conflito = false;
    slot.conflitos = [];
  }

}

let arrastando = false;

function onClickCelula(e) {
  if (arrastando) return;
  destacarProfessor(e.currentTarget);
}

function onDragStartAlocada(e) {
  arrastando = true;

  const td = e.target;

  const payload = {
    tipo: "alocada",
    turma: td.dataset.turma,
    dia: td.dataset.dia,
    aula: Number(td.dataset.aula),
    disciplina: td.dataset.disciplina,
    professor: td.dataset.professor
  };

  e.dataTransfer.setData("application/json", JSON.stringify(payload));
}

function onDragEndAlocada() {
  setTimeout(() => {
    arrastando = false;
  }, 50);
}



window.onload = () => {
  carregar();
  normalizarRestricoes();
  inicializarHorariosIncremental();
  normalizarSlotsHorario();
  atualizarSelects();
  atualizarMedidor();
  recalcularAulasNaoAlocadas();
  mostrarTodosHorarios();
  renderizarAulasNaoAlocadas();

  if (el("relatorio-geracao")) {
    mostrarRelatorioGeracao();
  }

  if (el("relatorio-falhas")) {
    mostrarRelatorioFalhas();
  }
};
